import { recoverTypedDataAddress, serializeSignature, type Address, type Hex, type PublicClient } from "viem";
import { z } from "zod";
import { TalariaChannelsAbi } from "./generated";
import { toUnits, TOKEN_DECIMALS, VOUCHER_TYPES, voucherDomain, type SignedVoucher } from "./intents";

export const VOUCHER_HEADER = "x-talaria-voucher";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const bigintString = z.string().regex(/^\d+$/).transform(BigInt);

export const voucherSchema = z.object({
  channelId: bigintString,
  cumulativeAmount: bigintString,
  nonce: bigintString,
  v: z.number().int(),
  r: hex.transform((x) => x as Hex),
  s: hex.transform((x) => x as Hex),
});

export const requirementSchema = z.object({
  scheme: z.literal("talaria-channel"),
  chainId: z.number(),
  channels: hex.transform((x) => x as Address),
  token: hex.transform((x) => x as Address),
  decimals: z.number(),
  provider: hex.transform((x) => x as Address),
  price: bigintString,
  reason: z.string().optional(),
});
export type PaymentRequirement = z.output<typeof requirementSchema>;

export type PaywallOptions = {
  /** Price per call in tUSD, for example "0.01". */
  price: string | number | bigint;
  provider: Address;
  /** Receives every accepted voucher, normally to pass to the settler. */
  onVoucher?: (voucher: SignedVoucher) => void | Promise<void>;
};

type Deps = { client: PublicClient; channels: Address; token: Address };

/** Framework-free check plus Express and Fastify adapters. */
export function createPaywall(deps: Deps, options: PaywallOptions) {
  const price = toUnits(options.price);
  // Highest cumulative amount accepted per channel. In memory: single-process only.
  const seen = new Map<bigint, bigint>();

  async function requirement(reason?: string) {
    return {
      scheme: "talaria-channel",
      chainId: await deps.client.getChainId(),
      channels: deps.channels,
      token: deps.token,
      decimals: TOKEN_DECIMALS,
      provider: options.provider,
      price: price.toString(),
      ...(reason ? { reason } : {}),
    };
  }

  async function check(header: string | string[] | undefined): Promise<{ paid: true; voucher: SignedVoucher } | { paid: false; body: object }> {
    if (typeof header !== "string") return { paid: false, body: await requirement() };
    let voucher: SignedVoucher;
    try {
      voucher = voucherSchema.parse(JSON.parse(header));
    } catch {
      return { paid: false, body: await requirement("malformed voucher") };
    }
    const [payer, deposit, redeemed, provider, , signer] = (await deps.client.readContract({
      address: deps.channels,
      abi: TalariaChannelsAbi,
      functionName: "channels",
      args: [voucher.channelId],
    })) as unknown as readonly [Address, number | bigint, number | bigint, Address, number, Address];
    if (payer === "0x0000000000000000000000000000000000000000") return { paid: false, body: await requirement("unknown channel") };
    if (provider.toLowerCase() !== options.provider.toLowerCase()) return { paid: false, body: await requirement("channel pays another provider") };

    const recovered = await recoverTypedDataAddress({
      domain: voucherDomain(deps.channels, await deps.client.getChainId()),
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { channelId: voucher.channelId, cumulativeAmount: voucher.cumulativeAmount, nonce: voucher.nonce },
      signature: serializeSignature({ r: voucher.r, s: voucher.s, v: BigInt(voucher.v) }),
    });
    if (recovered.toLowerCase() !== signer.toLowerCase()) return { paid: false, body: await requirement("bad signature") };

    const floor = seen.get(voucher.channelId) ?? BigInt(redeemed);
    if (voucher.cumulativeAmount - floor < price) return { paid: false, body: await requirement("voucher does not cover the price") };
    if (voucher.cumulativeAmount > BigInt(deposit)) return { paid: false, body: await requirement("channel deposit exceeded") };

    seen.set(voucher.channelId, voucher.cumulativeAmount);
    await options.onVoucher?.(voucher);
    return { paid: true, voucher };
  }

  return {
    check,
    /** Express / Connect middleware. */
    express: () => async (req: any, res: any, next: (error?: unknown) => void) => {
      try {
        const result = await check(req.headers[VOUCHER_HEADER]);
        if (result.paid) return next();
        res.status(402).json(result.body);
      } catch (error) {
        next(error);
      }
    },
    /** Fastify preHandler hook. */
    fastify: () => async (request: any, reply: any) => {
      const result = await check(request.headers[VOUCHER_HEADER]);
      if (!result.paid) return reply.code(402).send(result.body);
    },
  };
}
