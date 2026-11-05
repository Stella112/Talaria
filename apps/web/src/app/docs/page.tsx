import { baseSepoliaDeployments, bnbTestnetDeployments, portaldotDeployments } from "@talaria-pay/sdk";
import Link from "next/link";
import { Code, Inline, Section, Table } from "@/components/docs";

const REPO = "https://github.com/Stella112/Talaria";

const contracts = (chain: string, deployed: Record<string, string>, names: string[]) =>
  names.filter((name) => deployed[name]).map((name) => [name, chain, <Inline key={name}>{deployed[name]}</Inline>]);

export default function Docs() {
  return (
    <>
      <p className="text-sm font-semibold text-[var(--muted)]">Docs</p>
      <h1 className="mt-2 text-4xl font-semibold md:text-5xl">How Talaria works</h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">
        Stripe for Portaldot, with a refund button. Stripe is only a comparison: Talaria has no link to it. This is a testnet build, with test tokens and no audit.
      </p>

      <div className="mt-10">
        <Section id="flow" title="The payment flow">
          <p>Every payment takes the same path: a signed intent, a policy check on-chain, execution by a relayer that pays the gas, and a receipt event.</p>
          <p>Reputation changes what happens next. The relayer reads a seller's or agent's ERC-8004 reputation on Base Sepolia and signs a short-lived attestation, and the contract checks it inline.</p>
          <Table
            head={["Tier", "Condition", "Hold on a payment", "Agent cap per payment"]}
            rows={[
              ["Trusted", "Score 80+, with 3+ feedbacks", "Instant", "100 tUSD"],
              ["Established", "Score 50–79", "10 minutes", "25 tUSD"],
              ["New or low", "Under 50, or no attestation", "30 minutes", "5 tUSD"],
            ]}
          />
          <p>These are demo values, fixed at deployment. Buyers can dispute while a payment is held, and an arbiter resolves the dispute. Merchants can also refund. When a payment is released, or a dispute refunds 50% or more, feedback is written back to Base.</p>
        </Section>

        <Section id="build" title="Ways to build">
          <p>
            <Link className="font-semibold text-[var(--ink)] underline underline-offset-4" href="/docs/sdk">SDK</Link>: add payments from TypeScript.
          </p>
          <p>
            <Link className="font-semibold text-[var(--ink)] underline underline-offset-4" href="/docs/mcp">MCP server</Link>: give an AI agent payment tools under on-chain limits.
          </p>
        </Section>

        <Section id="status" title="What runs where">
          <Table
            head={["Feature", "Where it runs"]}
            rows={[
              ["Checkout, buyer protection, mandates, bridge-out", "Portaldot V3 testnet"],
              ["Subscriptions, streaming, pay-per-call, remittance", "Base Sepolia, on a second copy of Core. Not on Portaldot yet"],
              ["Funding into Portaldot", "Base Sepolia and BNB testnet"],
              ["Bridge-out destination", "Base Sepolia has run. BNB testnet is enabled but has not been run"],
            ]}
          />
        </Section>

        <Section id="network" title="Network">
          <Table
            head={["Item", "Value"]}
            rows={[
              ["Chain ID", <Inline key="id">420420777</Inline>],
              ["EVM RPC", <Inline key="rpc">https://test-evm-rpc-v3.portaldot.dev</Inline>],
              ["Substrate WebSocket", <Inline key="ws">wss://test-node-v3.portaldot.dev</Inline>],
              ["Native token", "tPOT. Signed actions don't need it, because the relayer pays the gas"],
            ]}
          />
        </Section>

        <Section id="contracts" title="Contracts">
          <Table
            head={["Contract", "Chain", "Address"]}
            rows={[
              ...contracts("Portaldot", portaldotDeployments, ["TalariaUSD", "TalariaCore", "TalariaProtect", "TalariaBridgeOut"]),
              ...contracts("Base Sepolia", baseSepoliaDeployments, ["MockUSDC", "TalariaLockboxV2", "TalariaCore", "TalariaSubscriptions", "TalariaStreams", "TalariaChannels", "TalariaRemit"]),
              ...contracts("BNB testnet", bnbTestnetDeployments, ["MockUSDC", "TalariaLockboxV2"]),
            ]}
          />
          <p>
            Deploy transactions and every recorded payment are in the{" "}
            <a className="font-semibold text-[var(--ink)] underline underline-offset-4" href={`${REPO}/blob/main/evidence/TRANSACTIONS.md`} target="_blank" rel="noreferrer">evidence log</a>.
          </p>
        </Section>

        <Section id="run" title="Run it yourself">
          <p>Requires Node 22.5+ and pnpm.</p>
          <Code>{`
git clone https://github.com/Stella112/Talaria.git
cd Talaria
pnpm install
cp .env.example .env
pnpm --filter @talaria-pay/web build
pnpm --filter @talaria-pay/web start
`}</Code>
          <p>The web app reads live testnet data with no key. The relayer, agent and deployment steps are in the <a className="font-semibold text-[var(--ink)] underline underline-offset-4" href={`${REPO}#run-locally`} target="_blank" rel="noreferrer">README</a>.</p>
        </Section>

        <Section id="trust" title="What you're trusting">
          <p>
            A single attester signs reputation scores, a single relayer runs the bridge, and an admin arbiter decides disputes. Read the{" "}
            <a className="font-semibold text-[var(--ink)] underline underline-offset-4" href={`${REPO}/blob/main/docs/SECURITY.md`} target="_blank" rel="noreferrer">full security notes</a>.
          </p>
        </Section>
      </div>
    </>
  );
}
