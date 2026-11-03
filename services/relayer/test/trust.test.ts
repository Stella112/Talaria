// Uses in-memory SQLite and a stubbed Base client. A real read is checked separately.
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { Db } from "../src/db";
import { linkMessage, scoreFrom, tierOf, TrustService, writeOutcome } from "../src/trust";
import { hashBody, isAllowedWebhookUrl, signWebhook, Webhooks } from "../src/webhooks";
import { paymentStatus, verifyWebhook } from "../../../packages/sdk/src/webhooks";

const SUBJECT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PROTECT = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const CLIENT = "0x99199ce7FcdD889Fc023bE2936d6cf4D8cb9Ff50" as Address;
const TX = `0x${"ab".repeat(32)}` as Hex;

describe("scoreFrom", () => {
  it.each([
    [0n, 0n, 0, 0],
    [3n, 100n, 0, 100],
    [4n, 75n, 0, 75],
    [3n, 6666n, 2, 66],
    [3n, -5n, 0, 0],
    [3n, 250n, 0, 100],
  ])("count %s value %s decimals %s scores %s", (count, value, decimals, expected) => {
    expect(scoreFrom(count, value, decimals)).toBe(expected);
  });
});

describe("tierOf matches the contract's boundaries", () => {
  it.each([
    [100, 3, "trusted"],
    [80, 3, "trusted"],
    [79, 3, "established"],
    [50, 3, "established"],
    [49, 3, "new"],
    [100, 2, "new"],
    [0, 0, "new"],
  ] as const)("score %s with %s feedbacks is %s", (score, count, tier) => {
    expect(tierOf(score, count)).toBe(tier);
  });
});

function service(summary: readonly [bigint, bigint, number] = [5n, 100n, 0], owner?: Address) {
  const db = new Db();
  const attester = privateKeyToAccount(generatePrivateKey());
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => (functionName === "ownerOf" ? owner : summary));
  const base = { getBlockNumber: vi.fn(async () => 1234n), readContract } as any;
  const trust = new TrustService({ base, db, attester, settlementClient: CLIENT, protect: PROTECT, portaldotChainId: 420420777, srcChainId: 84532n, now: () => 1000 });
  return { db, attester, trust, readContract };
}

describe("TrustService", () => {
  it("treats an unregistered subject as New and attests nothing", async () => {
    const { trust, readContract } = service();
    expect((await trust.getTrust(SUBJECT)).tier).toBe("new");
    expect(await trust.attest(SUBJECT)).toBeNull();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("links only with a signature from the agent's owner", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const { trust, db } = service(undefined, owner.address);
    const stranger = privateKeyToAccount(generatePrivateKey());
    await expect(trust.linkIdentity(SUBJECT, 7n, await stranger.signMessage({ message: linkMessage(SUBJECT, 7n) }))).rejects.toThrow("owns this agent");
    expect(db.identityOf(SUBJECT)).toBeNull();
    await trust.linkIdentity(SUBJECT, 7n, await owner.signMessage({ message: linkMessage(SUBJECT, 7n) }));
    expect(db.identityOf(SUBJECT)).toBe(7n);
  });

  it("reads only the settlement client's feedback, at a fixed block", async () => {
    const { trust, db, readContract } = service();
    db.linkIdentity(SUBJECT, 7n, SUBJECT, "0x");
    const view = await trust.getTrust(SUBJECT);
    expect(view).toMatchObject({ score: 100, feedbackCount: 5, tier: "trusted", srcBlock: 1234n });
    expect(readContract.mock.calls[0][0]).toMatchObject({ args: [7n, [CLIENT], "talaria-settlement", ""], blockNumber: 1234n });
  });

  it("signs an attestation that recovers to the attester, with rising nonces and a short expiry", async () => {
    const { trust, db, attester } = service();
    db.linkIdentity(SUBJECT, 7n, SUBJECT, "0x");
    const first = (await trust.attest(SUBJECT))!;
    const second = (await trust.attest(SUBJECT))!;
    expect(first.attestation.nonce).toBe(0n);
    expect(second.attestation.nonce).toBe(1n);
    expect(first.attestation.expiry).toBe(1600n);
    const { r, s, v } = first.sig;
    const recovered = await recoverTypedDataAddress({
      domain: { name: "TalariaProtect", version: "1", chainId: 420420777, verifyingContract: PROTECT },
      types: {
        TrustAttestation: [
          { name: "subject", type: "address" },
          { name: "agentId", type: "uint256" },
          { name: "score", type: "uint8" },
          { name: "feedbackCount", type: "uint32" },
          { name: "srcChainId", type: "uint256" },
          { name: "srcBlock", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "TrustAttestation",
      message: first.attestation,
      signature: `${r}${s.slice(2)}${v.toString(16)}` as Hex,
    });
    expect(recovered).toBe(attester.address);
  });
});

describe("writeOutcome", () => {
  const outcome = { paymentId: 1n, agentId: 7n, result: "released" as const, portaldotTx: TX };

  it("writes exactly once per outcome, with a reference to the Portaldot payment", async () => {
    const db = new Db();
    const write = vi.fn(async () => TX);
    expect(await writeOutcome(db, write, outcome, 420420777)).toMatchObject({ written: true });
    expect(await writeOutcome(db, write, outcome, 420420777)).toMatchObject({ written: false, txHash: TX });
    expect(write).toHaveBeenCalledTimes(1);
    const [agentId, value, tag2, uri] = write.mock.calls[0] as unknown as [bigint, bigint, string, string];
    expect([agentId, value, tag2]).toEqual([7n, 100n, "released"]);
    expect(uri).toContain(TX);
    expect(db.countFeedback()).toBe(1);
  });

  it("scores a refund as 0, and treats it as a separate outcome", async () => {
    const db = new Db();
    const write = vi.fn(async () => TX);
    await writeOutcome(db, write, outcome, 420420777);
    await writeOutcome(db, write, { ...outcome, result: "refunded" }, 420420777);
    expect((write.mock.calls[1] as unknown[])[1]).toBe(0n);
  });

  it("refuses feedback with no settled Portaldot transaction", async () => {
    const write = vi.fn(async () => TX);
    await expect(writeOutcome(new Db(), write, { ...outcome, portaldotTx: "0x" }, 420420777)).rejects.toThrow("settled");
    expect(write).not.toHaveBeenCalled();
  });

  it("allows a retry after a failure", async () => {
    const db = new Db();
    const write = vi.fn<() => Promise<Hex>>().mockRejectedValueOnce(new Error("Self-feedback not allowed")).mockResolvedValueOnce(TX);
    await expect(writeOutcome(db, write as any, outcome, 420420777)).rejects.toThrow("Self-feedback");
    expect((await writeOutcome(db, write as any, outcome, 420420777)).written).toBe(true);
  });
});

describe("webhooks", () => {
  const MERCHANT = SUBJECT;

  function setup(responses: (number | Error)[]) {
    const db = new Db();
    const send = vi.fn(async () => {
      const next = responses.shift() ?? 200;
      if (next instanceof Error) throw next;
      return new Response("", { status: next });
    });
    const sleep = vi.fn(async () => undefined);
    const hooks = new Webhooks(db, { fetch: send as any, sleep, now: () => 5000 });
    const secret = hooks.register(MERCHANT, "https://merchant.test/hook");
    return { db, send, sleep, hooks, secret };
  }

  it("signs events so the SDK can verify them, and logs the delivery", async () => {
    const { db, send, hooks, secret } = setup([200]);
    const result = await hooks.emit(MERCHANT, "payment.released", { id: 1n });
    expect(result?.delivered).toBe(true);
    const init = (send.mock.calls[0] as unknown as [string, RequestInit])[1];
    const header = (init.headers as Record<string, string>)["Talaria-Signature"];
    expect(await verifyWebhook(init.body as string, header, secret, { now: 5000 })).toBe(true);
    expect(await verifyWebhook(`${init.body} `, header, secret, { now: 5000 })).toBe(false);
    expect(await verifyWebhook(init.body as string, header, "wrong", { now: 5000 })).toBe(false);
    expect(await verifyWebhook(init.body as string, header, secret, { now: 9000 })).toBe(false);
    expect(await verifyWebhook(init.body as string, null, secret)).toBe(false);
    expect(db.deliveriesFor(MERCHANT)[0]).toMatchObject({ status: "delivered", attempts: 1 });
    expect(JSON.parse(init.body as string).data.id).toBe("1");
  });

  it("retries 5 times with exponential backoff, keeping one event id", async () => {
    const { db, send, sleep, hooks } = setup([500, new Error("offline"), 500, 500, 500]);
    expect((await hooks.emit(MERCHANT, "payment.failed", {}))?.delivered).toBe(false);
    expect(send).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([1000, 2000, 4000, 8000]);
    const ids = send.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)["Talaria-Event-Id"]);
    expect(new Set(ids).size).toBe(1);
    expect(db.deliveriesFor(MERCHANT)[0]).toMatchObject({ status: "failed", attempts: 5, last_error: "HTTP 500" });
  });

  it("recovers on a later attempt, and does nothing with no webhook registered", async () => {
    const { hooks } = setup([500, 200]);
    expect((await hooks.emit(MERCHANT, "payment.released", {}))?.delivered).toBe(true);
    expect(await hooks.emit(CLIENT, "payment.released", {})).toBeNull();
  });

  it("blocks private and non-HTTP URLs", () => {
    expect(isAllowedWebhookUrl("https://merchant.example/hook")).toBe(true);
    for (const url of ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.1", "http://192.168.1.1", "http://169.254.169.254/latest", "ftp://x.example", "nope"]) {
      expect(isAllowedWebhookUrl(url)).toBe(false);
    }
  });

  it("produces stable signatures and body hashes", () => {
    expect(signWebhook("s", 1, "b")).toBe(signWebhook("s", 1, "b"));
    expect(hashBody({ a: 1 })).toBe(hashBody({ a: 1 }));
    expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 2 }));
  });
});

describe("paymentStatus", () => {
  it.each([
    [1, 0n, "held"],
    [1, 5n, "partially_refunded"],
    [2, 0n, "disputed"],
    [3, 0n, "released"],
    [3, 5n, "partially_refunded"],
    [4, 10n, "refunded"],
    [5, 3n, "resolved"],
  ] as const)("stored %s with %s refunded is %s", (stored, refunded, expected) => {
    expect(paymentStatus(stored, refunded)).toBe(expected);
  });
});
