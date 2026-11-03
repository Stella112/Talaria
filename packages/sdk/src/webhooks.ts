/** Rejects events older than this, which limits replay of a captured request. */
const DEFAULT_TOLERANCE_SECONDS = 300;

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a `Talaria-Signature` header against the raw request body. Works in Node and browsers. */
export async function verifyWebhook(rawBody: string, header: string | null | undefined, secret: string, options: { toleranceSeconds?: number; now?: number } = {}): Promise<boolean> {
  const parts = Object.fromEntries((header ?? "").split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`)));
  return equal(expected, parts.v1);
}

export type PaymentStatus = "held" | "disputed" | "released" | "refunded" | "partially_refunded" | "resolved";

/** Readable status from TalariaProtect's stored status (1 Held, 2 Disputed, 3 Released, 4 Refunded, 5 Resolved). */
export function paymentStatus(stored: number, refunded: bigint): PaymentStatus {
  if (stored === 2) return "disputed";
  if (stored === 4) return "refunded";
  if (stored === 5) return "resolved";
  if (refunded > 0n) return "partially_refunded";
  return stored === 1 ? "held" : "released";
}
