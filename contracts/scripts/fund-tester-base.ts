// Sends a tester 0.005 Base Sepolia test ETH from the deployer, for gas. Usage: fund-tester-base.ts <address>
import { formatEther, getAddress, parseEther } from "viem";
import { base, baseWallet, fail, keyAccount, preview, recordTx } from "./lib/env";

async function main() {
  const to = getAddress(process.argv.filter((arg) => arg.startsWith("0x"))[0]);
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  console.log(`${preview ? "PREVIEW" : "LIVE"}: 0.005 ETH to ${to}. Deployer has ${formatEther(await base.getBalance({ address: account.address }))} ETH`);
  if (preview) return;
  const hash = await baseWallet(account).sendTransaction({ to, value: parseEther("0.005") });
  recordTx("setup (Base Sepolia)", `send 0.005 ETH to tester ${to}`, await base.waitForTransactionReceipt({ hash, timeout: 180_000 }), "test ETH");
  console.log("Tester now has", formatEther(await base.getBalance({ address: to })), "ETH");
}

main().catch(fail);
