"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { explain, short } from "@/lib/talaria";

const APP_NAV = [
  ["/wallet", "Wallet"],
  ["/merchant", "Merchant"],
  ["/agent", "Agent"],
  ["/streams", "Streams"],
  ["/remit", "Remit"],
  ["/docs", "Docs"],
] as const;

const SITE_NAV = [
  ["/docs", "Docs"],
  ["/docs/sdk", "SDK"],
  ["/docs/mcp", "MCP"],
] as const;

export function Connect() {
  const { address } = useConnection();
  const { connect, connectors, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [help, setHelp] = useState<string>();
  const shown = help ?? (error ? explain(error) : undefined);
  if (address) {
    return (
      <button onClick={() => disconnect()} className="min-h-11 shrink-0 rounded-full border border-[var(--line)] bg-white px-4 text-sm font-medium" title="Disconnect">
        {short(address)}
      </button>
    );
  }
  const start = () => {
    if (!(window as { ethereum?: unknown }).ethereum) {
      setHelp("No wallet found in this browser. Install MetaMask, or open this page in your wallet app's browser. You can try the hosted agent on the Agent page with no wallet.");
      return;
    }
    setHelp(undefined);
    if (connectors[0]) connect({ connector: connectors[0] });
  };
  return (
    <>
    {shown && (
      <p role="alert" className="fixed right-4 bottom-4 left-4 z-50 rounded-2xl bg-[var(--ink)] p-4 text-sm text-white md:left-auto md:max-w-md">
        {shown}
      </p>
    )}
    <button
      onClick={start}
      className="min-h-11 shrink-0 rounded-full bg-[var(--ink)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-85"
    >
      Connect wallet
    </button>
    </>
  );
}

export function Pill({ children, tone = "line" }: { children: ReactNode; tone?: "line" | "good" | "orange" }) {
  const tones = {
    line: "border border-[var(--ink)]/25 text-[var(--ink)]",
    good: "bg-[var(--good-bg)] text-[var(--good)]",
    orange: "bg-[var(--warn-bg)] text-[var(--warn-ink)]",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // The landing page and docs are the site. Everything else is the app.
  const onSite = path === "/" || path.startsWith("/docs");
  const NAV = onSite ? SITE_NAV : APP_NAV;
  const active = (href: string) => (onSite ? path === href : path.startsWith(href));
  return (
    <div className="min-h-screen">
      <p className="bg-[var(--ink)] px-4 py-2 text-center text-xs font-medium text-white">
        Testnet only. tUSD and mUSDC have no value. The bridge uses one trusted relayer.
      </p>
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-semibold tracking-tight">
            <span aria-hidden className="h-6 w-3.5 rounded-full bg-[var(--orange)]" />
            Talaria
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${active(href) ? "bg-[var(--surface-2)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                {label}
              </Link>
            ))}
          </nav>
          {onSite ? (
            <Link href="/wallet" className="flex min-h-11 shrink-0 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-85">
              Open app
            </Link>
          ) : (
            <Connect />
          )}
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={`flex min-h-10 shrink-0 items-center rounded-full px-3.5 text-sm font-medium ${active(href) ? "bg-[var(--surface-2)]" : "text-[var(--muted)]"}`}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main>{children}</main>
      <footer className="mt-20 border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-[var(--muted)] md:flex-row md:justify-between md:px-6">
          <span>Talaria. Open source under MIT.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="underline underline-offset-4" href="/docs">Docs</Link>
            <Link className="underline underline-offset-4" href="/docs/sdk">SDK</Link>
            <Link className="underline underline-offset-4" href="/docs/mcp">MCP</Link>
            <a className="underline underline-offset-4" href="https://github.com/Stella112/Talaria" target="_blank" rel="noreferrer">
              Code and on-chain evidence on GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Heading and card layout for the app pages. */
export function Page({ eyebrow, title, intro, narrow, children }: { eyebrow: string; title: string; intro: string; narrow?: boolean; children: ReactNode }) {
  return (
    <div className={`mx-auto px-4 pt-10 md:px-6 md:pt-16 ${narrow ? "max-w-xl" : "max-w-6xl"}`}>
      <Pill>{eyebrow}</Pill>
      <h1 className="mt-4 max-w-3xl text-4xl font-semibold md:text-6xl">{title}</h1>
      <p className="mt-4 mb-8 max-w-2xl text-lg text-[var(--muted)] md:mb-12">{intro}</p>
      <div className={narrow ? "" : "gap-5 md:columns-2"}>{children}</div>
    </div>
  );
}

export function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="mb-5 break-inside-avoid rounded-3xl bg-[var(--surface)] p-5 md:p-7">
      <h2 className="text-xl font-semibold">{title}</h2>
      {note && <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">{note}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="mb-5 rounded-2xl border border-dashed border-[var(--line)] bg-white px-4 py-6 text-center text-sm text-[var(--muted)]">{children}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="mb-5 rounded-2xl bg-[var(--warn-bg)] px-4 py-3 text-sm leading-relaxed text-[var(--warn-ink)]">{children}</p>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="min-w-0 text-right font-medium break-all">{children}</span>
    </div>
  );
}

export function Field(props: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { label, ...input } = props;
  return (
    <label>
      {label}
      <input className="mt-1.5" {...input} />
    </label>
  );
}

/** A real transaction hash, copyable, with an explorer link where one exists. */
const EXPLORERS = { base: ["BaseScan", "https://sepolia.basescan.org/tx/"], bnb: ["BscScan", "https://testnet.bscscan.com/tx/"] } as const;

export function TxHash({ hash, chain = "portaldot" }: { hash: string; chain?: "portaldot" | "base" | "bnb" }) {
  const [copied, setCopied] = useState(false);
  const href = chain === "portaldot" ? "https://node-console.portaldot.dev/" : `${EXPLORERS[chain][1]}${hash}`;
  return (
    <div className="rounded-2xl bg-white p-3 text-xs">
      <code className="block break-all">{hash}</code>
      <div className="mt-1 flex gap-4 font-medium">
        <button
          className="min-h-8 underline underline-offset-2"
          onClick={async () => {
            await navigator.clipboard.writeText(hash);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="min-h-8 leading-8 underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
          {chain === "portaldot" ? "Node console" : EXPLORERS[chain][0]}
        </a>
      </div>
    </div>
  );
}

/** Button that runs an action and shows its real result or real error. */
export function ActionButton({
  label,
  run,
  disabled,
  secondary,
  chain,
}: {
  label: string;
  run: () => Promise<unknown>;
  disabled?: boolean;
  secondary?: boolean;
  chain?: "portaldot" | "base";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hash, setHash] = useState<string>();
  return (
    <div className="space-y-2">
      <button
        disabled={busy || disabled}
        className={`min-h-12 w-full rounded-full px-5 font-semibold transition-opacity hover:opacity-85 disabled:opacity-40 ${secondary ? "border border-[var(--ink)]/25 bg-white" : "bg-[var(--ink)] text-white"}`}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          setHash(undefined);
          try {
            const result = (await run()) as string | { txHash?: string } | undefined;
            const tx = typeof result === "string" ? result : result?.txHash;
            if (tx) setHash(tx);
          } catch (caught) {
            setError(explain(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Waiting…" : label}
      </button>
      {error && <p className="text-sm break-words text-[var(--bad)]">{error}</p>}
      {hash && <TxHash hash={hash} chain={chain} />}
    </div>
  );
}

export function NeedsWallet({ children }: { children: ReactNode }) {
  const { address } = useConnection();
  if (!address) {
    return (
      <section className="flex flex-col items-start gap-4 rounded-3xl bg-[var(--surface)] p-6 md:p-8">
        <div>
          <h2 className="text-xl font-semibold">Connect a wallet to continue</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Your key stays in your wallet. Talaria only asks for signatures.</p>
        </div>
        <Connect />
      </section>
    );
  }
  return <>{children}</>;
}
