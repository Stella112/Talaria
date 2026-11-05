"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const PAGES = [
  ["/docs", "Overview"],
  ["/docs/sdk", "SDK"],
  ["/docs/mcp", "MCP server"],
] as const;

export function DocsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="no-scrollbar flex gap-1 overflow-x-auto md:sticky md:top-24 md:flex-col">
      {PAGES.map(([href, label]) => (
        <Link key={href} href={href} className={`flex min-h-10 shrink-0 items-center rounded-full px-3.5 text-sm font-medium ${path === href ? "bg-[var(--surface-2)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const text = children.trim();
  return (
    <div className="relative mt-3 rounded-2xl bg-[var(--ink)] text-white">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
        className="absolute top-2 right-2 min-h-8 rounded-full bg-white/15 px-3 text-xs font-medium"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-4 pt-12 text-[13px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24 first:mt-0">
      <h2 className="text-2xl font-semibold md:text-3xl">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed text-[var(--muted)]">{children}</div>
    </section>
  );
}

export function Inline({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.9em] break-words text-[var(--ink)]">{children}</code>;
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} className="border-b border-[var(--line)] px-4 py-3 font-semibold whitespace-nowrap text-[var(--ink)]">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-[var(--line)] last:border-0">
              {row.map((cell, column) => (
                <td key={column} className="px-4 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
