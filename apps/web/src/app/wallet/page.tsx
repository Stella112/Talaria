"use client";

import { TalariaUSDAbi } from "@talaria-pay/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { useConnection } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { ActionButton, Card, Empty, Field, NeedsWallet, Notice, Row, TxHash } from "@/components/ui";
import { client, CORE_DEPLOY_BLOCK, reader, short, signer, tusd, wagmiConfig } from "@/lib/talaria";
import { portaldotTestnet } from "@talaria-pay/sdk";

export default function Wallet() {
  const { address } = useConnection();
  const [depositAmount, setDeposit] = useState("10");
  const [withdrawAmount, setWithdraw] = useState("1");
  const [baseAmount, setBaseAmount] = useState("1");
  const [bridgeId, setBridgeId] = useState<string>();

  const balances = useQuery({
    queryKey: ["balances", address],
    enabled: Boolean(address),
    queryFn: async () => ({
      wallet: (await client.readContract({ address: reader.addresses.token, abi: TalariaUSDAbi as any, functionName: "balanceOf", args: [address] })) as bigint,
      internal: await reader.getBalance(address!),
      tpot: await client.getBalance({ address: address! }),
    }),
  });
  const receipts = useQuery({
    queryKey: ["receipts", address],
    enabled: Boolean(address),
    queryFn: () => reader.getReceipts({ payer: address!, fromBlock: CORE_DEPLOY_BLOCK }),
  });

  return (
    <NeedsWallet>
      <Card title="Balances">
        <Row label="Talaria account">{balances.data ? `${tusd(balances.data.internal)} tUSD` : "…"}</Row>
        <Row label="In wallet">{balances.data ? `${tusd(balances.data.wallet)} tUSD` : "…"}</Row>
        <Row label="Gas balance">{balances.data ? `${Number(balances.data.tpot) / 1e18} tPOT` : "…"}</Row>
      </Card>
      <Card title="Get test tUSD" note="The faucet is a direct transaction, so this wallet needs a little tPOT. Getting a bridge credit needs none.">
        <ActionButton
          label="Claim 1,000 tUSD"
          run={async () => {
            await signer(); // switches the wallet to Portaldot
            const wallet = await getWalletClient(wagmiConfig, { chainId: portaldotTestnet.id });
            const hash = await wallet.sendTransaction({
              account: wallet.account,
              chain: portaldotTestnet,
              to: reader.addresses.token,
              data: encodeFunctionData({ abi: TalariaUSDAbi as any, functionName: "faucet" }),
            });
            await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
            await balances.refetch();
            return hash;
          }}
        />
      </Card>
      <Card title="Deposit" note="Sign a permit and the relayer submits it. No gas needed.">
        <Field label="Amount (tUSD)" inputMode="decimal" value={depositAmount} onChange={(e) => setDeposit(e.target.value)} />
        <ActionButton
          label="Deposit gaslessly"
          run={async () => {
            const hash = await (await signer()).deposit(depositAmount);
            await balances.refetch();
            return hash;
          }}
        />
      </Card>
      <Card title="Withdraw" note="Moves tUSD from your Talaria account back to this wallet, gaslessly.">
        <Field label="Amount (tUSD)" inputMode="decimal" value={withdrawAmount} onChange={(e) => setWithdraw(e.target.value)} />
        <ActionButton
          secondary
          label="Withdraw"
          run={async () => {
            const hash = await (await signer()).withdrawBalance(withdrawAmount);
            await balances.refetch();
            return hash;
          }}
        />
      </Card>
      <Card title="Withdraw to Base" note="Moves tUSD back to Base Sepolia as test mUSDC, gaslessly. One trusted relayer releases it there.">
        {reader.addresses.bridgeOut ? (
          <>
            <Field label="Amount (tUSD)" inputMode="decimal" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value)} />
            <ActionButton
              secondary
              label="Withdraw to Base"
              run={async () => {
                const { id, txHash } = await (await signer()).bridgeOut({ amount: baseAmount, destChainId: 84532, recipient: address! });
                setBridgeId(id);
                await balances.refetch();
                return txHash;
              }}
            />
            {bridgeId && <p className="text-xs break-all text-[var(--muted)]">Bridge-out id: {bridgeId}. The relayer releases it after a few confirmations.</p>}
          </>
        ) : (
          <Notice>The bridge-out contract is built and tested locally, but it is not deployed on this network yet.</Notice>
        )}
      </Card>
      <Card title="Receipts" note="Payments made from this account. The RPC can prune old logs, so older receipts may be missing.">
        {receipts.data?.length ? (
          receipts.data.map((receipt: any) => (
            <div key={receipt.receiptId} className="space-y-1 border-t border-[var(--line)] pt-3 first:border-0 first:pt-0">
              <Row label="Paid">{tusd(receipt.amount)} tUSD</Row>
              <Row label="To">{short(receipt.payee)}</Row>
              <Row label="Block">{receipt.blockNumber.toString()}</Row>
              <TxHash hash={receipt.txHash} />
            </div>
          ))
        ) : (
          <Empty>{receipts.isLoading ? "Loading…" : "No receipts yet."}</Empty>
        )}
      </Card>
    </NeedsWallet>
  );
}
