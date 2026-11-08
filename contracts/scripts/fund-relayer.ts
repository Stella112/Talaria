// Sends tPOT from the deployer to the VPS relayer's EVM address, which funds its mapped account.
// Usage: fund-relayer.ts <amount>. Spends tPOT.
import { formatEther, parseEther } from "viem";
import { fail, keyAccount, portaldot, portaldotWallet, preview, recordTx } from "./lib/env";

const RELAYER = "0x3bA9789027CD303075438ec99ABaCBaCbd28eA08";

async function main() {
  const amount = process.argv.slice(2).find((arg) => !arg.startsWith("--"))!;
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  const read = async () => ({ deployer: formatEther(await portaldot.getBalance({ address: account.address })), relayer: formatEther(await portaldot.getBalance({ address: RELAYER })) });
  console.log(`${preview ? "PREVIEW" : "LIVE"}: ${amount} tPOT to the relayer`, await read());
  if (preview) return;
  const hash = await portaldotWallet(account).sendTransaction({ to: RELAYER, value: parseEther(amount) });
  recordTx("setup", `fund the VPS relayer with ${amount} tPOT from the deployer`, await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 }), "tPOT");
  console.log("After", await read());
}

main().catch(fail);
