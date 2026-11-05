"use client";

import { TalariaRemitAbi, toUnits } from "@talaria-pay/sdk";
import { useEffect, useState } from "react";
import { encodeAbiParameters, keccak256, parseSignature, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { useConnection } from "wagmi";
import { BaseAccount } from "@/components/base-account";
import { ActionButton, Card, Field, NeedsWallet } from "@/components/ui";
import { BASE, baseTx, eventId } from "@/lib/base-rails";

const THIRTY_DAYS = 30 * 24 * 3600;

export default function Remit() {
  const { address } = useConnection();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  const [claimLink, setClaimLink] = useState<string>();
  const [remitId, setRemitId] = useState("");
  const [code, setCode] = useState("");

  // The claim code travels in the URL fragment, which browsers do not send to servers.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("id")) setRemitId(hash.get("id")!);
    if (hash.get("code")) setCode(hash.get("code")!);
  }, []);

  return (
    <NeedsWallet>
      <BaseAccount />
      <Card title="Send" note="Leave the receiver empty to create a claim link. You can cancel until it is claimed, and it refunds after 30 days.">
        <Field label="Receiver (optional)" value={to} onChange={(e) => setTo(e.target.value)} />
        <Field label="Amount (mUSDC)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <ActionButton
          label={to ? "Send" : "Create claim link"}
          chain="base"
          run={async () => {
            const secret = to ? undefined : generatePrivateKey();
            const target = (to || privateKeyToAccount(secret!).address) as Address;
            const expiry = Math.floor(Date.now() / 1000) + THIRTY_DAYS;
            const { hash, receipt } = await baseTx(BASE.remit, TalariaRemitAbi, "sendRemit", [target, !to, toUnits(amount), true, expiry]);
            const id = eventId(receipt, TalariaRemitAbi, "RemitSent");
            setRemitId(id.toString());
            setClaimLink(secret ? `${window.location.origin}/remit#id=${id}&code=${secret}` : undefined);
            return hash;
          }}
        />
        {claimLink && (
          <div className="rounded-2xl bg-white p-3 text-xs">
            <p className="mb-1 font-medium">Anyone with this link can claim. Share it carefully.</p>
            <code className="break-all">{claimLink}</code>
          </div>
        )}
      </Card>
      <Card title="Claim or cancel" note="Claimed money lands in your Talaria account on Base. Settle it to Portaldot from the card above.">
        <Field label="Remit number" inputMode="numeric" value={remitId} onChange={(e) => setRemitId(e.target.value)} />
        <Field label="Claim code (from a link)" value={code} onChange={(e) => setCode(e.target.value)} />
        <ActionButton
          label="Claim"
          chain="base"
          disabled={!remitId}
          run={async () => {
            const id = BigInt(remitId);
            if (!code) return (await baseTx(BASE.remit, TalariaRemitAbi, "claimRemit", [id])).hash;
            // The code signs this receiver, so a claim cannot be redirected.
            const message = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }], [BigInt(baseSepolia.id), BASE.remit, id, address!]));
            const { r, s, v } = parseSignature(await privateKeyToAccount(code as Hex).sign({ hash: message }));
            return (await baseTx(BASE.remit, TalariaRemitAbi, "claimWithCode", [id, address!, Number(v), r, s])).hash;
          }}
        />
        <ActionButton secondary chain="base" label="Cancel (sender)" disabled={!remitId} run={async () => (await baseTx(BASE.remit, TalariaRemitAbi, "cancelRemit", [BigInt(remitId)])).hash} />
      </Card>
    </NeedsWallet>
  );
}
