// Deploys MockUSDC and TalariaLockboxV2 to BNB testnet. Spends test BNB only.
// Run with --set-dest to also allow bridge-out to BNB on Portaldot, which costs about 3.86 tPOT.
import { createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData, formatEther, type Abi } from "viem";
import { bscTestnet } from "viem/chains";
import { retryTransport } from "../../packages/sdk/src/chain";
import { addRecord, addressOf, artifact, fail, flag, keyAccount, portaldot, portaldotWallet, preview, recordTx, runtimeBytes } from "./lib/env";

const FILE = "bnb-testnet.json";
const rpc = process.env.BNB_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com";

async function main() {
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  const relayer = process.env.VPS_RELAYER_ADDRESS as `0x${string}`;
  if (!relayer) throw new Error("VPS_RELAYER_ADDRESS is not set");
  const transport = retryTransport(rpc);
  const client = createPublicClient({ chain: bscTestnet, transport });
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });
  const balance = await client.getBalance({ address: account.address });
  console.log(`${preview ? "PREVIEW: nothing is sent." : "LIVE"}\nDeployer ${account.address}\nBalance ${formatEther(balance)} tBNB\nMockUSDC ${runtimeBytes("MockUSDC")} bytes\nTalariaLockboxV2 ${runtimeBytes("TalariaLockboxV2")} bytes`);
  if (preview) return;
  if (balance === 0n) throw new Error("NOT SENT: the deployer has no test BNB");

  const deploy = async (name: string, args: unknown[]) => {
    const existing = addressOf(FILE, name);
    if (existing) return existing;
    const { abi, bytecode } = artifact(name);
    const hash = await wallet.sendTransaction({ data: encodeDeployData({ abi, bytecode, args: args as never }) });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} failed in ${hash}`);
    addRecord(FILE, { name, address: receipt.contractAddress, deployTxHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeBytecodeBytes: runtimeBytes(name), deployer: account.address });
    recordTx("deploy (BNB testnet)", name, receipt, "test BNB");
    return receipt.contractAddress;
  };
  const usdc = await deploy("MockUSDC", []);
  console.log("Lockbox", await deploy("TalariaLockboxV2", [usdc, account.address, relayer]));

  if (flag("--set-dest")) {
    const bridgeOut = addressOf("portaldot-testnet.json", "TalariaBridgeOut")!;
    const hash = await portaldotWallet(account).sendTransaction({ to: bridgeOut, data: encodeFunctionData({ abi: artifact("TalariaBridgeOut").abi as Abi, functionName: "setDest", args: [BigInt(bscTestnet.id), true] }) });
    recordTx("setup", "setDest bnb-testnet", await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 }), "tPOT");
  }
  console.log("Run: node contracts/scripts/export-sdk.js");
}

main().catch(fail);
