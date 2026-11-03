import type { Talaria } from "@talaria-pay/sdk";
import type { Address } from "viem";
import type { Action } from "./schema";

/** The hosted agent's setup: a demo buyer who signs mandates, and the merchants it may buy from. */
export type HostedContext = { buyer: Talaria; merchants: Record<string, Address> };

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Runs a validated action through the SDK. Policies are enforced on-chain, not here. */
export async function execute(talaria: Talaria, action: Action, hosted?: HostedContext): Promise<unknown> {
  const merchant = (name: string): Address => {
    const address = hosted?.merchants[name.toLowerCase()];
    if (!address) throw new Error(`The agent is not allowed to buy from "${name}"`);
    return address;
  };
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
    case "buy": {
      if (!hosted) throw new Error("Buying needs the hosted setup");
      const payee = merchant(action.merchant);
      const mandate = await hosted.buyer.createMandate({ agent: talaria.account.address, payees: [payee], maxAmount: action.amount, maxUses: 1 });
      return json(await talaria.payWithMandate(mandate, { payee, amount: action.amount }));
    }
    case "dispute_payment":
      if (!hosted) throw new Error("Disputes need the hosted setup");
      return { txHash: await hosted.buyer.dispute(BigInt(action.paymentId)) };
    case "get_trust":
      return json(await talaria.getTrust(merchant(action.merchant)));
    case "get_balance":
      return { baseUnits: (await talaria.getBalance()).toString() };
    case "get_receipts":
      return json(await talaria.getReceipts({ payer: talaria.owner }));
    case "get_policy":
      return json(await talaria.getPolicy(talaria.account.address));
  }
}
