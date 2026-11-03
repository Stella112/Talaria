import Fastify from "fastify";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { SpendLimitError, type Chain } from "./chain";
import type { Store } from "./store";

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

export function buildServer(chain: Chain, store: Store) {
  const app = Fastify({ logger: false, bodyLimit: 16_384 });

  app.setErrorHandler((error, _request, reply) => {
    const limited = error instanceof SpendLimitError;
    reply.code(limited ? 429 : 400).send({ error: (error as Error).message });
  });

  app.get("/health", async () => ({ ok: true }));

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
    return once(key, () => chain.execute(parsed.data), reply);
  });

  app.post("/deposits", async (request, reply) => {
    const parsed = depositBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid deposit" });
    const key = keccak256(toHex(`${parsed.data.r}${parsed.data.s}${parsed.data.v}`));
    return once(key, () => chain.depositWithPermit(parsed.data), reply);
  });

  /** Queues a voucher for the next settlement batch. Signatures are checked when redeemed. */
  app.post("/vouchers", async (request, reply) => {
    const parsed = voucherBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid voucher" });
    return { queued: store.putVoucher(parsed.data) };
  });

  return app;
}
