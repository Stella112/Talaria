import { utils } from "@talaria-pay/sdk";
import Fastify from "fastify";
import type { Address, PublicClient } from "viem";
import { isAddress } from "viem";

const SAMPLE_BLOCKS = 10n;

/** Reads real chain data. Nothing here is cached or simulated. */
export function chainReader(client: PublicClient) {
  return {
    async latestBlock() {
      const block = await client.getBlock();
      return { number: block.number.toString(), hash: block.hash, timestamp: Number(block.timestamp) };
    },
    async finalizedBlock() {
      const block = await client.getBlock({ blockTag: "finalized" });
      return { number: block.number.toString(), hash: block.hash, timestamp: Number(block.timestamp) };
    },
    async blockTime() {
      const latest = await client.getBlock();
      const earlier = await client.getBlock({ blockNumber: latest.number - SAMPLE_BLOCKS });
      return { sampleBlocks: Number(SAMPLE_BLOCKS), averageSeconds: Number(latest.timestamp - earlier.timestamp) / Number(SAMPLE_BLOCKS) };
    },
    async balance(address: Address) {
      return { address, wei: (await client.getBalance({ address })).toString() };
    },
  };
}

export type ChainReader = ReturnType<typeof chainReader>;
/** Fastify preHandler from `talaria.paywall().fastify()`, or null when the rail is not deployed. */
export type Gate = ((request: any, reply: any) => Promise<unknown>) | null;

export function buildApi(reader: ChainReader, gate: Gate) {
  const app = Fastify({ logger: false });

  const preHandler = async (request: any, reply: any) => {
    if (!gate) return reply.code(503).send({ error: "The pay-per-call rail is not deployed on this network, so paid routes are unavailable" });
    return gate(request, reply);
  };

  app.get("/health", async () => ({ ok: true, paywall: gate ? "active" : "rail not deployed" }));
  app.get("/v1/block/latest", { preHandler }, () => reader.latestBlock());
  app.get("/v1/block/finalized", { preHandler }, () => reader.finalizedBlock());
  app.get("/v1/block-time", { preHandler }, () => reader.blockTime());
  app.get<{ Params: { account: string } }>("/v1/balance/:account", { preHandler }, async (request, reply) => {
    const { account } = request.params;
    try {
      return await reader.balance(isAddress(account) ? account : utils.ss58ToH160(account));
    } catch {
      return reply.code(400).send({ error: "Expected a 0x address or an SS58 address" });
    }
  });

  return app;
}
