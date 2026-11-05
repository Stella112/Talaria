"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatEther } from "viem";
import { useConnection } from "wagmi";
import { ActionButton, Field, Pill, Row } from "@/components/ui";
import { baseBalances, fundOnBase, settleToPortaldot } from "@/lib/base-rails";
import { tusd } from "@/lib/talaria";

/** The Base side of the rails: balances, getting test funds, and settling to Portaldot. */
export function BaseAccount() {
  const { address } = useConnection();
  const [settleAmount, setSettleAmount] = useState("1");
  const balances = useQuery({
    queryKey: ["base-account", address],
    enabled: Boolean(address),
    refetchInterval: 15_000,
    queryFn: () => baseBalances(address!),
  });
  const noGas = balances.data?.eth === 0n;

  return (
    <section className="mb-5 rounded-3xl bg-[var(--surface)] p-5 md:col-span-2 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Your account on Base</h2>
        <Pill tone="good">Runs on Base Sepolia, settles to Portaldot</Pill>
      </div>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
        This rail runs on Base Sepolia with test mUSDC. Your wallet signs each step and pays Base test ETH for gas. Settle to Portaldot whenever you want the money there.
      </p>
      {noGas && <p className="mt-3 rounded-2xl bg-[var(--warn-bg)] px-4 py-3 text-sm text-[var(--warn-ink)]">This wallet has no Base Sepolia test ETH, so transactions here will fail. Get some from a Base Sepolia faucet first.</p>}
      <div className="mt-4 grid gap-5 md:grid-cols-3">
        <div className="space-y-2 rounded-2xl bg-white p-4">
          <Row label="Talaria account">{balances.data ? `${tusd(balances.data.account)} mUSDC` : "…"}</Row>
          <Row label="In wallet">{balances.data ? `${tusd(balances.data.wallet)} mUSDC` : "…"}</Row>
          <Row label="Gas">{balances.data ? `${Number(formatEther(balances.data.eth)).toFixed(5)} ETH` : "…"}</Row>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">Get 10 test mUSDC. You confirm 3 transactions: mint, approve and deposit.</p>
          <ActionButton
            label="Get test funds"
            chain="base"
            run={async () => {
              const hash = await fundOnBase("10");
              await balances.refetch();
              return hash;
            }}
          />
        </div>
        <div className="space-y-3">
          <Field label="Settle to Portaldot (mUSDC)" inputMode="decimal" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} />
          <ActionButton
            secondary
            label="Settle to Portaldot"
            chain="base"
            run={async () => {
              const hash = await settleToPortaldot(settleAmount, address!);
              await balances.refetch();
              return hash;
            }}
          />
          <p className="text-xs leading-relaxed text-[var(--muted)]">You confirm 3 transactions: withdraw, approve and lock. One trusted relayer then credits you in tUSD on Portaldot, usually within a few minutes. See it on your Wallet page.</p>
        </div>
      </div>
    </section>
  );
}
