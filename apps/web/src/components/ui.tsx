"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { explain, short } from "@/lib/talaria";

const NAV = [
  ["/", "Status"],
  ["/wallet", "Wallet"],
  ["/merchant", "Merchant"],
  ["/streams", "Streams"],
  ["/agent", "Agent"],
  ["/remit", "Remit"],
] as const;

export function Connect() {
  const { address } = useConnection();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  if (address) {
    return (
      <button onClick={() => disconnect()} className="min-h-11 rounded-full border border-[var(--line)] px-4 text-sm" title="Disconnect">
        {short(address)}
      </button>
    );
  }
  return (
    <button onClick={() => connectors[0] && connect({ connector: connectors[0] })} className="min-h-11 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-ink)]">
      Connect wallet
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-4">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Talaria <span className="text-[var(--gold)]">⟡</span>
        </Link>
        <Connect />
      </header>
      <p className="mb-3 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-ink)]">
        Testnet only. tUSD and mUSDC are test tokens with no value. The bridge uses one trusted relayer.
      </p>
      <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className={`shrink-0 rounded-full px-3 py-2 text-sm ${path === href ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--muted)]"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <main className="space-y-4">{children}</main>
    </div>
  );
}

export function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 className="font-medium">{title}</h2>
      {note && <p className="mt-1 text-sm text-[var(--muted)]">{note}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-[var(--line)] px-3 py-4 text-center text-sm text-[var(--muted)]">{children}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn-ink)]">{children}</p>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="min-w-0 text-right break-all">{children}</span>
    </div>
  );
}

export function Field(props: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { label, ...input } = props;
  return (
    <label>
      {label}
      <input className="mt-1" {...input} />
    </label>
  );
}

/** A real transaction hash, copyable, with an explorer link where one exists. */
export function TxHash({ hash, chain = "portaldot" }: { hash: string; chain?: "portaldot" | "base" }) {
  const [copied, setCopied] = useState(false);
  const href = chain === "base" ? `https://sepolia.basescan.org/tx/${hash}` : "https://node-console.portaldot.dev/";
  return (
    <div className="rounded-lg bg-[var(--bg)] p-2 text-xs">
      <code className="block break-all">{hash}</code>
      <div className="mt-1 flex gap-4">
        <button
          className="min-h-8 underline"
          onClick={async () => {
            await navigator.clipboard.writeText(hash);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="min-h-8 leading-8 underline" href={href} target="_blank" rel="noreferrer">
          {chain === "base" ? "BaseScan" : "Node console"}
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
        className={`min-h-11 w-full rounded-xl px-4 font-medium disabled:opacity-50 ${secondary ? "border border-[var(--line)]" : "bg-[var(--accent)] text-[var(--accent-ink)]"}`}
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
  if (!address) return <Empty>Connect a wallet to use this.</Empty>;
  return <>{children}</>;
}
