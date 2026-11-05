"use client";

import { TalariaCoreAbi, type Addresses } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatEther } from "viem";
import { Notice, Pill } from "@/components/ui";
import { baseSepoliaDeployments, bnbTestnetDeployments } from "@talaria-pay/sdk";
import { client, LOCKBOX, reader, short, tusd } from "@/lib/talaria";

const LOW_TPOT = 8n * 10n ** 18n; // one new invoice costs about 7.7 tPOT
const EVIDENCE = "https://github.com/Stella112/Talaria/blob/main/evidence/TRANSACTIONS.md";

const STEPS = [
  ["01", "Intent", "A person or agent signs what they want to pay.", "bg-[var(--surface-2)]"],
  ["02", "Policy", "Limits are checked on-chain, not in an app.", "bg-[var(--sky)]"],
  ["03", "Execute", "A relayer submits it and pays the gas.", "bg-[var(--orange)]"],
  ["04", "Receipt", "Every payment leaves a verifiable event.", "bg-[var(--ink)] text-white"],
] as const;

const BASE_RAILS: { name: string; text: string; contract: string }[] = [
  { name: "Pay-per-call", text: "HTTP 402 APIs paid with vouchers that settle in one transaction.", contract: "TalariaChannels" },
  { name: "Subscriptions", text: "Merchant plans charged only when due, within a cap.", contract: "TalariaSubscriptions" },
  { name: "Streaming", text: "Per-second payments with computed accrual.", contract: "TalariaStreams" },
  { name: "Remittance", text: "Send to an address or a claim link, cancellable until claimed.", contract: "TalariaRemit" },
];

const RAILS: { name: string; text: string; key?: keyof Addresses; href: string; cta: string }[] = [
  { name: "Checkout", text: "Invoices, payment links and refunds, paid gaslessly.", href: "/merchant", cta: "Create a payment link" },
  { name: "Buyer protection", text: "Trust decides the hold. Buyers can dispute while it lasts, and a trusted arbiter resolves it.", key: "protect", href: "/payment/5", cta: "See a real payment" },
  { name: "Bridge-out", text: "Move funds back to Base, with replay protection on both sides. BNB is enabled, but hasn't run yet.", key: "bridgeOut", href: "/wallet", cta: "Open wallet" },
];

const DEVELOPERS = [
  ["/docs", "Docs", "How Talaria works, the network, the contracts and how to run it."],
  ["/docs/sdk", "SDK", "Add checkout, buyer protection and agent payments from TypeScript."],
  ["/docs/mcp", "MCP server", "Give an AI agent payment tools, with limits enforced on-chain."],
] as const;

const PROOF = [
  ["Lock 10 mUSDC", "Base Sepolia", "0x1e8fddc7ce961eee32eb158aeb1eeb8dd669b1f993366a9248ac013eb0d00364"],
  ["Relayer credits the payer", "Portaldot", "0xb0d9b610ecdb280b356c9be2c9919b4770f470b662ed9d0907297fa8be8e9bf1"],
  ["Payer with 0 tPOT pays invoice 1", "Portaldot", "0x7fe8f26f10f5ad7f2e9a8a06348eef6ba26a0515697a778dd2e15059e45000ab"],
] as const;

const STORY: { text: string; chain: "Portaldot" | "Base Sepolia"; hash: string }[] = [
  { text: "A buyer funds their account by locking test mUSDC on Base. BNB works the same way.", chain: "Base Sepolia", hash: "0xece8ae33164e107753403bacf13e5ed5c5bce57f52441d0968965520f1fd1528" },
  { text: "An AI agent buys from New Shop, which has no history. The payment is held for 30 minutes.", chain: "Portaldot", hash: "0x5f2abd215e1ade9126a89ead81717f9135a862eb11a4b5dc481092bf34af073e" },
  { text: "Something goes wrong, so the buyer disputes while the payment is held.", chain: "Portaldot", hash: "0x803e74783c16aff7b821740284054c388e788fb4857f6fb0b68bc435dcda161b" },
  { text: "The arbiter refunds the buyer in full.", chain: "Portaldot", hash: "0x775a18c5d87ae0ac00710b5d8c4e67dbf319bc779d8be7736126cc457c5e1047" },
  { text: "The refund leaves Portaldot through the bridge.", chain: "Portaldot", hash: "0xcb378549d30e76351f0a92c08e1ff237664fd7d93b876757c8d1f006c54670b9" },
  { text: "The money arrives back on Base.", chain: "Base Sepolia", hash: "0x4e5b8ba1e6099a3330106c512e6884d476ba0c8d9346de269ed2a7401dfa879d" },
  { text: "New Shop gets negative feedback, which follows it on ERC-8004.", chain: "Base Sepolia", hash: "0x6b36aac7530da0405612d376e463f54ad9ddac4f358b4ea7a4afb1702a85a61e" },
  { text: "The agent buys from Trusted Coffee, which has a score of 100. It settles instantly, with no hold.", chain: "Portaldot", hash: "0xff4f51b92c5d5e3edc2e86f19e80f2c5484a76b664d4038fb36fcda633ceb10a" },
  { text: "Trusted Coffee gets positive feedback, and its record grows.", chain: "Base Sepolia", hash: "0xa937c932653e6eeac7189248f6dbc22fbde138422fd8aaaf8e9304079c985e4f" },
];

const TIERS = [
  ["Trusted", "Score 80+, with 3+ feedbacks", "Instant", "100 tUSD"],
  ["Established", "Score 50–79", "10 minutes", "25 tUSD"],
  ["New or low", "Under 50, or no history", "30 minutes", "5 tUSD"],
] as const;

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-3xl font-semibold tracking-tight md:text-4xl">{value ?? "…"}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{label}</p>
    </div>
  );
}

export default function Overview() {
  const { data, error } = useQuery({
    queryKey: ["status"],
    queryFn: async () => {
      const core = reader.addresses.core;
      const read = (functionName: string) => client.readContract({ address: core, abi: TalariaCoreAbi as any, functionName }) as Promise<any>;
      const [block, relayer, reserve, invoices, receipts, invoice] = await Promise.all([client.getBlockNumber(), read("relayer"), read("bridgeReserve"), read("invoiceCount"), read("receiptCount"), reader.getInvoice(1n)]);
      const [relayerTpot, payerTpot] = await Promise.all([client.getBalance({ address: relayer }), client.getBalance({ address: invoice.payer })]);
      return { block, relayer, reserve, invoices, receipts, invoice, relayerTpot, payerTpot };
    },
  });

  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 md:grid-cols-[1.25fr_1fr] md:px-6 md:pt-20">
        <div>
          <Pill tone="good">
            <span className="pulse-dot h-2 w-2 rounded-full bg-[var(--good)]" />
            Live on Portaldot V3 testnet
          </Pill>
          <h1 className="mt-5 text-5xl leading-[1.05] font-semibold md:text-7xl">Stripe for Portaldot, with a refund button.</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
            Crypto payments for people and AI agents, funded from Base or BNB and settled on Portaldot. Talaria holds payments to new sellers so buyers can get their money back, pays proven sellers instantly, and gives agents spending limits that grow with their reputation.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--sky)] px-3 py-1 text-xs font-semibold">Base Sepolia</span>
            <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold">BNB testnet</span>
            <span className="rounded-full bg-[var(--warn-bg)] px-3 py-1 text-xs font-semibold text-[var(--warn-ink)]">Settles on Portaldot</span>
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/wallet" className="flex min-h-12 items-center rounded-full bg-[var(--ink)] px-6 font-semibold text-white transition-opacity hover:opacity-85">
              Open app
            </Link>
            <Link href="/agent" className="flex min-h-12 items-center rounded-full border border-[var(--ink)]/25 px-6 font-semibold">
              Try the agent, no wallet
            </Link>
            <a href="#story" className="flex min-h-12 items-center rounded-full px-3 font-semibold underline underline-offset-4">
              See the full story
            </a>
          </div>
        </div>

        <Link href="/pay/1" className="block rounded-[2rem] bg-[var(--surface)] p-5 transition-transform hover:-translate-y-0.5 md:p-6" aria-label="Open invoice 1">
          <div className="rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--muted)]">Invoice #1, read live</p>
              {data && <Pill tone="good">{BigInt(data.invoice.payer) !== 0n ? "Paid" : "Unpaid"}</Pill>}
            </div>
            <p className="mt-3 text-5xl font-semibold tracking-tight">
              {data ? tusd(data.invoice.amount) : "…"} <span className="text-2xl">tUSD</span>
            </p>
            <div className="mt-6 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted)]">Merchant</span>
                <span className="font-medium">{data ? short(data.invoice.merchant) : "…"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted)]">Paid by</span>
                <span className="font-medium">{data && BigInt(data.invoice.payer) !== 0n ? short(data.invoice.payer) : "…"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted)]">Payer's tPOT balance</span>
                <span className="font-medium">{data ? `${Number(formatEther(data.payerTpot))} tPOT` : "…"}</span>
              </div>
            </div>
          </div>
          <p className="mt-3 px-2 text-center text-xs text-[var(--muted)]">Funded from Base Sepolia through the relayer, which paid the gas.</p>
        </Link>
      </section>

      <div className="mx-auto max-w-6xl px-4 pt-8 md:px-6">
        {error && <Notice>Could not read the chain: {(error as Error).message.split("\n")[0]}</Notice>}
        {data && data.relayerTpot < LOW_TPOT && (
          <Notice>The relayer has {Number(formatEther(data.relayerTpot)).toFixed(2)} tPOT. New gasless actions may fail until it is topped up, because each new storage slot costs about 3.84 tPOT.</Notice>
        )}
      </div>

      <section className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 pt-8 md:grid-cols-4 md:px-6">
        <Stat label="Latest block" value={data?.block.toString()} />
        <Stat label="Invoices created" value={data?.invoices.toString()} />
        <Stat label="Receipts issued" value={data?.receipts.toString()} />
        <Stat label="Bridge reserve (tUSD)" value={data ? tusd(data.reserve) : undefined} />
      </section>

      <section id="story" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-16 md:px-6 md:pt-24">
        <Pill tone="good">Really happened on testnets</Pill>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold md:text-5xl">One payment goes wrong. The next one settles instantly.</h2>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">Crypto payments normally can't be undone. Here is one AI agent making two purchases, with what happened at every step.</p>
        <ol className="mt-8 space-y-3">
          {STORY.map((step, index) => {
            const onBase = step.chain === "Base Sepolia";
            return (
              <li key={step.hash} className="flex flex-col gap-3 rounded-2xl bg-[var(--surface)] p-4 md:flex-row md:items-center md:justify-between md:gap-6 md:p-5">
                <div className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-sm font-semibold text-white">{index + 1}</span>
                  <p className="pt-1 font-medium">{step.text}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 pl-11 md:pl-0">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${onBase ? "bg-[var(--sky)]" : "bg-[var(--warn-bg)] text-[var(--warn-ink)]"}`}>{step.chain}</span>
                  {onBase ? (
                    <a className="text-sm underline underline-offset-2" href={`https://sepolia.basescan.org/tx/${step.hash}`} target="_blank" rel="noreferrer"><code>{short(step.hash)}</code></a>
                  ) : (
                    <code className="text-sm">{short(step.hash)}</code>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-semibold">
          <Link className="underline underline-offset-4" href="/payment/4">See New Shop's payment</Link>
          <Link className="underline underline-offset-4" href="/payment/5">See Trusted Coffee's payment</Link>
          <a className="underline underline-offset-4" href={EVIDENCE} target="_blank" rel="noreferrer">See every transaction</a>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">Test tokens, and our own demo runs: Trusted Coffee's score comes from real purchases we made, not from customers. The arbiter is one admin address.</p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-16 md:px-6 md:pt-20">
        <Pill>Why they were treated differently</Pill>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold md:text-5xl">Reputation sets the hold and the agent's limit</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {TIERS.map(([name, condition, hold, cap]) => (
            <div key={name} className="rounded-3xl bg-[var(--surface)] p-6 md:p-7">
              <h3 className="text-2xl font-semibold">{name}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{condition}</p>
              <div className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
                <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Payment hold</span><span className="font-semibold">{hold}</span></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Agent cap per payment</span><span className="font-semibold">{cap}</span></div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">Demo values, enforced on-chain. Reputation is read from ERC-8004 on Base, and every settled outcome writes back to it.</p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-16 md:px-6 md:pt-20">
        <Pill>Source chains</Pill>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">Pay from Base or BNB, settle on Portaldot</h2>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">Lock test mUSDC on either chain, and one trusted relayer credits you on Portaldot. The agent has an ERC-8004 identity on both: number 10589 on Base Sepolia and 2723 on BNB testnet. Bridge-out has run back to Base. To BNB it is enabled but not yet run.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[
            { name: "Base Sepolia", lock: "0x1e8fddc7ce961eee32eb158aeb1eeb8dd669b1f993366a9248ac013eb0d00364", credit: "0xb0d9b610ecdb280b356c9be2c9919b4770f470b662ed9d0907297fa8be8e9bf1" },
            { name: "BNB testnet", lock: "0xc210a9bb20b85c55b4868510be1259d33e6f1d80e1050fd1b372135c8b97e048", credit: "0x34f3eb5c34f527da86940237f86bf1a9eeed94417f589639c9e30b063d63b0b8" },
          ].map((chain) => (
            <div key={chain.name} className="rounded-3xl bg-[var(--surface)] p-6 md:p-7">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-2xl font-semibold">{chain.name}</h3>
                <Pill tone="good">Live, funds in</Pill>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Lock</span><code className="font-medium">{short(chain.lock)}</code></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Credit on Portaldot</span><code className="font-medium">{short(chain.credit)}</code></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20 md:px-6 md:pt-28">
        <div className="text-center">
          <Pill>How it works</Pill>
          <h2 className="mx-auto mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">One path for every payment</h2>
        </div>
        <ol className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
          {STEPS.map(([number, title, text, tone]) => (
            <li key={number} className={`flex min-h-72 flex-col items-center rounded-full px-4 pt-14 pb-5 text-center md:min-h-96 md:px-6 ${tone}`}>
              <h3 className="text-xl font-semibold md:text-2xl">{title}</h3>
              <p className="mt-2 text-sm leading-snug opacity-80">{text}</p>
              <span className="mt-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-[var(--ink)]">{number}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20 md:px-6 md:pt-28">
        <Pill>What it does</Pill>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">Money that can move, and come back</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {RAILS.map((rail) => {
            const live = !rail.key || Boolean(reader.addresses[rail.key]);
            return (
              <div key={rail.name} className="flex flex-col rounded-3xl bg-[var(--surface)] p-6 md:p-7">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-2xl font-semibold">{rail.name}</h3>
                  <Pill tone={live ? "good" : "orange"}>{live ? "Live on Portaldot" : "Built, not deployed"}</Pill>
                </div>
                <p className="mt-2 text-[var(--muted)]">{rail.text}</p>
                <Link href={rail.href} className="mt-4 font-semibold underline underline-offset-4">{rail.cta}</Link>
              </div>
            );
          })}
          <div className="flex flex-col rounded-3xl bg-[var(--ink)] p-6 text-white md:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-2xl font-semibold">Agents</h3>
              <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">On-chain limits</span>
            </div>
            <p className="mt-2 text-white/75">Session keys with limits per payment and per day, an approval queue for anything over them, and an MCP server.</p>
            <Link href="/agent" className="mt-4 font-semibold underline underline-offset-4">Open the agent console</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-16 md:px-6 md:pt-20">
        <Pill>Multi-chain rails</Pill>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">Run anywhere, settle on Portaldot</h2>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">These rails run on Base Sepolia, and you can use them in the app. Settle your balance to Portaldot whenever you want, through one trusted relayer. Each step on Base needs a little Base test ETH.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {BASE_RAILS.map((rail) => (
            <div key={rail.name} className="flex flex-col rounded-3xl bg-[var(--surface)] p-6 md:p-7">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-2xl font-semibold">{rail.name}</h3>
                <Pill tone={baseSepoliaDeployments[rail.contract] ? "good" : "orange"}>{baseSepoliaDeployments[rail.contract] ? "Live on Base Sepolia" : "Built, not deployed"}</Pill>
              </div>
              <p className="mt-2 text-[var(--muted)]">{rail.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 md:px-6 md:pt-28">
        <div className="rounded-[2rem] bg-[var(--sky)]/45 p-6 md:p-12">
          <Pill>Recorded on-chain</Pill>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">From Base to Portaldot, with no gas</h2>
          <ol className="mt-8 space-y-3">
            {PROOF.map(([step, chain, hash], index) => (
              <li key={hash} className="flex flex-col gap-1 rounded-2xl bg-white p-4 md:flex-row md:items-center md:justify-between md:gap-6 md:p-5">
                <span className="font-semibold">
                  {index + 1}. {step} <span className="font-normal text-[var(--muted)]">on {chain}</span>
                </span>
                <code className="text-xs break-all text-[var(--muted)] md:text-sm">{short(hash)}</code>
              </li>
            ))}
          </ol>
          <a className="mt-5 inline-block font-semibold underline underline-offset-4" href={EVIDENCE} target="_blank" rel="noreferrer">
            See every transaction and its cost
          </a>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pt-5 md:grid-cols-2 md:px-6">
        <div className="rounded-3xl bg-[var(--surface)] p-6 md:p-7">
          <h3 className="text-2xl font-semibold">Contracts</h3>
          <div className="mt-4 space-y-2 text-sm">
            {[
              ["tUSD", reader.addresses.token],
              ["Core", reader.addresses.core],
              ["Lockbox (Base Sepolia)", LOCKBOX],
              ["Lockbox (BNB testnet)", bnbTestnetDeployments.TalariaLockboxV2],
            ].map(([label, address]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-[var(--muted)]">{label}</span>
                <code className="font-medium">{address ? short(address) : "Not deployed"}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-[var(--surface)] p-6 md:p-7">
          <h3 className="text-2xl font-semibold">What to trust, and what not to</h3>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">This is a testnet build with no audit. One trusted relayer runs the bridge, and one key holds the admin roles. A multi-signer bridge is on the roadmap. The relayer has {data ? Number(formatEther(data.relayerTpot)).toFixed(2) : "…"} tPOT now.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-16 md:px-6 md:pt-20">
        <Pill>For developers</Pill>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">Build on Talaria</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {DEVELOPERS.map(([href, name, text]) => (
            <Link key={href} href={href} className="flex flex-col rounded-3xl bg-[var(--surface)] p-6 transition-colors hover:bg-[var(--surface-2)] md:p-7">
              <h3 className="text-2xl font-semibold">{name}</h3>
              <p className="mt-2 text-[var(--muted)]">{text}</p>
              <span className="mt-4 font-semibold underline underline-offset-4">Read more</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-5 md:px-6">
        <div className="flex flex-col items-start justify-between gap-5 rounded-[2rem] bg-[var(--ink)] p-6 text-white md:flex-row md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-semibold md:text-4xl">Try it on testnet</h2>
            <p className="mt-2 text-white/75">Test tokens only. They have no value.</p>
          </div>
          <Link href="/wallet" className="flex min-h-12 shrink-0 items-center rounded-full bg-white px-6 font-semibold text-[var(--ink)] transition-opacity hover:opacity-85">
            Open app
          </Link>
        </div>
      </section>
    </>
  );
}
