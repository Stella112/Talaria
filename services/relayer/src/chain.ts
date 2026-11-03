import { TalariaBridgeOutAbi, TalariaChannelsAbi, TalariaCoreAbi, TalariaLockboxAbi, TalariaLockboxV2Abi, TalariaProtectAbi, TalariaSubscriptionsAbi, type SignedIntent } from "@talaria-pay/sdk";
import { parseEventLogs, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { ProtectGateway } from "./server";
import type { BridgeOutEvent, ProtectEvent, SettlementChain } from "./settlement";
import type { Store, StoredVoucher } from "./store";

export class SpendLimitError extends Error {}

/** Everything that touches a chain, so the workers can be tested without one. */
export type Chain = {
  lockedEvents(from: bigint, to: bigint): Promise<{ payer: Address; recipient: Address; amount: bigint; txHash: Hex; intentRef: Hex }[]>;
  sourceHead(): Promise<bigint>;
  bridgeProcessed(srcTxHash: Hex): Promise<boolean>;
  credit(user: Address, amount: bigint, srcTxHash: Hex): Promise<Hex>;
  execute(signed: SignedIntent): Promise<Hex>;
  depositWithPermit(input: { from: Address; amount: bigint; deadline: bigint; v: number; r: Hex; s: Hex }): Promise<Hex>;
  subscriptionCount(): Promise<number>;
  dueSubscription(id: number): Promise<boolean>;
  charge(id: number): Promise<Hex>;
  redeemBatch(vouchers: StoredVoucher[]): Promise<Hex>;
};

export type LiveConfig = {
  portaldot: PublicClient;
  base: PublicClient;
  wallet: WalletClient;
  core: Address;
  lockbox?: Address;
  subscriptions?: Address;
  channels?: Address;
  srcChainId: bigint;
  store: Store;
  maxTxPerHour: number;
  /** Without this, every write is refused so nothing spends tPOT by accident. */
  live: boolean;
};

export function liveChain(cfg: LiveConfig): Chain {
  /** Simulates first so a reverting call costs nothing, then sends and waits for success. */
  async function send(address: Address, abi: any, functionName: string, args: unknown[]): Promise<Hex> {
    const { request } = await cfg.portaldot.simulateContract({ account: cfg.wallet.account, address, abi, functionName, args } as any);
    if (!cfg.live) throw new SpendLimitError(`Refused ${functionName}: RELAYER_LIVE is not set`);
    if (!cfg.store.takeSendSlot(cfg.maxTxPerHour)) throw new SpendLimitError(`Refused ${functionName}: over ${cfg.maxTxPerHour} transactions per hour`);
    const hash = await cfg.wallet.writeContract(request as any);
    const receipt = await cfg.portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
    console.log(`[relayer] ${functionName} ${hash} block ${receipt.blockNumber}`);
    return hash;
  }

  const need = (address: Address | undefined, what: string): Address => {
    if (!address) throw new Error(`${what} is not deployed`);
    return address;
  };

  return {
    async lockedEvents(from, to) {
      const logs = await cfg.base.getContractEvents({ address: need(cfg.lockbox, "Lockbox"), abi: TalariaLockboxAbi, eventName: "Locked", fromBlock: from, toBlock: to });
      return logs.map((log: any) => ({
        payer: log.args.payer,
        recipient: log.args.portaldotRecipient,
        amount: log.args.amount,
        intentRef: log.args.intentRef,
        txHash: log.transactionHash,
      }));
    },
    sourceHead: () => cfg.base.getBlockNumber(),
    bridgeProcessed: (srcTxHash) => cfg.portaldot.readContract({ address: cfg.core, abi: TalariaCoreAbi, functionName: "bridgeProcessed", args: [srcTxHash] }) as Promise<boolean>,
    credit: (user, amount, srcTxHash) => send(cfg.core, TalariaCoreAbi, "creditFromBridge", [user, amount, cfg.srcChainId, srcTxHash]),
    execute: ({ intent, v, r, s }) => send(cfg.core, TalariaCoreAbi, "execute", [intent, v, r, s]),
    depositWithPermit: ({ from, amount, deadline, v, r, s }) => send(cfg.core, TalariaCoreAbi, "depositWithPermit", [from, amount, deadline, v, r, s]),
    async subscriptionCount() {
      if (!cfg.subscriptions) return 0;
      return Number(await cfg.portaldot.readContract({ address: cfg.subscriptions, abi: TalariaSubscriptionsAbi, functionName: "subscriptionCount" }));
    },
    async dueSubscription(id) {
      const address = need(cfg.subscriptions, "Subscriptions");
      const [subscriber, planId, nextDue, periods, paused] = (await cfg.portaldot.readContract({ address, abi: TalariaSubscriptionsAbi, functionName: "subscriptions", args: [BigInt(id)] })) as unknown as readonly [Address, number, number, number, boolean];
      if (BigInt(subscriber) === 0n || paused || Date.now() / 1000 < nextDue) return false;
      const plan = (await cfg.portaldot.readContract({ address, abi: TalariaSubscriptionsAbi, functionName: "plans", args: [BigInt(planId)] })) as unknown as readonly unknown[];
      return periods < Number(plan[3]);
    },
    charge: (id) => send(need(cfg.subscriptions, "Subscriptions"), TalariaSubscriptionsAbi, "charge", [BigInt(id)]),
    redeemBatch: (vouchers) =>
      send(need(cfg.channels, "Channels"), TalariaChannelsAbi, "redeemBatch", [
        vouchers.map((v) => ({ channelId: BigInt(v.channelId), cumulativeAmount: BigInt(v.cumulativeAmount), nonce: BigInt(v.nonce), v: v.v, r: v.r, s: v.s })),
      ]),
  };
}

const NO_SIG = { v: 0, r: `0x${"00".repeat(32)}`, s: `0x${"00".repeat(32)}` };
const NO_ATTESTATION = { attestation: { subject: "0x0000000000000000000000000000000000000000", agentId: 0n, score: 0, feedbackCount: 0, srcChainId: 0n, srcBlock: 0n, expiry: 0n, nonce: 0n }, sig: NO_SIG };
const NO_CHECKOUT = { orderId: `0x${"00".repeat(32)}`, amount: 0n, token: "0x0000000000000000000000000000000000000000", payee: "0x0000000000000000000000000000000000000000", expiry: 0n };

export type SettlementConfig = Omit<LiveConfig, "base" | "lockbox" | "subscriptions" | "channels" | "srcChainId"> & {
  protect?: Address;
  bridgeOut?: Address;
  /** Destination chain id to its client, relayer wallet and V2 lockbox. */
  destinations: Map<bigint, { client: PublicClient; wallet: WalletClient; lockbox: Address }>;
};

export function liveSettlement(cfg: SettlementConfig): SettlementChain & ProtectGateway {
  const need = (address: Address | undefined, what: string): Address => {
    if (!address) throw new Error(`${what} is not deployed`);
    return address;
  };
  async function send(address: Address, abi: any, functionName: string, args: unknown[]) {
    const { request } = await cfg.portaldot.simulateContract({ account: cfg.wallet.account, address, abi, functionName, args } as any);
    if (!cfg.live) throw new SpendLimitError(`Refused ${functionName}: RELAYER_LIVE is not set`);
    if (!cfg.store.takeSendSlot(cfg.maxTxPerHour)) throw new SpendLimitError(`Refused ${functionName}: over ${cfg.maxTxPerHour} transactions per hour`);
    const hash = await cfg.wallet.writeContract(request as any);
    const receipt = await cfg.portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
    console.log(`[relayer] ${functionName} ${hash} block ${receipt.blockNumber}`);
    return receipt;
  }
  const destination = (chainId: bigint) => {
    const found = cfg.destinations.get(chainId);
    if (!found) throw new Error(`No destination configured for chain ${chainId}`);
    return found;
  };

  return {
    portaldotHead: () => cfg.portaldot.getBlockNumber(),
    async protectEvents(from, to) {
      if (!cfg.protect) return [];
      const logs = await cfg.portaldot.getContractEvents({ address: cfg.protect, abi: TalariaProtectAbi, fromBlock: from, toBlock: to });
      return logs.map((log: any): ProtectEvent => ({ eventName: log.eventName, args: log.args, txHash: log.transactionHash }));
    },
    async merchantOf(id) {
      const payment = (await cfg.portaldot.readContract({ address: need(cfg.protect, "TalariaProtect"), abi: TalariaProtectAbi, functionName: "payments", args: [id] })) as unknown as readonly unknown[];
      return payment[3] as Address;
    },
    release: async (id) => (await send(need(cfg.protect, "TalariaProtect"), TalariaProtectAbi, "release", [id])).transactionHash,
    async bridgeOutEvents(from, to) {
      if (!cfg.bridgeOut) return [];
      const logs = await cfg.portaldot.getContractEvents({ address: cfg.bridgeOut, abi: TalariaBridgeOutAbi, eventName: "BridgeOut", fromBlock: from, toBlock: to });
      return logs.map((log: any): BridgeOutEvent => ({ id: log.args.id, from: log.args.from, recipient: log.args.recipient, amount: log.args.amount, destChainId: log.args.destChainId, txHash: log.transactionHash }));
    },
    lockboxProcessed(destChainId, id) {
      const { client, lockbox } = destination(destChainId);
      return client.readContract({ address: lockbox, abi: TalariaLockboxV2Abi, functionName: "processed", args: [id] }) as Promise<boolean>;
    },
    async lockboxRelease(destChainId, id, recipient, amount) {
      const { client, wallet, lockbox } = destination(destChainId);
      const { request } = await client.simulateContract({ account: wallet.account, address: lockbox, abi: TalariaLockboxV2Abi, functionName: "release", args: [id, recipient, amount] } as any);
      if (!cfg.live) throw new SpendLimitError("Refused release: RELAYER_LIVE is not set");
      const hash = await wallet.writeContract(request as any);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error(`release reverted in ${hash}`);
      return hash;
    },
    async payWithTrust({ intent, v, r, s }, attested: any) {
      const address = need(cfg.protect, "TalariaProtect");
      if (attested) return (await send(address, TalariaProtectAbi, "payWithTrust", [intent, { v, r, s }, attested.attestation, attested.sig])).transactionHash;
      // No attestation: the intent goes straight to Core, and the contract applies the New tier.
      return (await send(cfg.core, TalariaCoreAbi, "execute", [intent, v, r, s])).transactionHash;
    },
    async payWithMandate(body, merchant: any, agent: any) {
      const toTrust = (attested: any) => (attested ? { attestation: attested.attestation, sig: attested.sig } : NO_ATTESTATION);
      const receipt = await send(need(cfg.protect, "TalariaProtect"), TalariaProtectAbi, "payWithMandate", [
        { ...body, checkout: body.checkout ?? NO_CHECKOUT, checkoutSig: body.checkoutSig ?? NO_SIG, merchantTrust: toTrust(merchant), agentTrust: toTrust(agent) },
      ]);
      const [opened] = parseEventLogs({ abi: TalariaProtectAbi as any, logs: receipt.logs, eventName: "PaymentOpened" }) as any[];
      return { txHash: receipt.transactionHash, paymentId: opened?.args.id ?? null };
    },
  };
}
