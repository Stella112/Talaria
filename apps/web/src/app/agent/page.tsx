"use client";

import { RailBit, TalariaCoreAbi, type Intent } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { useConnection } from "wagmi";
import { TrustBadge, useTrust } from "@/components/trust";
import { getWalletClient } from "wagmi/actions";
import { ActionButton, Card, Empty, Field, NeedsWallet, Notice, Pill, Row, TxHash } from "@/components/ui";
import { AGENT_PATH, client, CORE_DEPLOY_BLOCK, reader, short, signer, tusd, wagmiConfig } from "@/lib/talaria";
import { portaldotTestnet } from "@talaria-pay/sdk";

type Parsed = { action: Record<string, string>; source: string; preview: string; needsConfirmation: boolean };

/** Approving and rejecting must come from the owner, so they are direct transactions. */
async function ownerCall(functionName: "approvePending" | "rejectPending", args: unknown[]) {
  await signer();
  const wallet = await getWalletClient(wagmiConfig, { chainId: portaldotTestnet.id });
  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain: portaldotTestnet,
    to: reader.addresses.core,
    data: encodeFunctionData({ abi: TalariaCoreAbi as any, functionName, args }),
  });
  await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return hash;
}

async function callAgent(path: string, body: unknown) {
  const response = await fetch(`${AGENT_PATH}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The agent service is not reachable.");
  }
  if (!response.ok) throw new Error(json.error ?? `Agent ${response.status}`);
  return json;
}

const HOSTED_IDS = "10589 on Base Sepolia, 2723 on BNB testnet";
const TIER_CAPS = { trusted: 100, established: 25, new: 5 } as const;
const EXAMPLES = ["what is the trust of trusted coffee", "buy 1 tUSD from Trusted Coffee", "buy 1 tUSD from New Shop", "show my receipts"];

function useHostedAgent() {
  return useQuery({
    queryKey: ["hosted-agent"],
    retry: 1,
    queryFn: async () => {
      const response = await fetch(`${AGENT_PATH}/.well-known/agent-card.json`);
      if (!response.ok) throw new Error("The agent service is not reachable");
      return (await response.json()) as { name: string; wallet: Address };
    },
  });
}

/** The hosted agent, deployed and ready. It needs no wallet, so anyone can use it. */
function Autopilot() {
  const card = useHostedAgent();
  const trust = useTrust(card.data?.wallet);
  const [command, setCommand] = useState(EXAMPLES[0]);
  const [parsed, setParsed] = useState<Parsed>();
  const [result, setResult] = useState<any>();
  const [rating, setRating] = useState<{ baseTx?: string; error?: string }>();

  return (
    <section className="mb-5 rounded-3xl bg-[var(--surface)] p-5 md:col-span-2 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">{card.data?.name ?? "Talaria Autopilot"}</h2>
        {card.isLoading ? <Pill>Checking…</Pill> : card.data ? <Pill tone="good">Online, ready to use</Pill> : <Pill tone="orange">Offline right now</Pill>}
      </div>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
        Our hosted agent, with its own on-chain identity. No wallet or key needed: type a task, check the preview, and confirm. It buys with test tokens from a demo buyer account, and it can only pay the demo merchants.
      </p>
      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3 rounded-2xl bg-white p-4 md:p-5">
          <Row label="Wallet">{card.data ? short(card.data.wallet) : "…"}</Row>
          <Row label="ERC-8004 agent">{HOSTED_IDS}</Row>
          <Row label="Reputation">{trust.data ? `${trust.data.score} from ${trust.data.feedbackCount} feedbacks` : "…"}</Row>
          <Row label="Trust tier">{trust.data?.tier ?? "…"}</Row>
          <Row label="Cap per payment">{trust.data ? `${TIER_CAPS[trust.data.tier]} tUSD` : "…"}</Row>
          <Row label="Can buy from">Trusted Coffee, New Shop</Row>
          <p className="text-xs leading-relaxed text-[var(--muted)]">Its cap rises and falls with its reputation, read live from Base. This history comes from our own demo runs. Buying spends the relayer's limited tPOT, so purchases are capped and may pause.</p>
        </div>
        <div className="space-y-3">
          <Field label="What should it do?" value={command} onChange={(e) => setCommand(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => setCommand(example)} className="min-h-10 rounded-full border border-[var(--line)] bg-white px-3 text-left text-sm">
                {example}
              </button>
            ))}
          </div>
          <ActionButton
            label="Preview"
            run={async () => {
              setResult(undefined);
              setParsed(undefined);
              setRating(undefined);
              setParsed(await callAgent("/parse", { command }));
            }}
          />
          {parsed && (
            <>
              <Notice>{parsed.preview}</Notice>
              <ActionButton
                label={parsed.needsConfirmation ? "Confirm and run" : "Run"}
                run={async () => {
                  const response = await callAgent("/execute", { action: parsed.action, confirmed: true });
                  setResult(response.result);
                  return response.result?.txHash;
                }}
              />
            </>
          )}
          {result?.paymentId && (
            <div className="space-y-3 rounded-2xl bg-white p-4">
              <Link className="font-semibold underline underline-offset-4" href={`/payment/${result.paymentId}`}>See payment #{result.paymentId} and its timeline</Link>
              <p className="text-sm font-medium">Rate this job</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((stars) => (
                  <button
                    key={stars}
                    disabled={Boolean(rating?.baseTx)}
                    onClick={async () => {
                      try {
                        setRating({ baseTx: (await callAgent("/rate", { paymentId: String(result.paymentId), stars })).baseTx });
                      } catch (error) {
                        setRating({ error: (error as Error).message });
                      }
                    }}
                    className="min-h-11 min-w-11 rounded-full border border-[var(--line)] font-semibold disabled:opacity-40"
                  >
                    {stars}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--muted)]">Written to Base as labelled demo-client feedback. Only a settled payment can be rated, and a new merchant's payment settles after its hold.</p>
              {rating?.error && <p className="text-sm text-[var(--bad)]">{rating.error}</p>}
              {rating?.baseTx && <TxHash hash={rating.baseTx} chain="base" />}
            </div>
          )}
          {result !== undefined && !result?.paymentId && <pre className="overflow-x-auto rounded-2xl bg-white p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
        </div>
      </div>
    </section>
  );
}

export default function Agent() {
  const { address } = useConnection();
  const [key, setKey] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("5");
  const [maxPerDay, setMaxPerDay] = useState("20");
  const [days, setDays] = useState("7");
  const [rails, setRails] = useState<number>(RailBit.checkout | RailBit.channels);

  const pending = useQuery({
    queryKey: ["pending", address],
    enabled: Boolean(address),
    queryFn: async () => {
      const logs = await client.getContractEvents({ address: reader.addresses.core, abi: TalariaCoreAbi as any, eventName: "IntentQueued", args: { owner: address }, fromBlock: CORE_DEPLOY_BLOCK });
      const open = await Promise.all(
        logs.map(async (log: any) => {
          const owner = await client.readContract({ address: reader.addresses.core, abi: TalariaCoreAbi as any, functionName: "pendingOwner", args: [log.args.intentHash] });
          return BigInt(owner as string) === 0n ? null : log.args;
        }),
      );
      return open.filter(Boolean) as any[];
    },
  });
  const activity = useQuery({ queryKey: ["activity", address], enabled: Boolean(address), queryFn: () => reader.getReceipts({ payer: address!, fromBlock: CORE_DEPLOY_BLOCK }) });

  const [mandateAgent, setMandateAgent] = useState("");
  const [mandatePayee, setMandatePayee] = useState("");
  const [mandateMax, setMandateMax] = useState("5");
  const [signedMandate, setSignedMandate] = useState<string>();
  const [revokeHash, setRevokeHash] = useState("");
  const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const agentTrust = useTrust(isAddress(mandateAgent) ? (mandateAgent as Address) : undefined);
  const hosted = useHostedAgent();

  const railOptions = Object.entries(RailBit).filter(([name]) => name !== "account");

  return (
    <>
    <Autopilot />
    <NeedsWallet>
      <Card title="Approve an agent purchase" note="A mandate lets one agent key pay one merchant, up to one amount, for 30 minutes and one use. Nothing else is allowed. Limits are enforced on-chain.">
        {reader.addresses.protect ? (
          <>
            <Field label="Agent key address (0x…)" value={mandateAgent} onChange={(e) => setMandateAgent(e.target.value)} />
            {hosted.data && <button onClick={() => setMandateAgent(hosted.data.wallet)} className="min-h-10 rounded-full border border-[var(--line)] bg-white px-3 text-sm">Use Talaria Autopilot</button>}
            {agentTrust.data && (
              <p className="text-sm text-[var(--muted)]">
                This agent's reputation is {agentTrust.data.score} from {agentTrust.data.feedbackCount} feedbacks, so it can pay up to {TIER_CAPS[agentTrust.data.tier]} tUSD at a time. Its cap rises as it builds history.
              </p>
            )}
            <Field label="Allowed merchant (0x…)" value={mandatePayee} onChange={(e) => setMandatePayee(e.target.value)} />
            {isAddress(mandatePayee) && <TrustBadge subject={mandatePayee as Address} holdMinutes={{ established: 10, new: 30 }} />}
            <Field label="Maximum (tUSD)" inputMode="decimal" value={mandateMax} onChange={(e) => setMandateMax(e.target.value)} />
            <ActionButton
              label="Sign mandate"
              disabled={!isAddress(mandateAgent) || !isAddress(mandatePayee)}
              run={async () => {
                const signed = await (await signer()).createMandate({ agent: mandateAgent as Address, payees: [mandatePayee as Address], maxAmount: mandateMax, maxUses: 1 });
                setSignedMandate(JSON.stringify(signed, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2));
              }}
            />
            {signedMandate && <pre className="overflow-x-auto rounded-2xl bg-white p-3 text-xs">{signedMandate}</pre>}
            <Field label="Mandate hash to revoke" value={revokeHash} onChange={(e) => setRevokeHash(e.target.value)} />
            <ActionButton secondary label="Revoke mandate" disabled={!/^0x[0-9a-fA-F]{64}$/.test(revokeHash)} run={async () => (await signer()).revokeMandate(revokeHash as `0x${string}`)} />
          </>
        ) : (
          <Notice>Mandates are built and tested locally, but TalariaProtect is not deployed on this network yet.</Notice>
        )}
      </Card>
      <Card title="Session key" note="Gives an agent's key limited spending from your account. The limits are enforced on-chain. Costs the relayer about 7.7 tPOT.">
        <Field label="Agent key address (0x…)" value={key} onChange={(e) => setKey(e.target.value)} />
        {hosted.data && <button onClick={() => setKey(hosted.data.wallet)} className="min-h-10 rounded-full border border-[var(--line)] bg-white px-3 text-sm">Use Talaria Autopilot</button>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max per payment" inputMode="decimal" value={maxPerTx} onChange={(e) => setMaxPerTx(e.target.value)} />
          <Field label="Max per day" inputMode="decimal" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
        </div>
        <Field label="Valid for (days)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {railOptions.map(([name, bit]) => (
            <button
              key={name}
              onClick={() => setRails((value) => value ^ bit)}
              aria-pressed={(rails & bit) !== 0}
              className={`min-h-11 rounded-full border px-3 text-sm ${rails & bit ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-white text-[var(--muted)]"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <ActionButton
          label="Authorise key"
          disabled={!/^0x[0-9a-fA-F]{40}$/.test(key)}
          run={async () =>
            (await signer()).addSessionKey({
              key: key as Address,
              maxPerTx,
              maxPerDay,
              rails,
              expiry: BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400),
            })
          }
        />
        <ActionButton secondary label="Revoke key" disabled={!/^0x[0-9a-fA-F]{40}$/.test(key)} run={async () => (await signer()).revokeSessionKey(key as Address)} />
      </Card>

      <Card title="Waiting for your approval" note="Agent payments over their limits wait here. Approving or rejecting is a direct transaction, so this wallet needs a little tPOT.">
        {pending.data?.length ? (
          pending.data.map((item) => {
            const intent: Intent = { rail: item.rail, owner: item.owner, signer: item.signer, payee: item.payee, amount: item.amount, ref: item.ref, nonce: item.nonce, deadline: item.deadline };
            return (
              <div key={item.intentHash} className="space-y-2 border-t border-[var(--line)] pt-3 first:border-0 first:pt-0">
                <Row label="Amount">{tusd(item.amount)} tUSD</Row>
                <Row label="To">{short(item.payee)}</Row>
                <Row label="Agent">{short(item.signer)}</Row>
                <ActionButton
                  label="Approve"
                  run={async () => {
                    const hash = await ownerCall("approvePending", [intent]);
                    await pending.refetch();
                    return hash;
                  }}
                />
                <ActionButton
                  secondary
                  label="Reject"
                  run={async () => {
                    const hash = await ownerCall("rejectPending", [item.intentHash]);
                    await pending.refetch();
                    return hash;
                  }}
                />
              </div>
            );
          })
        ) : (
          <Empty>{pending.isLoading ? "Loading…" : "Nothing is waiting."}</Empty>
        )}
      </Card>

      <Card title="Activity" note="On-chain payments from your account, including those made by session keys.">
        {activity.data?.length ? (
          activity.data.map((receipt: any) => (
            <div key={receipt.receiptId} className="space-y-1 border-t border-[var(--line)] pt-3 first:border-0 first:pt-0">
              <Row label="Paid">{tusd(receipt.amount)} tUSD</Row>
              <Row label="To">{short(receipt.payee)}</Row>
              <TxHash hash={receipt.txHash} />
            </div>
          ))
        ) : (
          <Empty>{activity.isLoading ? "Loading…" : "No activity yet."}</Empty>
        )}
      </Card>
    </NeedsWallet>
    </>
  );
}
