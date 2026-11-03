// Uses a stub reader: this checks routing and gating. Real data is checked with a live read.
import { describe, expect, it, vi } from "vitest";
import { buildApi, type ChainReader } from "../src/api";

const reader = {
  latestBlock: vi.fn(async () => ({ number: "1", hash: "0x1", timestamp: 1 })),
  finalizedBlock: vi.fn(async () => ({ number: "1", hash: "0x1", timestamp: 1 })),
  blockTime: vi.fn(async () => ({ sampleBlocks: 10, averageSeconds: 6 })),
  balance: vi.fn(async (address: string) => ({ address, wei: "0" })),
} as unknown as ChainReader;

describe("demo API", () => {
  it("never serves paid data when the rail is not deployed", async () => {
    const app = buildApi(reader, null);
    expect((await app.inject({ url: "/v1/block/latest" })).statusCode).toBe(503);
    expect((await app.inject({ url: "/health" })).json().paywall).toBe("rail not deployed");
    expect(reader.latestBlock).not.toHaveBeenCalled();
  });

  it("answers 402 from the gate and serves data once it passes", async () => {
    let paid = false;
    const gate = async (_: any, reply: any) => {
      if (!paid) return reply.code(402).send({ scheme: "talaria-channel" });
    };
    const app = buildApi(reader, gate);
    expect((await app.inject({ url: "/v1/block-time" })).statusCode).toBe(402);
    paid = true;
    expect((await app.inject({ url: "/v1/block-time" })).json().averageSeconds).toBe(6);
  });

  it("accepts SS58 addresses using the revive mapping and rejects junk", async () => {
    const app = buildApi(reader, async () => undefined);
    const ok = await app.inject({ url: "/v1/balance/5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" });
    expect(ok.json().address.toLowerCase()).toBe("0x9621dde636de098b43efb0fa9b61facfe328f99d");
    expect((await app.inject({ url: "/v1/balance/nope" })).statusCode).toBe(400);
  });
});
