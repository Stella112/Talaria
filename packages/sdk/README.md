# @talaria-pay/sdk

TypeScript SDK for Talaria on the Portaldot V3 testnet, built with viem. Not published to npm yet: use it from this workspace.

Rails with no deployed contract throw `RailNotDeployedError`. Check the repository README for what is live. You can pass your own addresses through `addresses`.

## Set up

```ts
import { createTalaria } from "@talaria-pay/sdk";
import { privateKeyToAccount } from "viem/accounts";

const talaria = createTalaria({
  account: privateKeyToAccount(process.env.MY_KEY as `0x${string}`), // signs locally, never sent
  relayerUrl: "http://localhost:8787", // gasless route
});
```

For an agent using a session key, also set `owner` to the account whose funds it spends.

## Accounts

```ts
await talaria.deposit("10");          // signs a permit, and the relayer submits it
await talaria.getBalance();           // base units, 6 decimals
await talaria.withdrawBalance("1");
```

## Checkout

```ts
const { invoiceId } = await talaria.createCheckout({ amount: "5", currency: "USD", metadata: { order: 1 } });
await talaria.payInvoice(invoiceId);
await talaria.refund(invoiceId, "1");
```

## Session keys

```ts
import { RailBit } from "@talaria-pay/sdk";

await talaria.addSessionKey({
  key: "0x…",
  maxPerTx: "5",
  maxPerDay: "20",
  expiry: BigInt(Math.floor(Date.now() / 1000) + 86_400),
  rails: RailBit.checkout | RailBit.channels,
});
await talaria.getPolicy("0x…");
await talaria.revokeSessionKey("0x…");
```

Payments over the limits wait in the owner's queue instead of executing. In that case `createCheckout`-style helpers that read an event throw an error saying the intent may be queued.

## Pay-per-call

API side:

```ts
const gate = talaria.paywall({ price: "0.01", provider: "0x…" });
app.get("/data", { preHandler: gate.fastify() }, handler); // or gate.express()
```

Agent side:

```ts
const response = await talaria.fetch("https://api.example.com/data", {
  maxPrice: "0.02",
  channelDeposit: "1", // opens a channel if there is none for this provider
});
```

## Subscriptions, streams and remittance

```ts
const { planId } = await talaria.createPlan({ amount: "5", interval: 2_592_000, maxPeriods: 12 }); // direct transaction
const { subId } = await talaria.subscribe(planId);
await talaria.cancel(subId);

const { streamId } = await talaria.startStream({ to: "0x…", ratePerMonth: "100", deposit: "10" });
await talaria.withdraw(streamId);
await talaria.stopStream(streamId);

const sent = await talaria.sendRemit({ to: "0x…", amount: "5" });
await talaria.cancelRemit(sent.remitId);

const link = await talaria.sendRemit({ amount: "5" }); // link.claimCode is the secret to share
await talaria.claimWithCode(link.remitId, link.claimCode!, "0xReceiver…");
```

## Address utilities

```ts
talaria.utils.h160ToSs58("0x…");       // SS58 address that holds an EVM address's balance
talaria.utils.ss58ToH160("5…");        // strips 0xEE×12, or hashes a native account
talaria.utils.plancksToWei(1n);        // 10000n
```

Never use the legacy Frontier conversion (`evmToAddress`): it gives the wrong account on pallet-revive.
