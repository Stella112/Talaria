import { describe, expect, it, vi } from "vitest";
import { parseCommand, understand } from "../src/parser";
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
