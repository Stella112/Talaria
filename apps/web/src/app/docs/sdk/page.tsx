import { Code, Inline, Section } from "@/components/docs";

export default function SdkDocs() {
  return (
    <>
      <p className="text-sm font-semibold text-[var(--muted)]">Docs</p>
      <h1 className="mt-2 text-4xl font-semibold md:text-5xl">TypeScript SDK</h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">
        <Inline>@talaria-pay/sdk</Inline> is built with viem and typed throughout. Keys sign locally and are never sent anywhere.
      </p>

      <div className="mt-10">
        <Section id="install" title="Install">
          <p>It isn't on npm yet, so use it from the repository workspace.</p>
          <Code>{`
git clone https://github.com/Stella112/Talaria.git
cd Talaria
pnpm install
`}</Code>
        </Section>

        <Section id="read" title="Read the chain, with no key">
          <Code>{`
import { createTalaria } from "@talaria-pay/sdk";

const talaria = createTalaria();
const invoice = await talaria.getInvoice(1n);
console.log(invoice.amount, invoice.payer);
`}</Code>
        </Section>

        <Section id="setup" title="Set up to sign">
          <Code>{`
import { createTalaria } from "@talaria-pay/sdk";
import { privateKeyToAccount } from "viem/accounts";

const talaria = createTalaria({
  account: privateKeyToAccount(process.env.MY_KEY as \`0x\${string}\`),
  relayerUrl: "http://localhost:8787", // your relayer pays the gas
});
`}</Code>
          <p>For an agent using a session key, also set <Inline>owner</Inline> to the account whose funds it spends.</p>
        </Section>

        <Section id="accounts" title="Accounts">
          <Code>{`
await talaria.deposit("10");          // signs a permit, and the relayer submits it
await talaria.getBalance();           // base units, 6 decimals
await talaria.withdrawBalance("1");
`}</Code>
        </Section>

        <Section id="checkout" title="Checkout">
          <Code>{`
const { invoiceId } = await talaria.createCheckout({ amount: "5", currency: "USD", metadata: { order: 1 } });
await talaria.payInvoice(invoiceId);
await talaria.refund(invoiceId, "1");
`}</Code>
        </Section>

        <Section id="protection" title="Buyer protection and trust">
          <Code>{`
const trust = await talaria.getTrust("0xMerchant…"); // score, feedbackCount, tier

const txHash = await talaria.payProtected({ merchant: "0xMerchant…", amount: "5" });

await talaria.getPayment(1n);
await talaria.dispute(1n);                // buyer, while the payment is held
await talaria.refundProtected(1n, "1");   // merchant
`}</Code>
          <p>The relayer attaches the merchant's attestation, and the contract sets the hold from it.</p>
        </Section>

        <Section id="mandates" title="Agent mandates">
          <p>A mandate lets one agent key pay chosen merchants, up to an amount, for a limited time.</p>
          <Code>{`
// The owner signs
const mandate = await owner.createMandate({
  agent: "0xAgent…",
  payees: ["0xMerchant…"],
  maxAmount: "5",
  maxUses: 1,
});

// The agent pays
const { txHash, paymentId } = await agent.payWithMandate(mandate, { payee: "0xMerchant…", amount: "1" });
`}</Code>
          <p>The effective cap is the lower of the mandate's maximum and the agent's trust tier cap, enforced on-chain.</p>
        </Section>

        <Section id="session-keys" title="Session keys">
          <Code>{`
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
`}</Code>
          <p>Payments over the limits wait in the owner's queue instead of executing.</p>
        </Section>

        <Section id="bridge" title="Bridge out">
          <Code>{`
const { id } = await talaria.bridgeOut({ amount: "1", destChainId: 84532, recipient: "0x…" });
await talaria.getBridgeStatus(id);
`}</Code>
        </Section>

        <Section id="webhooks" title="Webhooks">
          <Code>{`
import { verifyWebhook } from "@talaria-pay/sdk";

const valid = await verifyWebhook(rawBody, request.headers["talaria-signature"], secret);
`}</Code>
        </Section>

        <Section id="base-rails" title="Rails not on Portaldot yet">
          <p>
            These methods need rail contracts that aren't deployed on Portaldot, so by default they throw <Inline>RailNotDeployedError</Inline>. The contracts are live on Base Sepolia: you can pass your own <Inline>addresses</Inline>, <Inline>publicClient</Inline> and <Inline>walletClient</Inline> for that chain.
          </p>
          <Code>{`
// Pay-per-call: API side
const gate = talaria.paywall({ price: "0.01", provider: "0x…" });
app.get("/data", { preHandler: gate.fastify() }, handler); // or gate.express()

// Pay-per-call: agent side
await talaria.fetch("https://api.example.com/data", { maxPrice: "0.02", channelDeposit: "1" });

// Subscriptions
const { planId } = await talaria.createPlan({ amount: "5", interval: 2_592_000, maxPeriods: 12 });
const { subId } = await talaria.subscribe(planId);

// Streams
const { streamId } = await talaria.startStream({ to: "0x…", ratePerMonth: "100", deposit: "10" });

// Remittance
const link = await talaria.sendRemit({ amount: "5" }); // link.claimCode is the secret to share
`}</Code>
        </Section>

        <Section id="addresses" title="Address utilities">
          <Code>{`
talaria.utils.h160ToSs58("0x…");   // SS58 address that holds an EVM address's balance
talaria.utils.ss58ToH160("5…");    // strips 0xEE×12, or hashes a native account
talaria.utils.plancksToWei(1n);    // 10000n
`}</Code>
          <p>Never use the legacy Frontier conversion (<Inline>evmToAddress</Inline>). It gives the wrong account on pallet-revive.</p>
        </Section>
      </div>
    </>
  );
}
