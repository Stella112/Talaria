import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Talaria } from "@talaria-pay/sdk";
import type { Address } from "viem";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z.string().regex(/^\d+(\.\d{1,6})?$/).describe("Decimal tUSD amount");
const id = z.string().regex(/^\d+$/);

/** Keys come only from the process environment: no tool takes one as input. */
export function buildMcp(talaria: Talaria) {
  const server = new McpServer({ name: "talaria", version: "0.0.0" });

  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema: shape } as any, (async (args: any) => {
      try {
        const text = JSON.stringify(await run(args), (_, v) => (typeof v === "bigint" ? v.toString() : v));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: (error as Error).message }] };
      }
    }) as any);

  tool("create_checkout", "Create a tUSD invoice on the Portaldot testnet", { amount, memo: z.string().max(200).optional() }, ({ amount, memo }) =>
    talaria.createCheckout({ amount, currency: "USD", metadata: { memo: memo ?? "" } }),
  );
  tool("pay_invoice", "Pay an invoice. Enforced by this agent's on-chain policy, and may queue for owner approval", { invoiceId: id }, async ({ invoiceId }) => ({
    txHash: await talaria.payInvoice(BigInt(invoiceId)),
  }));
  tool("subscribe", "Subscribe to a merchant plan", { planId: id }, ({ planId }) => talaria.subscribe(BigInt(planId)));
  tool("start_stream", "Start a per-second payment stream", { to: address, ratePerMonth: amount, deposit: amount }, ({ to, ratePerMonth, deposit }) =>
    talaria.startStream({ to: to as Address, ratePerMonth, deposit }),
  );
  tool("paid_fetch", "Fetch a URL, paying any HTTP 402 with a channel voucher up to maxPrice per call", { url: z.string().url(), maxPrice: amount, channelDeposit: amount.optional() }, async ({ url, maxPrice, channelDeposit }) => {
    const response = await talaria.fetch(url, { maxPrice, channelDeposit });
    return { status: response.status, body: await response.text() };
  });
  tool("send_remit", "Send tUSD to an address, or omit `to` to create a claim link", { to: address.optional(), amount }, ({ to, amount }) =>
    talaria.sendRemit({ to: to as Address | undefined, amount }),
  );
  tool("get_receipts", "List receipts where this account paid", {}, () => talaria.getReceipts({ payer: talaria.owner }));
  tool("get_policy", "Show the spending policy of this agent's session key", {}, () => talaria.getPolicy(talaria.account.address));

  return server;
}
