import { Code, Inline, Section, Table } from "@/components/docs";

const LIVE = "Live on Portaldot";
const NOT_YET = "Not on Portaldot yet: returns an error";

export default function McpDocs() {
  return (
    <>
      <p className="text-sm font-semibold text-[var(--muted)]">Docs</p>
      <h1 className="mt-2 text-4xl font-semibold md:text-5xl">MCP server</h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">Gives an AI agent payment tools through the Model Context Protocol. The agent acts through a session key, so its spending limits are enforced on-chain, not by the model.</p>

      <div className="mt-10">
        <Section id="setup" title="Set up">
          <p>Clone the repository and install, then put these in the <Inline>.env</Inline> file at the repository root. Keys stay there: no tool takes a key as input.</p>
          <Code>{`
AGENT_SESSION_KEY=   # the agent's key, authorised by the owner with limits
AGENT_OWNER=         # the account whose funds it spends
RELAYER_URL=         # a Talaria relayer, which pays the gas
PORTALDOT_EVM_RPC=https://test-evm-rpc-v3.portaldot.dev
`}</Code>
          <p>Authorise the session key first, on the <a className="font-semibold text-[var(--ink)] underline underline-offset-4" href="/agent">Agent page</a> or with <Inline>addSessionKey</Inline> in the SDK.</p>
        </Section>

        <Section id="connect" title="Connect a client">
          <p>The server runs over stdio. Add it to your MCP client's config, using your own path to the repository:</p>
          <Code>{`
{
  "mcpServers": {
    "talaria": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/path/to/Talaria", "--filter", "@talaria-pay/mcp", "start"]
    }
  }
}
`}</Code>
          <p>Keep <Inline>--silent</Inline>. Without it, pnpm prints to stdout, which carries the MCP protocol.</p>
        </Section>

        <Section id="tools" title="Tools">
          <Table
            head={["Tool", "What it does", "Input", "Status"]}
            rows={[
              [<Inline key="a">create_checkout</Inline>, "Create a tUSD invoice", "amount, memo (optional)", LIVE],
              [<Inline key="b">pay_invoice</Inline>, "Pay an invoice. Over-limit payments may queue for the owner's approval", "invoiceId", LIVE],
              [<Inline key="c">get_receipts</Inline>, "List receipts where this account paid", "None", LIVE],
              [<Inline key="d">get_policy</Inline>, "Show this agent's spending policy", "None", LIVE],
              [<Inline key="e">subscribe</Inline>, "Subscribe to a merchant plan", "planId", NOT_YET],
              [<Inline key="f">start_stream</Inline>, "Start a per-second payment stream", "to, ratePerMonth, deposit", NOT_YET],
              [<Inline key="g">paid_fetch</Inline>, "Fetch a URL, paying any HTTP 402 with a channel voucher", "url, maxPrice, channelDeposit (optional)", NOT_YET],
              [<Inline key="h">send_remit</Inline>, "Send tUSD to an address, or create a claim link", "to (optional), amount", NOT_YET],
            ]}
          />
          <p>The four tools marked as not on Portaldot use rails that run on Base Sepolia today. The server connects to Portaldot only, so it can't reach them yet.</p>
        </Section>

        <Section id="safety" title="Limits and safety">
          <p>A session key has a per-payment limit, a daily limit, an expiry and an allowed list of rails. Payments over the limits wait for the owner rather than going through.</p>
          <p>Each write spends the relayer's tPOT, and the relayer has an hourly cap, so tools may fail for a while if it's reached. This is a testnet build with test tokens only.</p>
        </Section>
      </div>
    </>
  );
}
