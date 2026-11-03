import { TalariaChannelsAbi, TalariaCoreAbi, TalariaLockboxAbi, TalariaSubscriptionsAbi, type SignedIntent } from "@talaria-pay/sdk";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
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
