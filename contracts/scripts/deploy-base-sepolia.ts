// Deploys MockUSDC and TalariaLockbox to Base Sepolia. Spends test ETH: run only after approval.
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const root = resolve(__dirname, "../..");
loadEnv({ path: resolve(root, ".env") });
const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const transport = http(RPC, { timeout: 30_000, retryCount: 5, retryDelay: 1_000 });
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  if ((await pub.getChainId()) !== baseSepolia.id) throw new Error("Wrong chain");

  const file = resolve(root, "deployments/base-sepolia.json");
  const records = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];

  async function deploy(name: string, args: unknown[]) {
    const artifact = JSON.parse(readFileSync(resolve(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`), "utf8"));
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: args as never });
    const hash = await wallet.sendTransaction({ data });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
    records.push({
      name,
      address: receipt.contractAddress,
      deployTxHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      runtimeBytecodeBytes: (artifact.deployedBytecode.length - 2) / 2,
      deployer: account.address,
      timestampUTC: new Date().toISOString(),
      gitCommit: execSync("git rev-parse HEAD").toString().trim(),
    });
    writeFileSync(file, JSON.stringify(records, null, 2) + "\n");
    console.log(`${name} ${receipt.contractAddress} tx ${hash}`);
    return receipt.contractAddress;
  }

  console.log(`Balance ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
  const usdc = await deploy("MockUSDC", []);
  await deploy("TalariaLockbox", [usdc, account.address]);
  console.log(`Balance after ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
}

main().catch((error) => {
  console.error(String(error?.shortMessage ?? error?.message ?? error));
  process.exit(1);
});
