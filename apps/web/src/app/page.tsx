"use client";

import { TalariaCoreAbi, type Addresses } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatEther } from "viem";
import { Notice, Pill } from "@/components/ui";
import { client, LOCKBOX, reader, short, tusd } from "@/lib/talaria";

const LOW_TPOT = 8n * 10n ** 18n; // one new invoice costs about 7.7 tPOT
const EVIDENCE = "https://github.com/Stella112/Talaria/blob/main/evidence/TRANSACTIONS.md";

const STEPS = [
  ["01", "Intent", "A person or agent signs what they want to pay.", "bg-[var(--surface-2)]"],
  ["02", "Policy", "Limits are checked on-chain, not in an app.", "bg-[var(--sky)]"],
  ["03", "Execute", "A relayer submits it and pays the gas.", "bg-[var(--orange)]"],
  ["04", "Receipt", "Every payment leaves a verifiable event.", "bg-[var(--ink)] text-white"],
] as const;

const RAILS: { name: string; text: string; key?: keyof Addresses }[] = [
  { name: "Checkout", text: "Invoices, payment links and refunds, paid gaslessly." },
  { name: "Pay-per-call", text: "HTTP 402 APIs paid with vouchers that settle in one transaction.", key: "channels" },
  { name: "Subscriptions", text: "Merchant plans charged only when due, within a cap.", key: "subscriptions" },
  { name: "Streaming", text: "Per-second payments with computed accrual.", key: "streams" },
  { name: "Remittance", text: "Send to an address or a claim link, cancellable until claimed.", key: "remit" },
];

const PROOF = [
  ["Lock 10 mUSDC", "Base Sepolia", "0x1e8fddc7ce961eee32eb158aeb1eeb8dd669b1f993366a9248ac013eb0d00364"],
  ["Relayer credits the payer", "Portaldot", "0xb0d9b610ecdb280b356c9be2c9919b4770f470b662ed9d0907297fa8be8e9bf1"],
  ["Payer with 0 tPOT pays invoice 1", "Portaldot", "0x7fe8f26f10f5ad7f2e9a8a06348eef6ba26a0515697a778dd2e15059e45000ab"],
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
          <h1 className="mt-5 text-5xl leading-[1.05] font-semibold md:text-7xl">Payments with wings.</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
            The payment layer for people and AI agents on Portaldot. Fund from another chain, pay without gas, and keep every payment policy-checked and receipted on-chain.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/merchant" className="flex min-h-12 items-center rounded-full bg-[var(--ink)] px-6 font-semibold text-white transition-opacity hover:opacity-85">
              Create a payment link
            </Link>
            <a href="#proof" className="flex min-h-12 items-center rounded-full border border-[var(--ink)]/25 px-6 font-semibold">
              See the proof
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
        <Pill>Five rails</Pill>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold md:text-5xl">Every way to get paid</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {RAILS.map((rail) => {
            const live = !rail.key || Boolean(reader.addresses[rail.key]);
            return (
              <div key={rail.name} className="flex flex-col rounded-3xl bg-[var(--surface)] p-6 md:p-7">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-2xl font-semibold">{rail.name}</h3>
                  <Pill tone={live ? "good" : "orange"}>{live ? "Deployed" : "Built, not deployed"}</Pill>
                </div>
                <p className="mt-2 text-[var(--muted)]">{rail.text}</p>
              </div>
            );
          })}
          <div className="flex flex-col rounded-3xl bg-[var(--ink)] p-6 text-white md:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-2xl font-semibold">Agents</h3>
              <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">On-chain limits</span>
            </div>
            <p className="mt-2 text-white/75">Session keys with limits per payment and per day, an approval queue for anything over them, and an MCP server.</p>
          </div>
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
    </>
  );
}
