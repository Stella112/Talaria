"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { useConnection } from "wagmi";
import { ActionButton, Card, Field, NeedsWallet, Notice } from "@/components/ui";
import { reader, signer } from "@/lib/talaria";

export default function Remit() {
  const { address } = useConnection();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("5");
  const [claimLink, setClaimLink] = useState<string>();
  const [remitId, setRemitId] = useState("");
  const [code, setCode] = useState("");

  // The claim code travels in the URL fragment, which browsers do not send to servers.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("id")) setRemitId(hash.get("id")!);
    if (hash.get("code")) setCode(hash.get("code")!);
  }, []);

  if (!reader.addresses.remit) {
    return <Notice>This remittance contract runs on Base Sepolia, with real transactions in the evidence log. It is not on Portaldot yet, so this page cannot use it from here.</Notice>;
  }

  return (
    <NeedsWallet>
      <Card title="Send" note="Leave the receiver empty to create a claim link. You can cancel until it is claimed, and it refunds after 30 days.">
        <Field label="Receiver (optional)" value={to} onChange={(e) => setTo(e.target.value)} />
        <Field label="Amount (tUSD)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <ActionButton
          label={to ? "Send" : "Create claim link"}
          run={async () => {
            const result = await (await signer()).sendRemit({ to: to ? (to as Address) : undefined, amount });
            setRemitId(result.remitId.toString());
            setClaimLink(result.claimCode ? `${window.location.origin}/remit#id=${result.remitId}&code=${result.claimCode}` : undefined);
            return result.txHash;
          }}
        />
        {claimLink && (
          <div className="rounded-2xl bg-white p-3 text-xs">
            <p className="mb-1 font-medium">Anyone with this link can claim. Share it carefully.</p>
            <code className="break-all">{claimLink}</code>
          </div>
        )}
      </Card>
      <Card title="Claim or cancel">
        <Field label="Remit number" inputMode="numeric" value={remitId} onChange={(e) => setRemitId(e.target.value)} />
        <Field label="Claim code (from a link)" value={code} onChange={(e) => setCode(e.target.value)} />
        <ActionButton
          label="Claim"
          disabled={!remitId}
          run={async () => {
            const sdk = await signer();
            return code ? sdk.claimWithCode(BigInt(remitId), code as Hex, address!) : sdk.claimRemit(BigInt(remitId));
          }}
        />
        <ActionButton secondary label="Cancel (sender)" disabled={!remitId} run={async () => (await signer()).cancelRemit(BigInt(remitId))} />
      </Card>
    </NeedsWallet>
  );
}
