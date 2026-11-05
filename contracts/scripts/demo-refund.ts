// A merchant refund on a protected payment, signed by the merchant and sent gaslessly through the relayer.
// Usage: demo-refund.ts <paymentId> <amount>. Costs the relayer tPOT.
import { formatEther } from "viem";
import { createTalaria } from "../../packages/sdk/src";
import { fail, keyAccount, portaldot, preview, recordTx } from "./lib/env";

const RELAYER = process.env.RELAYER_URL || "https://talaria-pi.vercel.app/api/relayer";
const VPS_RELAYER = "0x3bA9789027CD303075438ec99ABaCBaCbd28eA08";

async function main() {
  const [id, amount] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const merchant = createTalaria({ account: keyAccount("TRUSTED_COFFEE_KEY"), relayerUrl: RELAYER });
  const before = await merchant.getPayment(BigInt(id));
  console.log(`${preview ? "PREVIEW" : "LIVE"}: refund ${amount} tUSD on payment ${id}`, { status: before.status, amount: before.amount, refunded: before.refunded, merchant: before.merchant });
  console.log("Relayer", formatEther(await portaldot.getBalance({ address: VPS_RELAYER })), "tPOT");
  if (preview) return;
  const hash = await merchant.refundProtected(BigInt(id), amount);
  recordTx("protect", `merchant refund ${amount} tUSD on payment ${id}, Trusted Coffee`, await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 }), "tPOT, paid by the VPS relayer");
  const after = await merchant.getPayment(BigInt(id));
  console.log("After", { status: after.status, refunded: after.refunded });
  console.log("Relayer", formatEther(await portaldot.getBalance({ address: VPS_RELAYER })), "tPOT");
}

main().catch(fail);
