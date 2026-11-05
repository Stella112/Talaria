"use client";

import { TalariaStreamsAbi, TalariaSubscriptionsAbi, toUnits } from "@talaria-pay/sdk";
import { useState } from "react";
import type { Address } from "viem";
import { BaseAccount } from "@/components/base-account";
import { ActionButton, Card, Field, NeedsWallet, Notice } from "@/components/ui";
import { BASE, baseTx, eventId } from "@/lib/base-rails";

const SECONDS_PER_MONTH = 2_592_000n;
const TRUSTED_COFFEE = "0x98C89a07e45A33f793DD085D4E8EB630711c52f2";

export default function Streams() {
  const [to, setTo] = useState<string>(TRUSTED_COFFEE);
  const [rate, setRate] = useState("100");
  const [deposit, setDeposit] = useState("5");
  const [streamId, setStreamId] = useState("");
  const [planId, setPlanId] = useState("1");
  const [subId, setSubId] = useState("");

  return (
    <NeedsWallet>
      <BaseAccount />
      <Card title="Stream" note="Pay per second from a deposit. The receiver can withdraw what has accrued, and stopping refunds the rest. The receiver starts as our demo merchant, Trusted Coffee.">
        <Field label="Receiver (0x…)" value={to} onChange={(e) => setTo(e.target.value)} />
        <Field label="Rate per month (mUSDC)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        <Field label="Deposit (mUSDC)" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        <ActionButton
          label="Start stream"
          chain="base"
          run={async () => {
            const perSecond = toUnits(rate) / SECONDS_PER_MONTH;
            if (perSecond === 0n) throw new Error("That rate is too low. Use at least 2.6 mUSDC a month.");
            const { hash, receipt } = await baseTx(BASE.streams, TalariaStreamsAbi, "startStream", [to as Address, perSecond, toUnits(deposit)]);
            setStreamId(eventId(receipt, TalariaStreamsAbi, "StreamStarted").toString());
            return hash;
          }}
        />
        <Field label="Stream number" inputMode="numeric" value={streamId} onChange={(e) => setStreamId(e.target.value)} />
        <ActionButton secondary chain="base" label="Withdraw accrued (receiver)" disabled={!streamId} run={async () => (await baseTx(BASE.streams, TalariaStreamsAbi, "withdraw", [BigInt(streamId)])).hash} />
        <ActionButton secondary chain="base" label="Stop stream (sender)" disabled={!streamId} run={async () => (await baseTx(BASE.streams, TalariaStreamsAbi, "stopStream", [BigInt(streamId)])).hash} />
      </Card>
      <Card title="Subscribe" note="Subscribe once. Charges only happen when a period is due, up to the plan's limit, and anyone can trigger a charge that is due.">
        <Notice>Plan 1 is our demo plan: 1 mUSDC every minute, for 3 periods, paid to Trusted Coffee.</Notice>
        <Field label="Plan number" inputMode="numeric" value={planId} onChange={(e) => setPlanId(e.target.value)} />
        <ActionButton
          label="Subscribe"
          chain="base"
          disabled={!planId}
          run={async () => {
            const { hash, receipt } = await baseTx(BASE.subscriptions, TalariaSubscriptionsAbi, "subscribe", [Number(planId)]);
            setSubId(eventId(receipt, TalariaSubscriptionsAbi, "Subscribed").toString());
            return hash;
          }}
        />
        <Field label="Subscription number" inputMode="numeric" value={subId} onChange={(e) => setSubId(e.target.value)} />
        <ActionButton secondary chain="base" label="Charge if due" disabled={!subId} run={async () => (await baseTx(BASE.subscriptions, TalariaSubscriptionsAbi, "charge", [BigInt(subId)])).hash} />
        <ActionButton secondary chain="base" label="Cancel subscription" disabled={!subId} run={async () => (await baseTx(BASE.subscriptions, TalariaSubscriptionsAbi, "cancel", [BigInt(subId)])).hash} />
      </Card>
    </NeedsWallet>
  );
}
