"use client";

import { MockUSDCAbi, TalariaCoreAbi, TalariaLockboxAbi } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { createPublicClient, http, keccak256, toHex, type Hex } from "viem";
import { useConnection } from "wagmi";
import { ActionButton, Card, Connect, Empty, Notice, Row, TxHash } from "@/components/ui";
import { client, explain, reader, short, signer, sourceWallet, SOURCES, tusd } from "@/lib/talaria";

const ZERO = "0x0000000000000000000000000000000000000000";
type Source = (typeof SOURCES)[number];

export default function Pay() {
  const params = useParams<{ invoiceId: string }>();
  const valid = /^\d+$/.test(params.invoiceId);
  const id = valid ? BigInt(params.invoiceId) : 0n;
  const { address } = useConnection();
  const [link, setLink] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: Hex; chain: "base" | "bnb" | "portaldot" }[]>([]);
  const [baseError, setBaseError] = useState<string>();
  const [running, setRunning] = useState(false);

  useEffect(() => setLink(window.location.href), []);

  const invoice = useQuery({ queryKey: ["invoice", params.invoiceId], enabled: valid, queryFn: () => reader.getInvoice(id) });
  const balance = useQuery({ queryKey: ["balance", address], enabled: Boolean(address), queryFn: () => reader.getBalance(address!) });
  const reserve = useQuery({
    queryKey: ["reserve"],
    queryFn: () => client.readContract({ address: reader.addresses.core, abi: TalariaCoreAbi as any, functionName: "bridgeReserve" }) as Promise<bigint>,
  });

  const data = invoice.data;
  if (!valid) return <Empty>That is not a valid invoice number.</Empty>;
  if (invoice.isLoading) return <Empty>Loading the invoice from the chain…</Empty>;
  if (invoice.error) return <Notice>Could not read the invoice: {explain(invoice.error)}</Notice>;
  if (!data || data.merchant === ZERO) return <Empty>Invoice #{params.invoiceId} does not exist.</Empty>;

  const paid = data.payer !== ZERO;
  const expired = Date.now() / 1000 > data.expiry;
  const enough = balance.data !== undefined && balance.data >= data.amount;
  const reserveOk = reserve.data !== undefined && reserve.data >= data.amount;

  const add = (label: string, chain: "base" | "bnb" | "portaldot", hash?: Hex) => setSteps((list) => [...list, { label, chain, hash }]);

  async function payFrom(source: Source) {
    setRunning(true);
    setBaseError(undefined);
    setSteps([]);
    try {
      const wallet = await sourceWallet(source.chain.id);
      const remote = createPublicClient({ chain: source.chain, transport: http(source.rpc) });
      const send = async (label: string, to: Hex, abi: any, functionName: string, args: unknown[]) => {
        const hash = await wallet.writeContract({ account: wallet.account!, chain: source.chain, address: to, abi, functionName, args });
        await remote.waitForTransactionReceipt({ hash, timeout: 180_000 });
        add(label, source.id, hash);
      };
      await send("Minted test mUSDC", source.usdc, MockUSDCAbi, "mint", [data!.amount]);
      await send("Approved the lockbox", source.usdc, MockUSDCAbi, "approve", [source.lockbox, data!.amount]);
      const start = balance.data ?? (await reader.getBalance(address!));
      await send(`Locked on ${source.name}`, source.lockbox, TalariaLockboxAbi, "lock", [address, data!.amount, keccak256(toHex(`invoice-${id}`))]);

      add("Waiting for the relayer to credit Portaldot…", "portaldot");
      const deadline = Date.now() + 5 * 60_000;
      while ((await reader.getBalance(address!)) < start + data!.amount) {
        if (Date.now() > deadline) throw new Error("No credit after 5 minutes. Your lock is recorded; the relayer may be offline.");
        await new Promise((done) => setTimeout(done, 5_000));
      }
      add("Credit landed on Portaldot", "portaldot");
      await balance.refetch();
      const hash = await (await signer()).payInvoice(id);
      add("Invoice paid", "portaldot", hash);
      await invoice.refetch();
    } catch (error) {
      setBaseError(explain(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Card title={`Invoice #${params.invoiceId}`}>
        <p className="text-5xl font-semibold tracking-tight">{tusd(data.amount)} <span className="text-2xl">tUSD</span></p>
        <Row label="Merchant">{short(data.merchant)}</Row>
        <Row label="Status">{paid ? `Paid by ${short(data.payer)}` : expired ? "Expired" : "Awaiting payment"}</Row>
        <Row label="Expires">{new Date(data.expiry * 1000).toLocaleString()}</Row>
        {link && (
          <div className="flex justify-center rounded-2xl bg-white p-4">
            <QRCodeSVG value={link} size={160} />
          </div>
        )}
      </Card>
      {!paid && !expired && (
        <>
          {!address ? (
            <Card title="Pay">
              <Connect />
            </Card>
          ) : (
            <>
              <Card title="Pay from Portaldot balance" note="Sign once. The relayer pays the gas.">
                <Row label="Your Talaria account">{balance.data !== undefined ? `${tusd(balance.data)} tUSD` : "…"}</Row>
                <ActionButton
                  label={enough ? "Pay gaslessly" : "Balance too low"}
                  disabled={!enough}
                  run={async () => {
                    const hash = await (await signer()).payInvoice(id);
                    await invoice.refetch();
                    return hash;
                  }}
                />
              </Card>
              <Card title="Pay from Base or BNB" note="Lock test mUSDC on the chain you choose. One trusted relayer credits you on Portaldot, then you sign the payment. You need that chain's test gas: Base Sepolia test ETH, or test BNB.">
                {!reserveOk && reserve.data !== undefined && <Notice>The bridge reserve holds {tusd(reserve.data)} tUSD, too little for this invoice. Locking now would not be credited, so this is off.</Notice>}
                {SOURCES.map((source) => (
                  <button
                    key={source.id}
                    disabled={running || !reserveOk || !source.lockbox}
                    onClick={() => payFrom(source)}
                    className="min-h-12 w-full rounded-full border border-[var(--ink)]/25 bg-white px-5 font-semibold disabled:opacity-40"
                  >
                    {running ? "Working…" : `Pay from ${source.short}`}
                  </button>
                ))}
                {baseError && <p className="text-sm break-words text-[var(--bad)]">{baseError}</p>}
                {steps.map((step, index) => (
                  <div key={index} className="space-y-1 text-sm">
                    <p>{step.label}</p>
                    {step.hash && <TxHash hash={step.hash} chain={step.chain} />}
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
