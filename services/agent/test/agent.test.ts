import { describe, expect, it, vi } from "vitest";
import { parseCommand, understand } from "../src/parser";
import { anthropicParser } from "../src/anthropic";
import { limitsFromEnv, RateLimiter } from "../src/limits";
import { buildAgent } from "../src/server";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("rule parser", () => {
  const cases: [string, object][] = [
    ["pay invoice 12", { action: "pay_invoice", invoiceId: "12" }],
    ["Pay invoice #12", { action: "pay_invoice", invoiceId: "12" }],
    ["create an invoice for $5.50 for coffee", { action: "create_checkout", amount: "5.50", memo: "coffee" }],
    ["subscribe to plan 3", { action: "subscribe", planId: "3" }],
    ["cancel subscription 3", { action: "cancel_subscription", subId: "3" }],
    [`stream 100 tusd per month to ${A} with deposit 10`, { action: "start_stream", ratePerMonth: "100", to: A, deposit: "10" }],
    ["stop stream 2", { action: "stop_stream", streamId: "2" }],
    ["fetch https://api.example.com/v1/block max 0.01", { action: "paid_fetch", url: "https://api.example.com/v1/block", maxPrice: "0.01" }],
    [`send 5 usd to ${A}`, { action: "send_remit", amount: "5", to: A }],
    ["send 5 as a claim link", { action: "send_remit", amount: "5" }],
    ["show my balance", { action: "get_balance" }],
    ["list receipts", { action: "get_receipts" }],
    ["what is my policy?", { action: "get_policy" }],
  ];
  it.each(cases)("%s", (text, expected) => expect(parseCommand(text)).toEqual(expected));

  it.each(["pay the guy", "send money to bob", "send 5 to 0x123", "pay invoice twelve", "send 1.1234567 to link", ""])("refuses to guess: %s", (text) => {
    expect(parseCommand(text)).toBeNull();
  });
});

describe("optional LLM", () => {
  const llm = { baseUrl: "http://llm.test", apiKey: "test", model: "test" };
  const reply = (content: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }))) as unknown as typeof fetch;

  it("is not called when rules match", async () => {
    const fetchImpl = reply("{}");
    expect((await understand("pay invoice 1", llm, fetchImpl))?.source).toBe("rules");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is used for free text and validated", async () => {
    const result = await understand("settle up invoice number nine", llm, reply('{"action":"pay_invoice","invoiceId":"9"}'));
    expect(result).toEqual({ action: { action: "pay_invoice", invoiceId: "9" }, source: "llm" });
  });

  it.each([
    ['{"action":"unknown"}'],
    ["not json"],
    ['{"action":"pay_invoice","invoiceId":"9","privateKey":"0x1"}'],
    ['{"action":"send_remit","amount":"lots"}'],
  ])("rejects invalid output: %s", async (content) => {
    expect(await understand("do something", llm, reply(content))).toBeNull();
  });

  it("does not fail when the provider is down", async () => {
    const down = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await understand("do something", llm, down)).toBeNull();
  });
});

describe("agent API", () => {
  const talaria = { payInvoice: vi.fn(async () => "0xabc"), getBalance: vi.fn(async () => 5n) } as any;

  it("previews without acting", async () => {
    const app = buildAgent(talaria);
    const res = await app.inject({ method: "POST", url: "/parse", payload: { command: "pay invoice 7" } });
    expect(res.json().preview).toBe("Pay invoice #7");
    expect(res.json().needsConfirmation).toBe(true);
    expect(talaria.payInvoice).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST", url: "/parse", payload: { command: "gibberish" } })).statusCode).toBe(422);
  });

  it("requires confirmation to spend, not to read", async () => {
    const app = buildAgent(talaria);
    const action = { action: "pay_invoice", invoiceId: "7" };
    expect((await app.inject({ method: "POST", url: "/execute", payload: { action } })).statusCode).toBe(409);
    expect(talaria.payInvoice).not.toHaveBeenCalled();
    const done = await app.inject({ method: "POST", url: "/execute", payload: { action, confirmed: true } });
    expect(done.json().result.txHash).toBe("0xabc");
    const read = await app.inject({ method: "POST", url: "/execute", payload: { action: { action: "get_balance" } } });
    expect(read.json().result.baseUnits).toBe("5");
  });

  it("rejects private keys in input", async () => {
    const app = buildAgent(talaria);
    const res = await app.inject({ method: "POST", url: "/execute", payload: { action: { action: "get_balance", privateKey: "0x1" } } });
    expect(res.statusCode).toBe(400);
  });
});

describe("hosted agent", () => {
  const COFFEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const fresh = () => ({ parse: new RateLimiter(100, 1000), execute: new RateLimiter(100, 1000) });

  function setup(limits = fresh()) {
    const agent = { account: { address: "0x99199ce7FcdD889Fc023bE2936d6cf4D8cb9Ff50" }, payWithMandate: vi.fn(async () => ({ txHash: "0xabc", paymentId: "4" })), getTrust: vi.fn(async () => ({ score: 90, tier: "trusted" })) } as any;
    const buyer = { createMandate: vi.fn(async () => ({ mandate: {} })), dispute: vi.fn(async () => "0xdef") } as any;
    const rate = vi.fn(async () => "0xfeed");
    const app = buildAgent(agent, undefined, undefined, { hosted: { buyer, merchants: { "trusted coffee": COFFEE as any } }, card: { name: "Talaria Autopilot" }, rate, limits });
    return { app, agent, buyer, rate };
  }

  it.each([
    ["buy 2 tusd from Trusted Coffee", { action: "buy", amount: "2", merchant: "trusted coffee" }],
    ["buy $2.50 from new shop", { action: "buy", amount: "2.50", merchant: "new shop" }],
    ["dispute payment 4", { action: "dispute_payment", paymentId: "4" }],
    ["show trust of new shop", { action: "get_trust", merchant: "new shop" }],
  ])("parses %s", (text, expected) => expect(parseCommand(text)).toEqual(expected));

  it("buys only from allowed merchants, under a one-use mandate", async () => {
    const { app, agent, buyer } = setup();
    const ok = await app.inject({ method: "POST", url: "/execute", payload: { action: { action: "buy", merchant: "Trusted Coffee", amount: "2" }, confirmed: true } });
    expect(ok.json().result.paymentId).toBe("4");
    expect(buyer.createMandate).toHaveBeenCalledWith(expect.objectContaining({ payees: [COFFEE], maxAmount: "2", maxUses: 1 }));
    const bad = await app.inject({ method: "POST", url: "/execute", payload: { action: { action: "buy", merchant: "someone else", amount: "2" }, confirmed: true } });
    expect(bad.statusCode).toBe(400);
    expect(agent.payWithMandate).toHaveBeenCalledTimes(1);
  });

  it("limits actions per address but not reads", async () => {
    const { app } = setup({ parse: new RateLimiter(100, 1000), execute: new RateLimiter(1, 100000) });
    const buy = { action: { action: "dispute_payment", paymentId: "1" }, confirmed: true };
    expect((await app.inject({ method: "POST", url: "/execute", payload: buy })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/execute", payload: buy })).statusCode).toBe(429);
    expect((await app.inject({ method: "POST", url: "/execute", remoteAddress: "10.0.0.9", payload: buy })).statusCode).toBe(200);
    const read = { action: { action: "get_trust", merchant: "trusted coffee" } };
    expect((await app.inject({ method: "POST", url: "/execute", payload: read })).statusCode).toBe(200);
  });

  it("serves its card and takes one labeled rating per job", async () => {
    const { app, rate } = setup();
    expect((await app.inject({ url: "/.well-known/agent-card.json" })).json().name).toBe("Talaria Autopilot");
    const payload = { paymentId: "4", stars: 5 };
    expect((await app.inject({ method: "POST", url: "/rate", payload })).json()).toEqual({ baseTx: "0xfeed", label: "demo-client feedback" });
    expect((await app.inject({ method: "POST", url: "/rate", payload })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/rate", payload: { paymentId: "4", stars: 9 } })).statusCode).toBe(400);
    expect(rate).toHaveBeenCalledTimes(1);
  });

  it("reads hourly limits from the environment, and ignores bad values", () => {
    const set = limitsFromEnv({ AGENT_EXECUTE_PER_HOUR: "2", AGENT_PARSE_PER_HOUR: "nonsense" });
    expect([set.execute.allow("a"), set.execute.allow("a"), set.execute.allow("a")]).toEqual([true, true, false]);
    for (let i = 0; i < 60; i++) expect(set.parse.allow("a")).toBe(true);
    expect(set.parse.allow("a")).toBe(false);
  });

  it("resets the limit after its window", () => {
    let time = 0;
    const limiter = new RateLimiter(1, 100, () => time);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    time = 100;
    expect(limiter.allow("a")).toBe(true);
  });
});

describe("Anthropic parser (stubbed client)", () => {
  const reply = (over: object) => ({ beta: { messages: { create: vi.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '{"action":"get_balance"}' }], ...over })) } } }) as any;

  it("accepts schema-valid JSON and asks for the default model", async () => {
    const client = reply({});
    expect(await anthropicParser(client)("balance please")).toEqual({ action: "get_balance" });
    expect(client.beta.messages.create.mock.calls[0][0].model).toBe("claude-opus-5-5");
  });

  it.each([
    [{ stop_reason: "refusal", content: [] }],
    [{ content: [{ type: "text", text: "not json" }] }],
    [{ content: [{ type: "text", text: '{"action":"get_balance","privateKey":"0x1"}' }] }],
    [{ content: [] }],
  ])("returns null for %j", async (over) => {
    expect(await anthropicParser(reply(over))("x")).toBeNull();
  });
});
