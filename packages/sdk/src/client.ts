import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  parseSignature,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { portaldotClient, retryTransport } from "./chain";
import {
  TalariaBridgeOutAbi,
  TalariaChannelsAbi,
  TalariaCoreAbi,
  TalariaProtectAbi,
  TalariaRemitAbi,
  TalariaStreamsAbi,
  TalariaSubscriptionsAbi,
  TalariaUSDAbi,
  portaldotDeployments,
} from "./generated";
import { Rail, signIntent, toRef, toUnits, ZERO_ADDRESS, ZERO_REF, type Intent, type SignedIntent } from "./intents";
import { mandateHash, payeesHash, signProtect, type Checkout, type Mandate, type Sig, type SignedMandate } from "./mandates";
import { createPaidFetch, type PaidFetchOptions } from "./fetch";
import { createPaywall, type PaywallOptions } from "./paywall";
import * as utils from "./utils/address";
import { paymentStatus } from "./webhooks";

export type Addresses = {
  token: Address;
  core: Address;
  subscriptions?: Address;
  streams?: Address;
  channels?: Address;
  remit?: Address;
  protect?: Address;
  bridgeOut?: Address;
};

export type TalariaConfig = {
  /** Signs intents and vouchers: the owner's key or a session key. Never sent anywhere. */
  account?: LocalAccount;
  /** Account whose funds are used. Defaults to `account` (set it when `account` is a session key). */
  owner?: Address;
  publicClient?: PublicClient;
  rpcUrl?: string;
  /** Gasless route: a Talaria relayer base URL. */
  relayerUrl?: string;
  /** Direct route, used when there is no relayer. The account pays gas itself. */
  walletClient?: WalletClient;
  /** Replaces relayer and wallet routes, for example in tests. */
  submitIntent?: (signed: SignedIntent) => Promise<Hex>;
  submitProtected?: (path: string, body: unknown) => Promise<any>;
  addresses?: Partial<Addresses>;
  /** Seconds a signed intent stays valid. */
  intentTtl?: number;
};

export class RailNotDeployedError extends Error {
  constructor(rail: string) {
    super(`The ${rail} rail has no deployed contract on this network`);
    this.name = "RailNotDeployedError";
  }
}

const SECONDS_PER_MONTH = 30n * 24n * 3600n;
const packKeyPolicy = (expiry: bigint, rails: number, payee: Address) =>
  toRef((expiry << 168n) | (BigInt(rails) << 160n) | BigInt(payee));

export class Talaria {
  readonly client: PublicClient;
  readonly addresses: Addresses;
  readonly utils = utils;
  /** HTTP client that pays 402 responses with channel vouchers. Built by `paidFetch`. */
  private paid?: ReturnType<typeof createPaidFetch>;

  constructor(private readonly config: TalariaConfig = {}) {
    this.client = config.publicClient ?? portaldotClient(config.rpcUrl);
    this.addresses = {
      token: portaldotDeployments.TalariaUSD,
      core: portaldotDeployments.TalariaCore,
      subscriptions: portaldotDeployments.TalariaSubscriptions,
      streams: portaldotDeployments.TalariaStreams,
      channels: portaldotDeployments.TalariaChannels,
      remit: portaldotDeployments.TalariaRemit,
      protect: portaldotDeployments.TalariaProtect,
      bridgeOut: portaldotDeployments.TalariaBridgeOut,
      ...config.addresses,
    };
  }

  get account(): LocalAccount {
    if (!this.config.account) throw new Error("This action needs a signing account");
    return this.config.account;
  }

  get owner(): Address {
    return this.config.owner ?? this.account.address;
  }

  private rail(name: "subscriptions" | "streams" | "channels" | "remit" | "protect" | "bridgeOut"): Address {
    const address = this.addresses[name];
    if (!address) throw new RailNotDeployedError(name);
    return address;
  }

  /** Signs an intent and submits it through the configured route. */
  async intent(input: { rail: number; payee?: Address; amount?: bigint; ref?: Hex; deadline?: bigint }): Promise<Hex> {
    return this.submit(await this.signedIntent(input));
  }

  private async signedIntent(input: { rail: number; payee?: Address; amount?: bigint; ref?: Hex; deadline?: bigint }): Promise<SignedIntent> {
    const nonce = (await this.client.readContract({
      address: this.addresses.core,
      abi: TalariaCoreAbi,
      functionName: "nonces",
      args: [this.account.address],
    })) as bigint;
    const ttl = BigInt(this.config.intentTtl ?? 600);
    const intent: Intent = {
      rail: input.rail,
      owner: this.owner,
      signer: this.account.address,
      payee: input.payee ?? ZERO_ADDRESS,
      amount: input.amount ?? 0n,
      ref: input.ref ?? ZERO_REF,
      nonce,
      deadline: input.deadline ?? BigInt(Math.floor(Date.now() / 1000)) + ttl,
    };
    return signIntent(this.account, this.addresses.core, await this.client.getChainId(), intent);
  }

  private async submit(signed: SignedIntent): Promise<Hex> {
    if (this.config.submitIntent) return this.config.submitIntent(signed);
    if (this.config.relayerUrl) return this.post("/intents", signed);
    const { intent, v, r, s } = signed;
    return this.direct(this.addresses.core, encodeFunctionData({ abi: TalariaCoreAbi, functionName: "execute", args: [intent, v, r, s] }));
  }

  private async post(path: string, body: unknown): Promise<Hex> {
    const response = await fetch(`${this.config.relayerUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
    });
    const json = (await response.json()) as { txHash?: Hex; error?: string };
    if (!response.ok || !json.txHash) throw new Error(`Relayer ${response.status}: ${json.error ?? "no transaction hash"}`);
    return json.txHash;
  }

  private async direct(to: Address, data: Hex): Promise<Hex> {
    const wallet = this.config.walletClient;
    if (!wallet) throw new Error("This action needs a walletClient: it is not available through the relayer");
    const hash = await wallet.sendTransaction({ account: wallet.account ?? this.account, chain: wallet.chain, to, data });
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
    return hash;
  }

  private async eventId(hash: Hex, abi: readonly unknown[], eventName: string): Promise<bigint> {
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    const [log] = parseEventLogs({ abi: abi as any, logs: receipt.logs, eventName }) as any[];
    if (!log) throw new Error(`${eventName} not found in ${hash}: the intent may be queued for approval`);
    return log.args.id as bigint;
  }

  // Accounts

  /** Gasless deposit: signs a permit for Core, and the relayer submits it. */
  async deposit(amount: string | number | bigint): Promise<Hex> {
    const value = toUnits(amount);
    const read = <T>(functionName: string, args: unknown[] = []) =>
      this.client.readContract({ address: this.addresses.token, abi: TalariaUSDAbi as any, functionName, args }) as Promise<T>;
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const signature = await this.account.signTypedData({
      domain: { name: await read<string>("name"), version: "1", chainId: await this.client.getChainId(), verifyingContract: this.addresses.token },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: this.account.address, spender: this.addresses.core, value, nonce: await read<bigint>("nonces", [this.account.address]), deadline },
    });
    const { r, s, v } = parseSignature(signature);
    const args = [this.account.address, value, deadline, Number(v), r, s] as const;
    if (this.config.relayerUrl) return this.post("/deposits", { from: args[0], amount: value, deadline, v: args[3], r, s });
    return this.direct(this.addresses.core, encodeFunctionData({ abi: TalariaCoreAbi, functionName: "depositWithPermit", args }));
  }

  withdrawBalance(amount: string | number | bigint, to?: Address): Promise<Hex> {
    return this.intent({ rail: Rail.withdraw, payee: to ?? this.owner, amount: toUnits(amount) });
  }

  async getBalance(account?: Address): Promise<bigint> {
    return (await this.client.readContract({ address: this.addresses.core, abi: TalariaCoreAbi, functionName: "balances", args: [account ?? this.owner] })) as bigint;
  }

  // Checkout

  async createCheckout(input: { amount: string | number | bigint; currency: "USD"; metadata?: unknown; expiresIn?: number }): Promise<{ invoiceId: bigint; txHash: Hex }> {
    const metadataHash = keccak256(toHex(JSON.stringify(input.metadata ?? {})));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (input.expiresIn ?? 3600));
    const txHash = await this.intent({ rail: Rail.createInvoice, amount: toUnits(input.amount), ref: metadataHash, deadline });
    return { invoiceId: await this.eventId(txHash, TalariaCoreAbi, "InvoiceCreated"), txHash };
  }

  async getInvoice(id: bigint) {
    const [merchant, amount, expiry, payer, refunded] = (await this.client.readContract({
      address: this.addresses.core,
      abi: TalariaCoreAbi,
      functionName: "invoices",
      args: [id],
    })) as readonly [Address, bigint, number, Address, bigint];
    return { merchant, amount, expiry, payer, refunded };
  }

  async payInvoice(id: bigint): Promise<Hex> {
    const invoice = await this.getInvoice(id);
    return this.intent({ rail: Rail.payInvoice, payee: invoice.merchant, amount: invoice.amount, ref: toRef(id) });
  }

  async refund(id: bigint, amount: string | number | bigint): Promise<Hex> {
    const invoice = await this.getInvoice(id);
    return this.intent({ rail: Rail.refund, payee: invoice.payer, amount: toUnits(amount), ref: toRef(id) });
  }

  // Subscriptions

  /** Plans are created directly: the merchant pays gas. */
  async createPlan(input: { amount: string | number | bigint; interval: number; maxPeriods: number }): Promise<{ planId: bigint; txHash: Hex }> {
    const address = this.rail("subscriptions");
    const data = encodeFunctionData({ abi: TalariaSubscriptionsAbi, functionName: "createPlan", args: [Number(toUnits(input.amount)), input.interval, input.maxPeriods] as any });
    const txHash = await this.direct(address, data);
    return { planId: await this.eventId(txHash, TalariaSubscriptionsAbi, "PlanCreated"), txHash };
  }

  async subscribe(planId: bigint): Promise<{ subId: bigint; txHash: Hex }> {
    const [merchant, amount] = (await this.client.readContract({ address: this.rail("subscriptions"), abi: TalariaSubscriptionsAbi, functionName: "plans", args: [planId] })) as unknown as readonly [Address, number];
    const txHash = await this.intent({ rail: Rail.subscribe, payee: merchant, amount: BigInt(amount), ref: toRef(planId) });
    return { subId: await this.eventId(txHash, TalariaSubscriptionsAbi, "Subscribed"), txHash };
  }

  cancel(subId: bigint): Promise<Hex> {
    this.rail("subscriptions");
    return this.intent({ rail: Rail.cancelSub, ref: toRef(subId) });
  }

  // Streams

  async startStream(input: { to: Address; ratePerMonth: string | number | bigint; deposit: string | number | bigint }): Promise<{ streamId: bigint; txHash: Hex }> {
    this.rail("streams");
    const rate = toUnits(input.ratePerMonth) / SECONDS_PER_MONTH;
    if (rate === 0n) throw new Error("ratePerMonth is below one base unit per second");
    const txHash = await this.intent({ rail: Rail.startStream, payee: input.to, amount: toUnits(input.deposit), ref: toRef(rate) });
    return { streamId: await this.eventId(txHash, TalariaStreamsAbi, "StreamStarted"), txHash };
  }

  withdraw(streamId: bigint): Promise<Hex> {
    this.rail("streams");
    return this.intent({ rail: Rail.withdrawStream, ref: toRef(streamId) });
  }

  stopStream(streamId: bigint): Promise<Hex> {
    this.rail("streams");
    return this.intent({ rail: Rail.stopStream, ref: toRef(streamId) });
  }

  // Pay-per-call

  async openChannel(input: { provider: Address; deposit: string | number | bigint }): Promise<{ channelId: bigint; txHash: Hex }> {
    this.rail("channels");
    const txHash = await this.intent({ rail: Rail.openChannel, payee: input.provider, amount: toUnits(input.deposit) });
    return { channelId: await this.eventId(txHash, TalariaChannelsAbi, "ChannelOpened"), txHash };
  }

  /** API side: middleware that answers 402 until a valid voucher is attached. */
  paywall(options: PaywallOptions) {
    return createPaywall({ client: this.client, channels: this.rail("channels"), token: this.addresses.token }, options);
  }

  /** Agent side: fetch that answers a 402 with a voucher and retries. */
  fetch(url: string, options: PaidFetchOptions & RequestInit) {
    this.paid ??= createPaidFetch({ client: this.client, account: this.account, channels: this.rail("channels"), openChannel: (provider, deposit) => this.openChannel({ provider, deposit }) });
    return this.paid(url, options);
  }

  // Remittance

  /** Without `to`, creates a claim link: share the returned `claimCode` with the receiver. */
  async sendRemit(input: { to?: Address; claimCode?: Hex; amount: string | number | bigint; cancellable?: boolean; expiresIn?: number }): Promise<{ remitId: bigint; txHash: Hex; claimCode?: Hex }> {
    const address = this.rail("remit");
    const amount = toUnits(input.amount);
    const claimCode = input.to ? undefined : (input.claimCode ?? generatePrivateKey());
    const target = input.to ?? privateKeyToAccount(claimCode!).address;
    let txHash: Hex;
    if (input.cancellable === false || input.expiresIn !== undefined) {
      const expiry = Math.floor(Date.now() / 1000) + (input.expiresIn ?? 30 * 24 * 3600);
      txHash = await this.direct(address, encodeFunctionData({ abi: TalariaRemitAbi, functionName: "sendRemit", args: [target, !input.to, amount, input.cancellable !== false, expiry] }));
    } else {
      txHash = await this.intent({ rail: Rail.sendRemit, payee: input.to ?? ZERO_ADDRESS, amount, ref: input.to ? ZERO_REF : toRef(BigInt(target)) });
    }
    return { remitId: await this.eventId(txHash, TalariaRemitAbi, "RemitSent"), txHash, claimCode };
  }

  cancelRemit(id: bigint): Promise<Hex> {
    this.rail("remit");
    return this.intent({ rail: Rail.cancelRemit, ref: toRef(id) });
  }

  claimRemit(id: bigint): Promise<Hex> {
    this.rail("remit");
    return this.intent({ rail: Rail.claimRemit, ref: toRef(id) });
  }

  /** Claims a code remit for `receiver`. The code signs the receiver, so it cannot be redirected. Direct transaction. */
  async claimWithCode(id: bigint, code: Hex, receiver: Address): Promise<Hex> {
    const address = this.rail("remit");
    const hash = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [BigInt(await this.client.getChainId()), address, id, receiver],
      ),
    );
    const { r, s, v } = parseSignature(await privateKeyToAccount(code).sign({ hash }));
    return this.direct(address, encodeFunctionData({ abi: TalariaRemitAbi, functionName: "claimWithCode", args: [id, receiver, Number(v), r, s] }));
  }

  // Trust-priced settlement

  private async relayerGet<T>(path: string): Promise<T> {
    if (!this.config.relayerUrl) throw new Error("This action needs a relayerUrl");
    const response = await fetch(`${this.config.relayerUrl}${path}`);
    const json = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(json.error ?? `Relayer ${response.status}`);
    return json;
  }

  private async relayerPost(path: string, body: unknown): Promise<any> {
    if (this.config.submitProtected) return this.config.submitProtected(path, body);
    const response = await fetch(`${this.config.relayerUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
    });
    const json = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(`Relayer ${response.status}: ${json.error ?? "request failed"}`);
    return json;
  }

  /** A subject's reputation as the relayer reads it from Base. */
  getTrust(subject: Address) {
    return this.relayerGet<{ subject: Address; agentId: string | null; score: number; feedbackCount: number; tier: "trusted" | "established" | "new"; srcChainId: string; srcBlock: string | null }>(`/trust/${subject}`);
  }

  /** Links an ERC-8004 agent to this address. `account` must be the wallet that owns the agent. */
  async linkIdentity(subject: Address, agentId: bigint) {
    const message = `Link ERC-8004 agent ${agentId} on Base Sepolia to Portaldot address ${subject.toLowerCase()} for Talaria`;
    return this.relayerPost("/identity/link", { subject, agentId, signature: await this.account.signMessage({ message }) });
  }

  /** Pays a merchant under buyer protection. The relayer attaches the merchant's attestation. */
  async payProtected(input: { merchant: Address; amount: string | number | bigint; ref?: Hex }): Promise<Hex> {
    this.rail("protect");
    const signed = await this.signedIntent({ rail: Rail.payProtected, payee: input.merchant, amount: toUnits(input.amount), ref: input.ref });
    return (await this.relayerPost("/protected", signed)).txHash;
  }

  async getPayment(id: bigint) {
    const [buyer, amount, refunded, merchant, releaseAt, stored] = (await this.client.readContract({ address: this.rail("protect"), abi: TalariaProtectAbi, functionName: "payments", args: [id] })) as unknown as readonly [Address, number | bigint, number | bigint, Address, number, number];
    return { buyer, amount: BigInt(amount), refunded: BigInt(refunded), merchant, releaseAt, status: paymentStatus(stored, BigInt(refunded)) };
  }

  /** Disputes a held payment. A gasless dispute cannot carry a reason hash. */
  async dispute(id: bigint): Promise<Hex> {
    return this.intent({ rail: Rail.dispute, payee: (await this.getPayment(id)).merchant, ref: toRef(id) });
  }

  async refundProtected(id: bigint, amount: string | number | bigint): Promise<Hex> {
    return this.intent({ rail: Rail.refundProtected, payee: (await this.getPayment(id)).buyer, amount: toUnits(amount), ref: toRef(id) });
  }

  /** Builds and signs a mandate as its owner. Give the result to the agent. */
  async createMandate(input: { agent: Address; payees: Address[]; minAmount?: string | number | bigint; maxAmount: string | number | bigint; expiresIn?: number; maxUses?: number; checkoutHash?: Hex }): Promise<SignedMandate> {
    const mandate: Mandate = {
      owner: this.owner,
      agent: input.agent,
      payeesHash: payeesHash(input.payees),
      token: this.addresses.token,
      minAmount: toUnits(input.minAmount ?? 0n),
      maxAmount: toUnits(input.maxAmount),
      expiry: BigInt(Math.floor(Date.now() / 1000) + (input.expiresIn ?? 1800)),
      maxUses: input.maxUses ?? 1,
      checkoutHash: input.checkoutHash ?? ZERO_REF,
      nonce: BigInt(Date.now()),
    };
    const sig = await signProtect(this.account, this.rail("protect"), await this.client.getChainId(), "Mandate", mandate);
    return { mandate, sig, payees: input.payees };
  }

  /** Pays under a mandate. `account` must be the mandate's agent key. */
  async payWithMandate(signed: SignedMandate, input: { payee: Address; amount: string | number | bigint; ref?: Hex; use?: number; checkout?: Checkout; checkoutSig?: Sig }): Promise<{ txHash: Hex; paymentId: string | null }> {
    const protect = this.rail("protect");
    const chainId = await this.client.getChainId();
    const amount = toUnits(input.amount);
    const ref = input.ref ?? ZERO_REF;
    const hash = mandateHash(signed.mandate);
    const use = input.use ?? Number(await this.client.readContract({ address: protect, abi: TalariaProtectAbi, functionName: "mandateUses", args: [signed.mandate.owner, hash] }));
    const agentSig = await signProtect(this.account, protect, chainId, "PaymentAuth", { mandateHash: hash, payee: input.payee, amount, ref, use });
    return this.relayerPost("/mandates/pay", { mandate: signed.mandate, mandateSig: signed.sig, payees: signed.payees, payee: input.payee, amount, ref, agentSig, checkout: input.checkout, checkoutSig: input.checkoutSig });
  }

  revokeMandate(hash: Hex): Promise<Hex> {
    this.rail("protect");
    return this.intent({ rail: Rail.revokeMandate, ref: hash });
  }

  // Bridge-out

  /** Sends tUSD back to a source chain. Session keys need the bridge rail allowed. */
  async bridgeOut(input: { amount: string | number | bigint; destChainId: number; recipient: Address }): Promise<{ id: Hex; txHash: Hex }> {
    this.rail("bridgeOut");
    const txHash = await this.intent({ rail: Rail.bridgeOut, payee: input.recipient, amount: toUnits(input.amount), ref: toRef(BigInt(input.destChainId)) });
    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
    const [log] = parseEventLogs({ abi: TalariaBridgeOutAbi as any, logs: receipt.logs, eventName: "BridgeOut" }) as any[];
    if (!log) throw new Error(`BridgeOut not found in ${txHash}: the intent may be queued for approval`);
    return { id: log.args.id, txHash };
  }

  getBridgeStatus(id: Hex) {
    return this.relayerGet<{ status: "pending" | "completed"; sourceTx: Hex; destTx: Hex | null }>(`/bridge/${id}`);
  }

  // Session keys

  addSessionKey(input: { key: Address; maxPerTx: string | number | bigint; maxPerDay: string | number | bigint; expiry: bigint; rails: number; payee?: Address }): Promise<Hex> {
    const amount = (toUnits(input.maxPerTx) << 64n) | toUnits(input.maxPerDay);
    return this.intent({ rail: Rail.addKey, payee: input.key, amount, ref: packKeyPolicy(input.expiry, input.rails, input.payee ?? ZERO_ADDRESS) });
  }

  revokeSessionKey(key: Address): Promise<Hex> {
    return this.intent({ rail: Rail.revokeKey, payee: key });
  }

  async getPolicy(key: Address, owner?: Address) {
    const [maxPerTx, maxPerDay, spentToday, day, expiry, rails, payee] = (await this.client.readContract({
      address: this.addresses.core,
      abi: TalariaCoreAbi,
      functionName: "sessionKeys",
      args: [owner ?? this.owner, key],
    })) as readonly [bigint, bigint, bigint, number, number, number, Address];
    return { maxPerTx, maxPerDay, spentToday, day, expiry, rails, payee };
  }

  /** Receipts where the account paid. The eth-rpc may prune old logs, so this can be incomplete. */
  async getReceipts(input: { payer?: Address; fromBlock?: bigint; toBlock?: bigint } = {}) {
    const logs = await this.client.getContractEvents({
      address: this.addresses.core,
      abi: TalariaCoreAbi,
      eventName: "Receipt",
      args: input.payer ? ({ payer: input.payer } as any) : undefined,
      fromBlock: input.fromBlock ?? 0n,
      toBlock: input.toBlock,
    });
    return logs.map((log: any) => ({ ...log.args, txHash: log.transactionHash as Hex, blockNumber: log.blockNumber as bigint }));
  }
}

export function createTalaria(config: TalariaConfig = {}): Talaria {
  return new Talaria(config);
}

export { retryTransport };
