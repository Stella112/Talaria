// Deploys TalariaCore to the Portaldot V3 testnet. Spends tPOT: run only after explicit approval.
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = resolve(__dirname, "../..");
loadEnv({ path: resolve(root, ".env") });

const RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const portaldot = defineChain({
  id: 420420777,
  name: "Portaldot V3 Testnet",
  nativeCurrency: { name: "tPOT", symbol: "tPOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  if (account.address.toLowerCase() !== process.env.DEPLOYER_H160?.toLowerCase()) {
    throw new Error(`Key resolves to ${account.address}, which does not match DEPLOYER_H160`);
  }

  const transport = http(RPC, { timeout: 30_000, retryCount: 5, retryDelay: 1_000 });
  const pub = createPublicClient({ chain: portaldot, transport });
  const wallet = createWalletClient({ account, chain: portaldot, transport });
  if ((await pub.getChainId()) !== portaldot.id) throw new Error("Wrong chain");

  const file = resolve(root, "deployments/portaldot-testnet.json");
  const records = JSON.parse(readFileSync(file, "utf8"));
  if (records.some((r: any) => r.name === "TalariaCore")) throw new Error("TalariaCore is already recorded as deployed");
  const token = records.find((r: any) => r.name === "TalariaUSD").address;

  const artifact = JSON.parse(readFileSync(resolve(__dirname, "../artifacts/contracts/TalariaCore.sol/TalariaCore.json"), "utf8"));
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token, account.address] });

  const before = await pub.getBalance({ address: account.address });
  const gas = await pub.estimateGas({ account, data });
  const maxCost = gas * (await pub.getGasPrice());
  console.log(`Runtime bytes ${runtimeBytes}\nBalance ${formatEther(before)} tPOT\nEstimated max ${formatEther(maxCost)} tPOT`);
  if (before < maxCost) {
    console.log("NOT SENT: balance is below the estimate.");
    process.exit(2);
  }

  const hash = await wallet.sendTransaction({ data, gas });
  console.log(`Sent ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${receipt.status}`);
  const after = await pub.getBalance({ address: account.address });
  const code = await pub.getCode({ address: receipt.contractAddress });
  const spent = formatEther(before - after);

  mkdirSync(resolve(root, "evidence"), { recursive: true });
  writeFileSync(
    resolve(root, `evidence/receipt-deploy-TalariaCore-${hash}.json`),
    JSON.stringify(receipt, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n",
  );
  records.push({
    name: "TalariaCore",
    address: receipt.contractAddress,
    deployTxHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    runtimeBytecodeBytes: runtimeBytes,
    depositEstimateTPOT: Number(formatEther(maxCost)),
    depositActualTPOT: null,
    totalBalanceChangeTPOT: spent,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
    deployer: account.address,
    timestampUTC: new Date().toISOString(),
    gitCommit: execSync("git rev-parse HEAD").toString().trim(),
  });
  writeFileSync(file, JSON.stringify(records, null, 2) + "\n");

  console.log(`Address ${receipt.contractAddress}\nBlock ${receipt.blockNumber}\nGas used ${receipt.gasUsed}`);
  console.log(`Balance after ${formatEther(after)} tPOT\nTotal spent ${spent} tPOT\nCode present ${Boolean(code && code !== "0x")}`);
}

main().catch((error) => {
  console.error(String(error?.shortMessage ?? error?.message ?? error));
  process.exit(1);
});
