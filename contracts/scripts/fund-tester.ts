// Sends a tester 0.01 test BNB from the deployer, for gas on BNB testnet. Usage: fund-tester.ts <address>
import { createPublicClient, createWalletClient, formatEther, getAddress, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { retryTransport } from "../../packages/sdk/src/chain";
import { fail, keyAccount, preview, recordTx } from "./lib/env";

async function main() {
  const to = getAddress(process.argv.filter((arg) => arg.startsWith("0x"))[0]);
  const transport = retryTransport(process.env.BNB_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com");
  const client = createPublicClient({ chain: bscTestnet, transport });
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  console.log(`${preview ? "PREVIEW" : "LIVE"}: 0.01 tBNB to ${to}. Deployer has ${formatEther(await client.getBalance({ address: account.address }))} tBNB`);
  if (preview) return;
  const hash = await createWalletClient({ account, chain: bscTestnet, transport }).sendTransaction({ to, value: parseEther("0.01") });
  recordTx("setup (BNB testnet)", `send 0.01 tBNB to tester ${to}`, await client.waitForTransactionReceipt({ hash, timeout: 180_000 }), "test BNB");
  console.log("Tester now has", formatEther(await client.getBalance({ address: to })), "tBNB");
}

main().catch(fail);
