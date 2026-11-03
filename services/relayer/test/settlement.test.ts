// Uses a fake chain and in-memory SQLite: this proves the worker logic, not the live network.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { Db } from "../src/db";
import { buildServer } from "../src/server";
import { pollBridgeOut, pollOutcomes, runReleaseKeeper, type SettlementChain } from "../src/settlement";
import { Store } from "../src/store";
import { webhookRegistrationMessage, Webhooks } from "../src/webhooks";

const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const AGENT = "0x99199ce7FcdD889Fc023bE2936d6cf4D8cb9Ff50" as const;

function fake(over: Partial<SettlementChain> = {}): SettlementChain {
  return {
    portaldotHead: vi.fn(async () => 100n),
    protectEvents: vi.fn(async () => []),
    merchantOf: vi.fn(async () => MERCHANT),
    release: vi.fn(async () => TX(50)),
    bridgeOutEvents: vi.fn(async () => []),
    lockboxProcessed: vi.fn(async () => false),
    lockboxRelease: vi.fn(async () => TX(60)),
    ...over,
  };
}

const out = (n: number) => ({ id: TX(n), from: MERCHANT, recipient: AGENT, amount: 5n, destChainId: 84532n, txHash: TX(n + 10) });

describe("pollBridgeOut", () => {
  it("releases each bridge-out once and records its status", async () => {
    const db = new Db();
    const chain = fake({ bridgeOutEvents: vi.fn(async () => [out(1)]) });
    expect(await pollBridgeOut(chain, db, 0n)).toBe(1);
    expect(chain.lockboxRelease).toHaveBeenCalledWith(84532n, TX(1), AGENT, 5n);
    expect(db.bridgeOut(TX(1))).toMatchObject({ status: "completed", dest_tx: TX(60) });
    expect(db.cursor("bridge-out")).toBe(98n);
    db.setCursor("bridge-out", 0n);
    expect(await pollBridgeOut(chain, db, 0n)).toBe(0);
    expect(chain.lockboxRelease).toHaveBeenCalledTimes(1);
  });

  it("trusts the lockbox's own record after a crash", async () => {
    const db = new Db();
    const chain = fake({ bridgeOutEvents: vi.fn(async () => [out(1)]), lockboxProcessed: vi.fn(async () => true) });
    expect(await pollBridgeOut(chain, db, 0n)).toBe(0);
    expect(chain.lockboxRelease).not.toHaveBeenCalled();
    expect(db.bridgeOut(TX(1))?.status).toBe("completed");
  });

  it("keeps the cursor on failure so the range retries", async () => {
    const db = new Db();
    const chain = fake({ bridgeOutEvents: vi.fn(async () => [out(1)]), lockboxRelease: vi.fn(async () => { throw new Error("rpc down"); }) });
    await expect(pollBridgeOut(chain, db, 0n)).rejects.toThrow("rpc down");
    expect(db.cursor("bridge-out")).toBeNull();
    expect(db.bridgeOut(TX(1))?.status).toBe("pending");
  });
});

describe("pollOutcomes", () => {
  const events = (...list: [string, Record<string, unknown>][]) => vi.fn(async () => list.map(([eventName, args], i) => ({ eventName, args, txHash: TX(i + 1) })));

  it("writes positive feedback on release, for the merchant and the paying agent", async () => {
    const db = new Db();
    db.linkIdentity(MERCHANT, 7n, MERCHANT, "0x");
    db.linkIdentity(AGENT, 8n, AGENT, "0x");
    db.setPaymentAgent(1n, AGENT);
    const write = vi.fn(async () => TX(90));
    expect(await pollOutcomes(fake({ protectEvents: events(["PaymentReleased", { id: 1n, amount: 5n }]) }), db, 0n, write, 1)).toBe(2);
    expect(write.mock.calls.map((c) => (c as unknown as unknown[]).slice(0, 3))).toEqual([[7n, 100n, "released"], [8n, 100n, "released"]]);
  });

  it("writes negative feedback only for refunds of 50% or more", async () => {
    const db = new Db();
    db.linkIdentity(MERCHANT, 7n, MERCHANT, "0x");
    const write = vi.fn(async () => TX(90));
    const chain = fake({ protectEvents: events(["PaymentResolved", { id: 1n, refundBps: 4999, refunded: 1n }], ["PaymentResolved", { id: 2n, refundBps: 5000, refunded: 1n }]) });
    expect(await pollOutcomes(chain, db, 0n, write, 1)).toBe(1);
    expect(write.mock.calls[0].slice(0, 3)).toEqual([7n, 0n, "refunded"]);
  });

  it("writes nothing twice when a range is replayed", async () => {
    const db = new Db();
    db.linkIdentity(MERCHANT, 7n, MERCHANT, "0x");
    const write = vi.fn(async () => TX(90));
    const chain = fake({ protectEvents: events(["PaymentReleased", { id: 1n, amount: 5n }]) });
    await pollOutcomes(chain, db, 0n, write, 1);
    db.setCursor("outcomes", 0n);
    await pollOutcomes(chain, db, 0n, write, 1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("skips feedback for unregistered subjects", async () => {
    const write = vi.fn(async () => TX(90));
    expect(await pollOutcomes(fake({ protectEvents: events(["PaymentReleased", { id: 1n, amount: 5n }]) }), new Db(), 0n, write, 1)).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("tracks holds, and a dispute stops the keeper releasing", async () => {
    const db = new Db();
    const write = vi.fn(async () => TX(90));
    await pollOutcomes(fake({ protectEvents: events(["PaymentOpened", { id: 1n, merchant: MERCHANT, buyer: AGENT, amount: 5n, releaseAt: 50 }], ["PaymentOpened", { id: 2n, merchant: MERCHANT, buyer: AGENT, amount: 5n, releaseAt: 500 }], ["PaymentDisputed", { id: 2n, reasonHash: TX(0) }]) }), db, 0n, write, 1);
    expect(db.dueHolds(100)).toEqual([1n]);
    expect(db.dueHolds(1000)).toEqual([1n]);
  });

  it("sends webhooks for what happened", async () => {
    const db = new Db();
    const hooks = new Webhooks(db, { fetch: vi.fn(async () => new Response("")) as any, sleep: async () => undefined });
    hooks.register(MERCHANT, "https://merchant.test/hook");
    await pollOutcomes(fake({ protectEvents: events(["PaymentOpened", { id: 1n, merchant: MERCHANT, buyer: AGENT, amount: 5n, releaseAt: 50 }], ["TrustApplied", { paymentId: 1n, subject: MERCHANT, score: 90, srcChainId: 84532n, srcBlock: 1n }], ["PaymentReleased", { id: 1n, amount: 5n }]) }), db, 0n, vi.fn(async () => TX(90)), 1, hooks);
    expect(db.deliveriesFor(MERCHANT).map((d) => d.type).reverse()).toEqual(["payment.confirmed", "trust.applied", "payment.released"]);
  });
});

describe("runReleaseKeeper", () => {
  it("releases what is due and retries a failure later", async () => {
    const db = new Db();
    db.addHold(1n, 10);
    db.addHold(2n, 20);
    db.addHold(3n, 500);
    const release = vi.fn(async (id: bigint) => {
      if (id === 2n) throw new Error("rpc down");
      return TX(1);
    });
    expect(await runReleaseKeeper(fake({ release }), db, 100)).toBe(1);
    expect(db.dueHolds(100)).toEqual([2n]);
  });
});

describe("webhook registration", () => {
  const stubChain = {} as any;

  it("needs a recent signature from the merchant's wallet", async () => {
    const db = new Db();
    const app = buildServer(stubChain, new Store(), { db, webhooks: new Webhooks(db) });
    const merchant = privateKeyToAccount(generatePrivateKey());
    const stranger = privateKeyToAccount(generatePrivateKey());
    const url = "https://merchant.example/hook";
    const timestamp = Math.floor(Date.now() / 1000);
    const message = webhookRegistrationMessage(merchant.address, url, timestamp);
    const post = async (signer: typeof merchant, ts = timestamp) =>
      app.inject({ method: "POST", url: "/webhooks", payload: { merchant: merchant.address, url, timestamp: ts, signature: await signer.signMessage({ message: webhookRegistrationMessage(merchant.address, url, ts) }) } });
    expect((await post(stranger)).statusCode).toBe(403);
    expect((await post(merchant, timestamp - 1000)).statusCode).toBe(400);
    expect((await post(merchant)).json().secret).toMatch(/^whsec_/);
    void message;
  });

  it("reports bridge status", async () => {
    const db = new Db();
    db.setBridgeOut(TX(1), "completed", TX(2), TX(3));
    const app = buildServer(stubChain, new Store(), { db });
    expect((await app.inject({ url: `/bridge/${TX(1)}` })).json()).toEqual({ status: "completed", sourceTx: TX(2), destTx: TX(3) });
    expect((await app.inject({ url: `/bridge/${TX(9)}` })).statusCode).toBe(404);
  });
});
