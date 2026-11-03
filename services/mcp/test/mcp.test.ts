// Connects a real MCP client over the SDK's in-memory transport. Talaria itself is stubbed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildMcp } from "../src/server";

async function connect(talaria: any) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([buildMcp(talaria).connect(a), client.connect(b)]);
  return client;
}

describe("MCP server", () => {
  it("exposes exactly the specified tools, none taking a key", async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["create_checkout", "get_policy", "get_receipts", "paid_fetch", "pay_invoice", "send_remit", "start_stream", "subscribe"].sort(),
    );
    for (const tool of tools) {
      const fields = Object.keys((tool.inputSchema as any).properties ?? {}).join(" ").toLowerCase();
      expect(fields).not.toMatch(/key|secret|mnemonic|seed/);
    }
  });

  it("calls the SDK and serialises bigints", async () => {
    const talaria = { payInvoice: vi.fn(async () => "0xabc"), createCheckout: vi.fn(async () => ({ invoiceId: 4n, txHash: "0xdef" })) };
    const client = await connect(talaria);
    const paid: any = await client.callTool({ name: "pay_invoice", arguments: { invoiceId: "7" } });
    expect(JSON.parse(paid.content[0].text).txHash).toBe("0xabc");
    expect(talaria.payInvoice).toHaveBeenCalledWith(7n);
    const made: any = await client.callTool({ name: "create_checkout", arguments: { amount: "1.5" } });
    expect(JSON.parse(made.content[0].text).invoiceId).toBe("4");
  });

  it("rejects bad input and reports SDK errors as tool errors", async () => {
    const talaria = { payInvoice: vi.fn(async () => { throw new Error("The channels rail has no deployed contract"); }) };
    const client = await connect(talaria);
    const invalid: any = await client.callTool({ name: "pay_invoice", arguments: { invoiceId: "abc" } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
    expect(invalid.isError).toBe(true);
    const failed: any = await client.callTool({ name: "pay_invoice", arguments: { invoiceId: "1" } });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain("no deployed contract");
  });
});
