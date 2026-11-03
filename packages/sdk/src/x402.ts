import type { Address } from "viem";

/**
 * x402 v2 HTTP headers, from specs/transports-v2/http.md in the coinbase/x402 repository.
 * The headers follow the spec. The payment scheme does not: `talaria-channel` is our own scheme
 * for prepaid channel vouchers, so a client that only speaks the spec's `exact` scheme cannot pay it.
 */
export const X402_SCHEME = "talaria-channel";
export const PAYMENT_REQUIRED = "payment-required";
export const PAYMENT_SIGNATURE = "payment-signature";
export const PAYMENT_RESPONSE = "payment-response";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Base64 of UTF-8 JSON, in Node and browsers. */
export function encodeHeader(value: unknown): string {
  const text = JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return btoa(String.fromCharCode(...encoder.encode(text)));
}

export function decodeHeader<T = any>(header: string): T {
  const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
  return JSON.parse(decoder.decode(bytes)) as T;
}

export const networkId = (chainId: number) => `eip155:${chainId}`;

export type X402Input = { url: string; chainId: number; token: Address; provider: Address; price: bigint; channels: Address; decimals: number; error: string };

export function paymentRequired(input: X402Input) {
  return {
    x402Version: 2,
    error: input.error,
    resource: { url: input.url, description: "Talaria paid API", mimeType: "application/json" },
    accepts: [
      {
        scheme: X402_SCHEME,
        network: networkId(input.chainId),
        amount: input.price.toString(),
        asset: input.token,
        payTo: input.provider,
        maxTimeoutSeconds: 60,
        extra: { channels: input.channels, decimals: input.decimals },
      },
    ],
  };
}

/** Vouchers settle later in a batch, so `transaction` is empty until then. */
export const settlementResponse = (chainId: number, payer: Address) => ({ success: true, transaction: "", network: networkId(chainId), payer, extra: { settlement: "deferred-batch" } });
