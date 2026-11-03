import type { Talaria } from "@talaria-pay/sdk";
import Fastify from "fastify";
import { z } from "zod";
import { execute, type HostedContext } from "./execute";
import { RateLimiter } from "./limits";
import { understand, type Llm } from "./parser";
import type { Action } from "./schema";
import { actionSchema, isReadOnly, preview } from "./schema";

const parseBody = z.object({ command: z.string().min(1).max(500) }).strict();
const executeBody = z.object({ action: actionSchema, confirmed: z.boolean().optional() }).strict();

const rateBody = z.object({ paymentId: z.string().regex(/^\d+$/), stars: z.number().int().min(1).max(5) }).strict();

export type AgentOptions = {
  hosted?: HostedContext;
  /** Public description served at /.well-known/agent-card.json. */
  card?: Record<string, unknown>;
  /** Writes a judge's rating from the demo client wallet. Must only accept settled payments. */
  rate?: (paymentId: bigint, stars: number) => Promise<string>;
  limits?: { parse: RateLimiter; execute: RateLimiter };
};

export function buildAgent(talaria: Talaria, llm?: Llm | ((command: string) => Promise<Action | null>), fetchImpl?: typeof fetch, options: AgentOptions = {}) {
  // Only trust forwarded addresses behind a known proxy, or anyone could fake an IP to dodge the limits.
  const app = Fastify({ logger: false, bodyLimit: 8_192, trustProxy: process.env.TRUST_PROXY === "1" });
  const limits = options.limits ?? { parse: new RateLimiter(60, 3_600_000), execute: new RateLimiter(10, 3_600_000) };
  const rated = new Set<string>();
  app.setErrorHandler((error, _request, reply) => reply.code(400).send({ error: (error as Error).message }));

  app.get("/health", async () => ({ ok: true, llm: Boolean(llm) }));
  if (options.card) app.get("/.well-known/agent-card.json", async () => options.card);

  /** Step 1: command to structured action and preview. Signs nothing. */
  app.post("/parse", async (request, reply) => {
    if (!limits.parse.allow(request.ip)) return reply.code(429).send({ error: "Too many requests from this address. Try again later." });
    const body = parseBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Expected { command }" });
    const understood = await understand(body.data.command, llm, fetchImpl);
    if (!understood) return reply.code(422).send({ error: "Command not understood. Nothing was done." });
    return { ...understood, preview: preview(understood.action), needsConfirmation: !isReadOnly(understood.action) };
  });

  /** Step 2: runs a previewed action. Anything that spends must be confirmed. */
  app.post("/execute", async (request, reply) => {
    const body = executeBody.safeParse(request.body);
    if (body.success && !isReadOnly(body.data.action) && !limits.execute.allow(request.ip)) return reply.code(429).send({ error: "This address has used its demo actions for now. Try again later." });
    if (!body.success) return reply.code(400).send({ error: "Invalid action" });
    if (!isReadOnly(body.data.action) && body.data.confirmed !== true) return reply.code(409).send({ error: "Confirmation required", preview: preview(body.data.action) });
    return { result: await execute(talaria, body.data.action, options.hosted) };
  });

  /** Demo-client feedback: one rating per settled payment, labeled as demo feedback on-chain. */
  if (options.rate) {
    const rate = options.rate;
    app.post("/rate", async (request, reply) => {
      const body = rateBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected { paymentId, stars }" });
      if (!limits.execute.allow(request.ip)) return reply.code(429).send({ error: "Too many requests from this address. Try again later." });
      if (rated.has(body.data.paymentId)) return reply.code(409).send({ error: "This job has already been rated" });
      const baseTx = await rate(BigInt(body.data.paymentId), body.data.stars);
      rated.add(body.data.paymentId);
      return { baseTx, label: "demo-client feedback" };
    });
  }

  return app;
}
