"use client";

import { useState } from "react";
import type { Address } from "viem";
import { ActionButton, Card, Field, NeedsWallet, Notice } from "@/components/ui";
import { reader, signer } from "@/lib/talaria";

export default function Streams() {
  const [to, setTo] = useState("");
  const [rate, setRate] = useState("100");
  const [deposit, setDeposit] = useState("10");
  const [streamId, setStreamId] = useState("");
  const [planId, setPlanId] = useState("");
  const [subId, setSubId] = useState("");

  return (
    <NeedsWallet>
      <Card title="Stream" note="Pay per second from a deposit. The receiver can withdraw what has accrued, and stopping refunds the rest.">
        {reader.addresses.streams ? (
          <>
            <Field label="Receiver (0x…)" value={to} onChange={(e) => setTo(e.target.value)} />
            <Field label="Rate per month (tUSD)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            <Field label="Deposit (tUSD)" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            <ActionButton
              label="Start stream"
              run={async () => (await (await signer()).startStream({ to: to as Address, ratePerMonth: rate, deposit })).txHash}
            />
            <Field label="Stream number" inputMode="numeric" value={streamId} onChange={(e) => setStreamId(e.target.value)} />
            <ActionButton secondary label="Withdraw accrued (receiver)" disabled={!streamId} run={async () => (await signer()).withdraw(BigInt(streamId))} />
            <ActionButton secondary label="Stop stream (sender)" disabled={!streamId} run={async () => (await signer()).stopStream(BigInt(streamId))} />
          </>
        ) : (
          <Notice>This streams contract runs on Base Sepolia, with real transactions in the evidence log. It is not on Portaldot yet, so this page cannot use it from here.</Notice>
        )}
      </Card>
      <Card title="Subscribe" note="Approve once. Charges only happen when a period is due, up to the plan's limit.">
        {reader.addresses.subscriptions ? (
          <>
            <Field label="Plan number" inputMode="numeric" value={planId} onChange={(e) => setPlanId(e.target.value)} />
            <ActionButton label="Subscribe" disabled={!planId} run={async () => (await (await signer()).subscribe(BigInt(planId))).txHash} />
            <Field label="Subscription number" inputMode="numeric" value={subId} onChange={(e) => setSubId(e.target.value)} />
            <ActionButton secondary label="Cancel subscription" disabled={!subId} run={async () => (await signer()).cancel(BigInt(subId))} />
          </>
        ) : (
          <Notice>This subscriptions contract runs on Base Sepolia, with real transactions in the evidence log. It is not on Portaldot yet, so this page cannot use it from here.</Notice>
        )}
      </Card>
    </NeedsWallet>
  );
}
