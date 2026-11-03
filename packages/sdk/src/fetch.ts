import type { Address, Hex, LocalAccount, PublicClient } from "viem";
import { TalariaChannelsAbi } from "./generated";
import { signVoucher, toUnits } from "./intents";
import { requirementSchema, VOUCHER_HEADER } from "./paywall";

export type PaidFetchOptions = {
  /** Refuse to pay more than this per call, in tUSD. */
  maxPrice: string | number | bigint;
  /** Existing channel to pay from. Otherwise one is opened using `channelDeposit`. */
  channelId?: bigint;
  channelDeposit?: string | number | bigint;
};

export class PriceTooHighError extends Error {
  constructor(price: bigint, max: bigint) {
    super(`API asks ${price} base units per call, above the limit of ${max}`);
    this.name = "PriceTooHighError";
  }
}

type Deps = {
  client: PublicClient;
  account: LocalAccount;
  channels: Address;
  openChannel: (provider: Address, deposit: string | number | bigint) => Promise<{ channelId: bigint; txHash: Hex }>;
};

const replacer = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export function createPaidFetch(deps: Deps) {
  const state = new Map<bigint, { cumulative: bigint; nonce: bigint }>();
  const channelByProvider = new Map<string, bigint>();

  return async function paidFetch(url: string, options: PaidFetchOptions & RequestInit): Promise<Response> {
    const { maxPrice, channelId, channelDeposit, ...init } = options;
    const first = await fetch(url, init);
    if (first.status !== 402) return first;

    const requirement = requirementSchema.parse(await first.json());
    const limit = toUnits(maxPrice);
    if (requirement.price > limit) throw new PriceTooHighError(requirement.price, limit);
    if (requirement.channels.toLowerCase() !== deps.channels.toLowerCase()) throw new Error("API uses a different channels contract");

    const provider = requirement.provider.toLowerCase();
    let id = channelId ?? channelByProvider.get(provider);
    if (id === undefined) {
      if (channelDeposit === undefined) throw new Error("No channel for this provider: pass channelId or channelDeposit");
      ({ channelId: id } = await deps.openChannel(requirement.provider, channelDeposit));
    }
    channelByProvider.set(provider, id);

    let current = state.get(id);
    if (!current) {
      const channel = (await deps.client.readContract({ address: deps.channels, abi: TalariaChannelsAbi, functionName: "channels", args: [id] })) as unknown as readonly unknown[];
      current = { cumulative: BigInt(channel[2] as number | bigint), nonce: 0n };
    }
    const next = { cumulative: current.cumulative + requirement.price, nonce: current.nonce + 1n };
    const voucher = await signVoucher(deps.account, deps.channels, requirement.chainId, { channelId: id, cumulativeAmount: next.cumulative, nonce: next.nonce });

    const headers = new Headers(init.headers);
    headers.set(VOUCHER_HEADER, JSON.stringify(voucher, replacer));
    const paid = await fetch(url, { ...init, headers });
    // Only a response that was not refused consumes the amount.
    if (paid.status !== 402) state.set(id, next);
    return paid;
  };
}
