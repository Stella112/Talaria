"use client";

import { TalariaProtectAbi } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useConnection } from "wagmi";
import { ActionButton, Card, Empty, Notice, Pill, Row, TxHash } from "@/components/ui";
import { client, CORE_DEPLOY_BLOCK, explain, reader, short, signer, tusd } from "@/lib/talaria";

const LABELS: Record<string, string> = {
  TrustApplied: "Reputation attested from Base",
  PaymentOpened: "Paid on Portaldot",
  PaymentDisputed: "Disputed by the buyer",
  PaymentResolved: "Resolved by the arbiter",
  PaymentRefunded: "Refunded by the merchant",
  PaymentReleased: "Released to the merchant",
};

export default function PaymentPage() {
  const params = useParams<{ id: string }>();
  const { address } = useConnection();
  const valid = /^\d+$/.test(params.id);
  const id = valid ? BigInt(params.id) : 0n;
  const protect = reader.addresses.protect;

  const payment = useQuery({ queryKey: ["payment", params.id], enabled: valid && Boolean(protect), queryFn: () => reader.getPayment(id) });
  const events = useQuery({
    queryKey: ["payment-events", params.id],
    enabled: valid && Boolean(protect),
    queryFn: async () => {
      const logs = await client.getContractEvents({ address: protect!, abi: TalariaProtectAbi as any, fromBlock: CORE_DEPLOY_BLOCK });
      return logs.filter((log: any) => (log.args.id ?? log.args.paymentId) === id && LABELS[log.eventName]) as any[];
    },
  });

  if (!valid) return <Empty>That is not a valid payment number.</Empty>;
  if (!protect) return <Notice>TalariaProtect is built and tested locally, but it is not deployed on this network yet, so there are no protected payments to show.</Notice>;
  if (payment.error) return <Notice>Could not read the payment: {explain(payment.error)}</Notice>;
  const data = payment.data;
  if (!data) return <Empty>Loading from the chain…</Empty>;
  if (BigInt(data.buyer) === 0n) return <Empty>Payment #{params.id} does not exist.</Empty>;
  const held = data.status === "held";
  const windowOpen = held && Date.now() / 1000 < data.releaseAt;

  return (
    <>
      <Card title={`Payment #${params.id}`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-5xl font-semibold tracking-tight">
            {tusd(data.amount)} <span className="text-2xl">tUSD</span>
          </p>
          <Pill tone={data.status === "released" ? "good" : "orange"}>{data.status.replace("_", " ")}</Pill>
        </div>
        <Row label="Buyer">{short(data.buyer)}</Row>
        <Row label="Merchant">{short(data.merchant)}</Row>
        {data.refunded > 0n && <Row label="Refunded">{tusd(data.refunded)} tUSD</Row>}
        {held && <Row label="Releases">{new Date(data.releaseAt * 1000).toLocaleString()}</Row>}
        {windowOpen && address?.toLowerCase() === data.buyer.toLowerCase() && (
          <ActionButton
            secondary
            label="Dispute this payment"
            run={async () => {
              const hash = await (await signer()).dispute(id);
              await Promise.all([payment.refetch(), events.refetch()]);
              return hash;
            }}
          />
        )}
      </Card>
      <Card title="Timeline" note="All steps here are on Portaldot. Reputation written back to Base is listed in the evidence log.">
        {events.data?.length ? (
          <ol className="space-y-3">
            {events.data.map((log) => (
              <li key={`${log.transactionHash}-${log.logIndex}`} className="space-y-1">
                <p className="text-sm font-semibold">{LABELS[log.eventName]}</p>
                {log.eventName === "TrustApplied" && <p className="text-sm text-[var(--muted)]">Score {log.args.score}, read at Base block {log.args.srcBlock.toString()}</p>}
                <TxHash hash={log.transactionHash} />
              </li>
            ))}
          </ol>
        ) : (
          <Empty>{events.isLoading ? "Loading…" : "No events found. The RPC may have pruned older logs."}</Empty>
        )}
      </Card>
    </>
  );
}
