"use client";

import { TalariaCoreAbi } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { getWalletClient } from "wagmi/actions";
import { portaldotTestnet } from "@talaria-pay/sdk";
import { TrustBadge } from "@/components/trust";
import { useConnection } from "wagmi";
import { ActionButton, Card, Empty, Field, NeedsWallet, Notice, Row } from "@/components/ui";
import { client, CORE_DEPLOY_BLOCK, RELAYER_PATH, reader, short, signer, tusd, wagmiConfig } from "@/lib/talaria";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function Merchant() {
  const { address } = useConnection();
  const [amount, setAmount] = useState("5");
  const [memo, setMemo] = useState("");
  const [refundAmount, setRefund] = useState("1");
  const [planAmount, setPlanAmount] = useState("5");
  const [created, setCreated] = useState<bigint>();
  const [hookUrl, setHookUrl] = useState("");
  const [secret, setSecret] = useState<string>();
  const deliveries = useQuery({
    queryKey: ["deliveries", address],
    enabled: Boolean(address),
    retry: 1,
    queryFn: async () => {
      const response = await fetch(`${RELAYER_PATH}/webhooks/${address}/deliveries`);
      if (!response.ok) throw new Error("The relayer is not reachable");
      return (await response.json()).deliveries as { id: number; type: string; status: string; attempts: number }[];
    },
  });

  const invoices = useQuery({
    queryKey: ["invoices", address],
    enabled: Boolean(address),
    queryFn: async () => {
      const logs = await client.getContractEvents({
        address: reader.addresses.core,
        abi: TalariaCoreAbi as any,
        eventName: "InvoiceCreated",
        args: { merchant: address },
        fromBlock: CORE_DEPLOY_BLOCK,
      });
      return Promise.all(logs.map(async (log: any) => ({ id: log.args.id as bigint, ...(await reader.getInvoice(log.args.id)) })));
    },
  });

  return (
    <NeedsWallet>
      <Card title="Your reputation" note="Read live from the ERC-8004 registry on Base, by the relayer. This is what buyers see at checkout.">
        <TrustBadge subject={address} holdMinutes={{ established: 10, new: 30 }} />
      </Card>
      <Card title="Create an invoice" note="Sign once and the relayer submits it. A new invoice costs the relayer about 7.7 tPOT in deposits.">
        <Field label="Amount (tUSD)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="Memo (hashed on-chain)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <ActionButton
          label="Create payment link"
          run={async () => {
            const { invoiceId, txHash } = await (await signer()).createCheckout({ amount, currency: "USD", metadata: { memo } });
            setCreated(invoiceId);
            await invoices.refetch();
            return txHash;
          }}
        />
        {created !== undefined && (
          <Link className="block text-sm underline" href={`/pay/${created}`}>
            Open payment link for invoice #{created.toString()}
          </Link>
        )}
      </Card>

      <Card title="Your invoices">
        {invoices.data?.length ? (
          invoices.data.map((invoice) => {
            const paid = invoice.payer !== ZERO;
            return (
              <div key={invoice.id.toString()} className="space-y-2 border-t border-[var(--line)] pt-3 first:border-0 first:pt-0">
                <Row label={`#${invoice.id}`}>
                  <Link className="underline" href={`/pay/${invoice.id}`}>
                    {tusd(invoice.amount)} tUSD
                  </Link>
                </Row>
                <Row label="Status">{paid ? `Paid by ${short(invoice.payer)}` : "Unpaid"}</Row>
                {invoice.refunded > 0n && <Row label="Refunded">{tusd(invoice.refunded)} tUSD</Row>}
                {paid && invoice.refunded < invoice.amount && (
                  <ActionButton
                    secondary
                    label={`Refund ${refundAmount} tUSD`}
                    run={async () => {
                      const hash = await (await signer()).refund(invoice.id, refundAmount);
                      await invoices.refetch();
                      return hash;
                    }}
                  />
                )}
              </div>
            );
          })
        ) : (
          <Empty>{invoices.isLoading ? "Loading…" : "No invoices yet."}</Empty>
        )}
        {invoices.data?.some((invoice) => invoice.payer !== ZERO) && <Field label="Refund amount (tUSD)" inputMode="decimal" value={refundAmount} onChange={(e) => setRefund(e.target.value)} />}
      </Card>

      <Card title="Webhooks" note="Get signed events for payments, disputes and reputation. Your wallet signs the registration. The secret is shown once.">
        <Field label="Endpoint URL" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
        <ActionButton
          secondary
          label="Register webhook"
          disabled={!hookUrl}
          run={async () => {
            await signer();
            const wallet = await getWalletClient(wagmiConfig, { chainId: portaldotTestnet.id });
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = await wallet.signMessage({ account: wallet.account, message: `Register Talaria webhook ${hookUrl} for ${address!.toLowerCase()} at ${timestamp}` });
            const response = await fetch(`${RELAYER_PATH}/webhooks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchant: address, url: hookUrl, timestamp, signature }) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Registration failed");
            setSecret(body.secret);
          }}
        />
        {secret && <code className="block rounded-2xl bg-white p-3 text-xs break-all">{secret}</code>}
        {deliveries.data?.length ? (
          deliveries.data.map((row) => (
            <Row key={row.id} label={row.type}>
              {row.status} ({row.attempts})
            </Row>
          ))
        ) : (
          <Empty>{deliveries.error ? "The relayer is not reachable, so the delivery log is unavailable." : "No deliveries yet."}</Empty>
        )}
      </Card>
      <Card title="Subscription plans" note="Creating a plan is a direct transaction, so this wallet pays gas.">
        {reader.addresses.subscriptions ? (
          <>
            <Field label="Amount per period (tUSD)" inputMode="decimal" value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} />
            <ActionButton
              secondary
              label="Create monthly plan (12 periods)"
              run={async () => (await (await signer()).createPlan({ amount: planAmount, interval: 30 * 24 * 3600, maxPeriods: 12 })).txHash}
            />
          </>
        ) : (
          <Notice>The subscriptions contract is not deployed on this network yet.</Notice>
        )}
      </Card>
    </NeedsWallet>
  );
}
