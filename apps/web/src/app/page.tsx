"use client";

import { TalariaCoreAbi, type Addresses } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { Card, Notice, Row } from "@/components/ui";
import { client, LOCKBOX, reader, short, tusd } from "@/lib/talaria";

const RAILS: [string, keyof Addresses][] = [
  ["Subscriptions", "subscriptions"],
  ["Streams", "streams"],
  ["Pay-per-call", "channels"],
  ["Remittance", "remit"],
];
const LOW_TPOT = 8n * 10n ** 18n; // one new invoice costs about 7.7 tPOT

export default function Status() {
  const { data, error } = useQuery({
    queryKey: ["status"],
    queryFn: async () => {
      const core = reader.addresses.core;
      const read = (functionName: string) => client.readContract({ address: core, abi: TalariaCoreAbi as any, functionName }) as Promise<any>;
      const [block, relayer, reserve, invoices, receipts] = await Promise.all([client.getBlockNumber(), read("relayer"), read("bridgeReserve"), read("invoiceCount"), read("receiptCount")]);
      return { block, relayer, reserve, invoices, receipts, relayerTpot: await client.getBalance({ address: relayer }) };
    },
  });

  return (
    <>
      <div className="pt-2 pb-2">
        <h1 className="text-3xl font-semibold tracking-tight">Payments with wings.</h1>
        <p className="mt-2 text-[var(--muted)]">Signed intents, on-chain policy checks and receipts on Portaldot, funded from another chain and gasless for the payer.</p>
      </div>
      {error && <Notice>Could not read the chain: {(error as Error).message.split("\n")[0]}</Notice>}
      {data && data.relayerTpot < LOW_TPOT && (
        <Notice>The relayer has {Number(formatEther(data.relayerTpot)).toFixed(2)} tPOT. New gasless actions may fail until it is topped up, because each new storage slot costs about 3.84 tPOT.</Notice>
      )}
      <Card title="Live from Portaldot V3 testnet">
        <Row label="Latest block">{data ? data.block.toString() : "…"}</Row>
        <Row label="Invoices created">{data ? data.invoices.toString() : "…"}</Row>
        <Row label="Receipts issued">{data ? data.receipts.toString() : "…"}</Row>
        <Row label="Bridge reserve">{data ? `${tusd(data.reserve)} tUSD` : "…"}</Row>
        <Row label="Relayer balance">{data ? `${Number(formatEther(data.relayerTpot)).toFixed(2)} tPOT` : "…"}</Row>
      </Card>
      <Card title="Contracts">
        <Row label="tUSD">{short(reader.addresses.token)}</Row>
        <Row label="Core">{short(reader.addresses.core)}</Row>
        <Row label="Lockbox (Base Sepolia)">{LOCKBOX ? short(LOCKBOX) : "Not deployed"}</Row>
        {RAILS.map(([label, key]) => {
          const address = reader.addresses[key];
          return (
            <Row key={key} label={label}>
              {address ? short(address) : "Not deployed"}
            </Row>
          );
        })}
      </Card>
    </>
  );
}
