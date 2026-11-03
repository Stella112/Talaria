import Fastify from "fastify";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { SpendLimitError, type Chain } from "./chain";
import type { Db } from "./db";
import type { Store } from "./store";
import type { TrustService } from "./trust";
import { hashBody, isAllowedWebhookUrl, type Webhooks } from "./webhooks";

const hex = (bytes: number) => z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`));
const address = hex(20).transform((x) => x as Address);
const bytes32 = hex(32).transform((x) => x as Hex);
const uint = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((x) => BigInt(x));

const intentBody = z
  .object({
    intent: z.object({
      rail: z.number().int().min(0).max(255),
      owner: address,
      signer: address,
      payee: address,
      amount: uint,
      ref: bytes32,
      nonce: uint,
      deadline: uint,
    }),
    v: z.number().int(),
    r: bytes32,
    s: bytes32,
  })
  .strict();

const depositBody = z.object({ from: address, amount: uint, deadline: uint, v: z.number().int(), r: bytes32, s: bytes32 }).strict();

const voucherBody = z
  .object({ channelId: z.string().regex(/^\d+$/), cumulativeAmount: z.string().regex(/^\d+$/), nonce: z.string().regex(/^\d+$/), v: z.number().int(), r: bytes32, s: bytes32 })
  .strict();

const linkBody = z.object({ subject: address, agentId: uint, signature: z.string().regex(/^0x[0-9a-fA-F]+$/).transform((x) => x as Hex) }).strict();
const webhookBody = z.object({ merchant: address, url: z.string().url() }).strict();

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export type Extras = { db: Db; trust?: TrustService; webhooks?: Webhooks; allowLocalWebhooks?: boolean };

export function buildServer(chain: Chain, store: Store, extras?: Extras) {
  const app = Fastify({ logger: false, bodyLimit: 16_384 });

  app.setErrorHandler((error, _request, reply) => {
    const limited = error instanceof SpendLimitError;
    reply.code(limited ? 429 : 400).send({ error: (error as Error).message });
  });

  app.get("/health", async () => ({ ok: true }));

  /** Same key and body returns the stored response. Same key with a different body is a conflict. */
  async function idempotent(request: any, reply: any, run: () => Promise<unknown>) {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !extras) return run();
    const bodyHash = hashBody(request.body);
    const stored = extras.db.idempotent(key);
    if (stored) {
      if (stored.body_hash !== bodyHash) return reply.code(409).send({ error: "This Idempotency-Key was used with a different body" });
      return reply.code(stored.status).send(JSON.parse(stored.response));
    }
    const result = await run();
    if (!reply.sent && result !== reply) extras.db.saveIdempotent(key, bodyHash, 200, JSON.stringify(result));
    return result;
  }

  /** Same signature, same result: a retry never pays twice. */
  async function once(key: string, send: () => Promise<Hex>, reply: any) {
    const previous = store.get("intents", key);
    if (previous?.status === "done") return { txHash: previous.txHash };
    if (previous?.status === "submitting") return reply.code(409).send({ error: "already being submitted; check again shortly" });
    store.set("intents", key, { status: "submitting" });
    try {
      const txHash = await send();
      store.set("intents", key, { status: "done", txHash });
      return { txHash };
    } catch (error) {
      // Nothing confirmed on-chain, and the contract nonce blocks a double spend if it did land.
      store.clear("intents", key);
      throw error;
    }
  }

  app.post("/intents", async (request, reply) => {
    const parsed = intentBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid intent" });
    const key = keccak256(toHex(`${parsed.data.r}${parsed.data.s}${parsed.data.v}`));
    return idempotent(request, reply, () => once(key, () => chain.execute(parsed.data), reply));
  });

  app.post("/deposits", async (request, reply) => {
    const parsed = depositBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid deposit" });
    const key = keccak256(toHex(`${parsed.data.r}${parsed.data.s}${parsed.data.v}`));
    return idempotent(request, reply, () => once(key, () => chain.depositWithPermit(parsed.data), reply));
  });

  /** Queues a voucher for the next settlement batch. Signatures are checked when redeemed. */
  app.post("/vouchers", async (request, reply) => {
    const parsed = voucherBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid voucher" });
    return { queued: store.putVoucher(parsed.data) };
  });

  if (extras?.trust) {
    const trust = extras.trust;
    app.get<{ Params: { subject: string } }>("/trust/:subject", async (request, reply) => {
      const subject = address.safeParse(request.params.subject);
      if (!subject.success) return reply.code(400).send({ error: "Expected a 0x address" });
      return json(await trust.getTrust(subject.data));
    });
    app.post("/identity/link", async (request, reply) => {
      const body = linkBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected { subject, agentId, signature }" });
      await trust.linkIdentity(body.data.subject, body.data.agentId, body.data.signature);
      return { linked: true };
    });
  }

  if (extras?.webhooks) {
    const webhooks = extras.webhooks;
    // Returns the secret once. Anyone can register a URL for any merchant here, so production needs merchant auth.
    app.post("/webhooks", async (request, reply) => {
      const body = webhookBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected { merchant, url }" });
      if (!isAllowedWebhookUrl(body.data.url, extras.allowLocalWebhooks)) return reply.code(400).send({ error: "That webhook URL is not allowed" });
      return { secret: webhooks.register(body.data.merchant, body.data.url) };
    });
    app.get<{ Params: { merchant: string } }>("/webhooks/:merchant/deliveries", async (request) => ({ deliveries: extras.db.deliveriesFor(request.params.merchant) }));
  }

  return app;
}
