// Deploys a Base Sepolia copy of Core and the four rails, using MockUSDC. Spends test ETH only.
// The rails run on Base. Proceeds settle to Portaldot through the lockbox and relayer.
import { encodeDeployData, encodeFunctionData, formatEther, type Abi } from "viem";
import { addRecord, addressOf, artifact, base, baseWallet, fail, keyAccount, preview, recordTx, runtimeBytes } from "./lib/env";

const RAILS: [string, number][] = [
  ["TalariaSubscriptions", 2],
  ["TalariaStreams", 3],
  ["TalariaChannels", 4],
  ["TalariaRemit", 5],
];

async function main() {
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  const wallet = baseWallet(account);
  const usdc = addressOf("base-sepolia.json", "MockUSDC")!;
  console.log(`${preview ? "PREVIEW: nothing is sent." : "LIVE"}\nBalance ${formatEther(await base.getBalance({ address: account.address }))} ETH`);
  for (const name of ["TalariaCore", ...RAILS.map(([n]) => n)]) console.log(`${name} ${runtimeBytes(name)} bytes`);
  if (preview) return;

  const deploy = async (name: string, args: unknown[]) => {
    const existing = addressOf("base-sepolia.json", name);
    if (existing) return existing;
    const { abi, bytecode } = artifact(name);
    const hash = await wallet.sendTransaction({ data: encodeDeployData({ abi, bytecode, args: args as never }) });
    const receipt = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} failed in ${hash}`);
    addRecord("base-sepolia.json", { name, address: receipt.contractAddress, deployTxHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeBytecodeBytes: runtimeBytes(name), deployer: account.address });
    recordTx("deploy (Base Sepolia)", name, receipt, "test ETH");
    return receipt.contractAddress;
  };

  const core = await deploy("TalariaCore", [usdc, account.address]);
  for (const [name, rail] of RAILS) {
    const address = await deploy(name, [core]);
    const hash = await wallet.sendTransaction({ to: core, data: encodeFunctionData({ abi: artifact("TalariaCore").abi as Abi, functionName: "setModule", args: [rail, address] }) });
    recordTx("setup (Base Sepolia)", `setModule ${name}`, await base.waitForTransactionReceipt({ hash, timeout: 180_000 }), "test ETH");
  }
  console.log(`Balance after ${formatEther(await base.getBalance({ address: account.address }))} ETH`);
}

main().catch(fail);
