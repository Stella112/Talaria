import type { Talaria } from "@talaria-pay/sdk";
import Fastify from "fastify";
import { z } from "zod";
import { execute } from "./execute";
import { understand, type Llm } from "./parser";
import { actionSchema, isReadOnly, preview } from "./schema";

const parseBody = z.object({ command: z.string().min(1).max(500) }).strict();
const executeBody = z.object({ action: actionSchema, confirmed: z.boolean().optional() }).strict();

export function buildAgent(talaria: Talaria, llm?: Llm, fetchImpl?: typeof fetch) {
  const app = Fastify({ logger: false, bodyLimit: 8_192 });
  app.setErrorHandler((error, _request, reply) => reply.code(400).send({ error: (error as Error).message }));

  app.get("/health", async () => ({ ok: true, llm: Boolean(llm) }));

  /** Step 1: command to structured action and preview. Signs nothing. */
  app.post("/parse", async (request, reply) => {
    const body = parseBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Expected { command }" });
    const understood = await understand(body.data.command, llm, fetchImpl);
    if (!understood) return reply.code(422).send({ error: "Command not understood. Nothing was done." });
    return { ...understood, preview: preview(understood.action), needsConfirmation: !isReadOnly(understood.action) };
  });

  /** Step 2: runs a previewed action. Anything that spends must be confirmed. */
  app.post("/execute", async (request, reply) => {
    const body = executeBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid action" });
    if (!isReadOnly(body.data.action) && body.data.confirmed !== true) return reply.code(409).send({ error: "Confirmation required", preview: preview(body.data.action) });
    return { result: await execute(talaria, body.data.action) };
  });

  return app;
}
