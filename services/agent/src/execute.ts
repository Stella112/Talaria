import type { Talaria } from "@talaria-pay/sdk";
import type { Action } from "./schema";

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Runs a validated action through the SDK. Policies are enforced on-chain, not here. */
export async function execute(talaria: Talaria, action: Action): Promise<unknown> {
  switch (action.action) {
    case "create_checkout":
      return json(await talaria.createCheckout({ amount: action.amount, currency: "USD", metadata: { memo: action.memo ?? "" } }));
    case "pay_invoice":
      return { txHash: await talaria.payInvoice(BigInt(action.invoiceId)) };
    case "subscribe":
      return json(await talaria.subscribe(BigInt(action.planId)));
    case "cancel_subscription":
      return { txHash: await talaria.cancel(BigInt(action.subId)) };
    case "start_stream":
      return json(await talaria.startStream({ to: action.to as `0x${string}`, ratePerMonth: action.ratePerMonth, deposit: action.deposit }));
    case "stop_stream":
      return { txHash: await talaria.stopStream(BigInt(action.streamId)) };
    case "paid_fetch": {
      const response = await talaria.fetch(action.url, { maxPrice: action.maxPrice, channelDeposit: action.channelDeposit });
      return { status: response.status, body: await response.text() };
    }
    case "send_remit":
      return json(await talaria.sendRemit({ to: action.to as `0x${string}` | undefined, amount: action.amount }));
    case "get_balance":
      return { baseUnits: (await talaria.getBalance()).toString() };
    case "get_receipts":
      return json(await talaria.getReceipts({ payer: talaria.owner }));
    case "get_policy":
      return json(await talaria.getPolicy(talaria.account.address));
  }
}
