import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./db";

export const WEBHOOK_EVENTS = [
  "payment.pending",
  "payment.confirmed",
  "payment.failed",
  "payment.refunded",
  "payment.disputed",
  "payment.released",
  "subscription.charged",
  "stream.updated",
  "remit.claimed",
  "bridge.completed",
  "payout.completed",
  "trust.applied",
  "reputation.written",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

export const signWebhook = (secret: string, timestamp: number, body: string) => createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export const webhookRegistrationMessage = (merchant: string, url: string, timestamp: number) => `Register Talaria webhook ${url} for ${merchant.toLowerCase()} at ${timestamp}`;

/** Blocks URLs that would point the relayer at itself or a private network. */
export function isAllowedWebhookUrl(raw: string, allowLocal = false): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (allowLocal) return true;
  const host = url.hostname.toLowerCase();
  return !(host === "localhost" || host.endsWith(".local") || host === "::1" || host === "[::1]" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host));
}

export type Deliverer = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number };

export class Webhooks {
  constructor(
    private readonly db: Db,
    private readonly deps: Deliverer = {},
  ) {}

  /** Registers a URL and returns its signing secret. Shown once, at registration. */
  register(merchant: string, url: string): string {
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    this.db.setWebhook(merchant, url, secret);
    return secret;
  }

  /** Sends one event, retrying with exponential backoff, and records every outcome. */
  async emit(merchant: string, type: WebhookEvent, data: unknown): Promise<{ eventId: string; delivered: boolean } | null> {
    const hook = this.db.webhookOf(merchant);
    if (!hook) return null;
    const eventId = `evt_${randomUUID()}`;
    const deliveryId = this.db.addDelivery(eventId, merchant, type);
    const body = JSON.stringify({ id: eventId, type, data }, (_, value) => (typeof value === "bigint" ? value.toString() : value));
    const send = this.deps.fetch ?? fetch;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const timestamp = this.deps.now?.() ?? Math.floor(Date.now() / 1000);
      try {
        const response = await send(hook.url, {
          method: "POST",
          headers: { "content-type": "application/json", "Talaria-Signature": `t=${timestamp},v1=${signWebhook(hook.secret, timestamp, body)}`, "Talaria-Event-Id": eventId },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          this.db.updateDelivery(deliveryId, attempt, "delivered", null);
          return { eventId, delivered: true };
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = String(error);
      }
      this.db.updateDelivery(deliveryId, attempt, attempt === MAX_ATTEMPTS ? "failed" : "retrying", lastError);
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    return { eventId, delivered: false };
  }
}

export const hashBody = (body: unknown) => createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
