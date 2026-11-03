// Uses an in-memory fake chain: this proves the worker logic, not the live network.
import { describe, expect, it, vi } from "vitest";
import { SpendLimitError, type Chain } from "../src/chain";
import { buildServer } from "../src/server";
import { Db } from "../src/db";
import { Store } from "../src/store";
import { Webhooks } from "../src/webhooks";
import { pollBridge, runKeeper, settleVouchers } from "../src/workers";

const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

function fake(overrides: Partial<Chain> = {}): Chain {
  return {
    lockedEvents: vi.fn(async () => []),
    sourceHead: vi.fn(async () => 100n),
    bridgeProcessed: vi.fn(async () => false),
    credit: vi.fn(async () => TX(900)),
    execute: vi.fn(async () => TX(901)),
    depositWithPermit: vi.fn(async () => TX(902)),
    subscriptionCount: vi.fn(async () => 0),
    dueSubscription: vi.fn(async () => false),
    charge: vi.fn(async () => TX(903)),
    redeemBatch: vi.fn(async () => TX(904)),
    ...overrides,
  };
}

const lock = (n: number) => ({ payer: ADDR, recipient: ADDR, amount: 5n, intentRef: TX(0), txHash: TX(n) });

describe("pollBridge", () => {
  it("credits each lock once across polls", async () => {
    const store = new Store();
    const chain = fake({ lockedEvents: vi.fn(async () => [lock(1), lock(2)]) });
    expect(await pollBridge(chain, store, 0n)).toBe(2);
    expect(store.cursor).toBe(98n); // head minus confirmations
    expect(await pollBridge(chain, store, 0n)).toBe(0);
    expect(chain.credit).toHaveBeenCalledTimes(2);
  });

  it("does not re-credit after a crash when the chain already processed it", async () => {
    const store = new Store();
    store.set("bridge", TX(1), { status: "submitting" });
    const chain = fake({ lockedEvents: vi.fn(async () => [lock(1)]), bridgeProcessed: vi.fn(async () => true) });
    expect(await pollBridge(chain, store, 0n)).toBe(0);
    expect(chain.credit).not.toHaveBeenCalled();
    expect(store.get("bridge", TX(1))?.status).toBe("done");
  });

  it("keeps the cursor when a credit fails, so the range retries", async () => {
    const store = new Store();
    const chain = fake({ lockedEvents: vi.fn(async () => [lock(1)]), credit: vi.fn(async () => { throw new Error("rpc down"); }) });
    await expect(pollBridge(chain, store, 0n)).rejects.toThrow("rpc down");
    expect(store.cursor).toBeNull();
  });

  it("scans long gaps in bounded ranges", async () => {
    const store = new Store();
    const lockedEvents = vi.fn(async () => []);
    await pollBridge(fake({ sourceHead: vi.fn(async () => 10_000n), lockedEvents }), store, 0n);
    expect(lockedEvents).toHaveBeenCalledWith(0n, 1_999n);
  });
});

describe("runKeeper", () => {
  it("charges only due subscriptions and survives a failure", async () => {
    const chain = fake({
      subscriptionCount: vi.fn(async () => 3),
      dueSubscription: vi.fn(async (id: number) => id !== 2),
      charge: vi.fn(async (id: number) => {
        if (id === 1) throw new Error("no funds");
        return TX(id);
      }),
    });
    expect(await runKeeper(chain)).toBe(1);
    expect(chain.charge).toHaveBeenCalledTimes(2);
  });
});

describe("settleVouchers", () => {
  const voucher = (channelId: string, cumulativeAmount: string) => ({ channelId, cumulativeAmount, nonce: "1", v: 27, r: TX(1), s: TX(2) });

  it("redeems only the latest voucher per channel, then clears them", async () => {
    const store = new Store();
    store.putVoucher(voucher("1", "10"));
    store.putVoucher(voucher("1", "30"));
    expect(store.putVoucher(voucher("1", "20"))).toBe(false);
    store.putVoucher(voucher("2", "5"));
    const chain = fake();
    expect(await settleVouchers(chain, store)).toBe(2);
    expect((chain.redeemBatch as any).mock.calls[0][0].map((v: any) => v.cumulativeAmount)).toEqual(["30", "5"]);
    expect(store.vouchers()).toEqual([]);
  });

  it("keeps vouchers when redeeming fails, and sends nothing when empty", async () => {
    const store = new Store();
    const chain = fake({ redeemBatch: vi.fn(async () => { throw new Error("revert"); }) });
    expect(await settleVouchers(chain, store)).toBe(0);
    store.putVoucher(voucher("1", "10"));
    await expect(settleVouchers(chain, store)).rejects.toThrow("revert");
    expect(store.vouchers().length).toBe(1);
  });
});

describe("spend guard", () => {
  it("refuses sends past the hourly limit and frees them after an hour", () => {
    const store = new Store();
    expect(store.takeSendSlot(2, 0)).toBe(true);
    expect(store.takeSendSlot(2, 1)).toBe(true);
    expect(store.takeSendSlot(2, 2)).toBe(false);
    expect(store.takeSendSlot(2, 3_600_001)).toBe(true);
  });
});

describe("HTTP API", () => {
  const body = {
    intent: { rail: 1, owner: ADDR, signer: ADDR, payee: ADDR, amount: "5", ref: TX(1), nonce: "0", deadline: "99" },
    v: 27,
    r: TX(2),
    s: TX(3),
  };

  it("submits once and returns the same hash on retry", async () => {
    const chain = fake();
    const app = buildServer(chain, new Store());
    const first = await app.inject({ method: "POST", url: "/intents", payload: body });
    const second = await app.inject({ method: "POST", url: "/intents", payload: body });
    expect(first.json().txHash).toBe(TX(901));
    expect(second.json().txHash).toBe(TX(901));
    expect(chain.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed input and any private key field", async () => {
    const chain = fake();
    const app = buildServer(chain, new Store());
    const bad = await app.inject({ method: "POST", url: "/intents", payload: { ...body, r: "0x12" } });
    expect(bad.statusCode).toBe(400);
    const key = await app.inject({ method: "POST", url: "/intents", payload: { ...body, privateKey: TX(1) } });
    expect(key.statusCode).toBe(400);
    expect(chain.execute).not.toHaveBeenCalled();
  });

  it("allows a retry after failure, and reports spend limits as 429", async () => {
    let calls = 0;
    const chain = fake({
      execute: vi.fn(async () => {
        if (++calls === 1) throw new Error("revert");
        if (calls === 2) throw new SpendLimitError("limit");
        return TX(5);
      }),
    });
    const app = buildServer(chain, new Store());
    expect((await app.inject({ method: "POST", url: "/intents", payload: body })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/intents", payload: body })).statusCode).toBe(429);
    expect((await app.inject({ method: "POST", url: "/intents", payload: body })).json().txHash).toBe(TX(5));
  });

  it("validates vouchers", async () => {
    const store = new Store();
    const app = buildServer(fake(), store);
    const ok = await app.inject({ method: "POST", url: "/vouchers", payload: { channelId: "1", cumulativeAmount: "5", nonce: "1", v: 27, r: TX(1), s: TX(2) } });
    expect(ok.json().queued).toBe(true);
    const bad = await app.inject({ method: "POST", url: "/vouchers", payload: { channelId: "x" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("Idempotency-Key", () => {
  const body = {
    intent: { rail: 1, owner: ADDR, signer: ADDR, payee: ADDR, amount: "5", ref: TX(1), nonce: "0", deadline: "99" },
    v: 27,
    r: TX(2),
    s: TX(3),
  };

  it("replays the stored response, and conflicts on a different body", async () => {
    const chain = fake();
    const app = buildServer(chain, new Store(), { db: new Db() });
    const headers = { "idempotency-key": "abc" };
    const first = await app.inject({ method: "POST", url: "/intents", headers, payload: body });
    const second = await app.inject({ method: "POST", url: "/intents", headers, payload: body });
    expect(second.json()).toEqual(first.json());
    expect(chain.execute).toHaveBeenCalledTimes(1);
    const other = await app.inject({ method: "POST", url: "/intents", headers, payload: { ...body, v: 28 } });
    expect(other.statusCode).toBe(409);
    expect(chain.execute).toHaveBeenCalledTimes(1);
  });

  it("does not store a failure, so the same key can retry", async () => {
    let calls = 0;
    const chain = fake({ execute: vi.fn(async () => { if (++calls === 1) throw new Error("revert"); return TX(9); }) });
    const app = buildServer(chain, new Store(), { db: new Db() });
    const headers = { "idempotency-key": "abc" };
    expect((await app.inject({ method: "POST", url: "/intents", headers, payload: body })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/intents", headers, payload: body })).json().txHash).toBe(TX(9));
  });
});

describe("webhook routes", () => {
  it("registers once with a secret, and refuses private URLs", async () => {
    const db = new Db();
    const app = buildServer(fake(), new Store(), { db, webhooks: new Webhooks(db) });
    const ok = await app.inject({ method: "POST", url: "/webhooks", payload: { merchant: ADDR, url: "https://merchant.example/hook" } });
    expect(ok.json().secret).toMatch(/^whsec_/);
    const bad = await app.inject({ method: "POST", url: "/webhooks", payload: { merchant: ADDR, url: "http://169.254.169.254/" } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ url: `/webhooks/${ADDR}/deliveries` })).json().deliveries).toEqual([]);
  });
});
