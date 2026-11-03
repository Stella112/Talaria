import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z.string().regex(/^\d+(\.\d{1,6})?$/);
const id = z.string().regex(/^\d+$/);

/** Every action the agent can take. LLM output must pass this too, and unknown fields are rejected. */
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_checkout"), amount, memo: z.string().max(200).optional() }).strict(),
  z.object({ action: z.literal("pay_invoice"), invoiceId: id }).strict(),
  z.object({ action: z.literal("subscribe"), planId: id }).strict(),
  z.object({ action: z.literal("cancel_subscription"), subId: id }).strict(),
  z.object({ action: z.literal("start_stream"), to: address, ratePerMonth: amount, deposit: amount }).strict(),
  z.object({ action: z.literal("stop_stream"), streamId: id }).strict(),
  z.object({ action: z.literal("paid_fetch"), url: z.string().url(), maxPrice: amount, channelDeposit: amount.optional() }).strict(),
  z.object({ action: z.literal("send_remit"), to: address.optional(), amount }).strict(),
  z.object({ action: z.literal("buy"), merchant: z.string().min(1).max(50), amount }).strict(),
  z.object({ action: z.literal("dispute_payment"), paymentId: id }).strict(),
  z.object({ action: z.literal("get_trust"), merchant: z.string().min(1).max(50) }).strict(),
  z.object({ action: z.literal("get_balance") }).strict(),
  z.object({ action: z.literal("get_receipts") }).strict(),
  z.object({ action: z.literal("get_policy") }).strict(),
]);

export type Action = z.infer<typeof actionSchema>;

/** Plain-language preview shown before anything is signed. */
export function preview(action: Action): string {
  switch (action.action) {
    case "create_checkout":
      return `Create an invoice for ${action.amount} tUSD${action.memo ? ` ("${action.memo}")` : ""}`;
    case "pay_invoice":
      return `Pay invoice #${action.invoiceId}`;
    case "subscribe":
      return `Subscribe to plan #${action.planId}`;
    case "cancel_subscription":
      return `Cancel subscription #${action.subId}`;
    case "start_stream":
      return `Stream ${action.ratePerMonth} tUSD per month to ${action.to}, with a ${action.deposit} tUSD deposit`;
    case "stop_stream":
      return `Stop stream #${action.streamId}`;
    case "paid_fetch":
      return `Fetch ${action.url}, paying at most ${action.maxPrice} tUSD per call`;
    case "send_remit":
      return action.to ? `Send ${action.amount} tUSD to ${action.to}` : `Send ${action.amount} tUSD as a claim link`;
    case "buy":
      return `Buy ${action.amount} tUSD from ${action.merchant} under a one-use mandate. A new merchant's payment is held so it can be disputed.`;
    case "dispute_payment":
      return `Dispute payment #${action.paymentId}, freezing the funds until the arbiter decides`;
    case "get_trust":
      return `Show the reputation of ${action.merchant}`;
    case "get_balance":
      return "Show the account balance";
    case "get_receipts":
      return "Show payment receipts";
    case "get_policy":
      return "Show this agent's spending policy";
  }
}

/** Reads spend nothing, so they need no confirmation. */
export const isReadOnly = (action: Action) => action.action.startsWith("get_");
