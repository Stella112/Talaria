"use client";

import { RailBit, TalariaCoreAbi, type Intent } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { useConnection } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { ActionButton, Card, Empty, Field, NeedsWallet, Notice, Row, TxHash } from "@/components/ui";
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

export default function Agent() {
  const { address } = useConnection();
  const [key, setKey] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("5");
  const [maxPerDay, setMaxPerDay] = useState("20");
  const [days, setDays] = useState("7");
  const [rails, setRails] = useState<number>(RailBit.checkout | RailBit.channels);
  const [command, setCommand] = useState("pay invoice 1");
  const [parsed, setParsed] = useState<Parsed>();
  const [result, setResult] = useState<string>();

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

  const railOptions = Object.entries(RailBit).filter(([name]) => name !== "account");

  return (
    <NeedsWallet>
      <Card title="Session key" note="Gives an agent's key limited spending from your account. The limits are enforced on-chain. Costs the relayer about 7.7 tPOT.">
        <Field label="Agent key address (0x…)" value={key} onChange={(e) => setKey(e.target.value)} />
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
              className={`min-h-11 rounded-full border px-3 text-sm ${rails & bit ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)]"}`}
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

      <Card title="Autopilot" note="Commands go to the agent service, which signs with its own session key. Nothing runs until you confirm the preview.">
        <Field label="Command" value={command} onChange={(e) => setCommand(e.target.value)} />
        <ActionButton
          secondary
          label="Preview"
          run={async () => {
            setResult(undefined);
            setParsed(undefined);
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
                setResult(JSON.stringify(response.result, null, 2));
                return response.result?.txHash;
              }}
            />
          </>
        )}
        {result && <pre className="overflow-x-auto rounded-lg bg-[var(--bg)] p-2 text-xs">{result}</pre>}
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
  );
}
