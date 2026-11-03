import { config as loadEnv } from "dotenv";
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { portaldotClient, portaldotTestnet, retryTransport } from "../../../packages/sdk/src/chain";

export const root = resolve(__dirname, "../../..");
loadEnv({ path: resolve(root, ".env"), quiet: true });

export const BASE_CHAIN_ID = 84532;
export const preview = process.argv.includes("--preview");
export const flag = (name: string) => process.argv.includes(name);

export const keyAccount = (name: string) => {
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set in .env`);
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
};

const portaldotRpc = process.env.PORTALDOT_EVM_RPC || portaldotTestnet.rpcUrls.default.http[0];
const baseRpc = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

export const portaldot = portaldotClient(portaldotRpc);
export const base = createPublicClient({ chain: baseSepolia, transport: retryTransport(baseRpc) }) as PublicClient;
export const portaldotWallet = (account: ReturnType<typeof keyAccount>) => createWalletClient({ account, chain: portaldotTestnet, transport: retryTransport(portaldotRpc) });
export const baseWallet = (account: ReturnType<typeof keyAccount>) => createWalletClient({ account, chain: baseSepolia, transport: retryTransport(baseRpc) });

export const artifact = (name: string) => JSON.parse(readFileSync(resolve(__dirname, `../../artifacts/contracts/${name}.sol/${name}.json`), "utf8"));
export const runtimeBytes = (name: string) => (artifact(name).deployedBytecode.length - 2) / 2;
/** Fitted to our two real Portaldot deployments. */
export const estimateTpot = (bytes: number) => 0.0781 * bytes + 17;

export const readRecords = (file: string): any[] => {
  const path = resolve(root, "deployments", file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
};
export const addressOf = (file: string, name: string) => readRecords(file).find((r) => r.name === name)?.address as `0x${string}` | undefined;

export function addRecord(file: string, record: Record<string, unknown>) {
  const records = readRecords(file);
  records.push({ ...record, timestampUTC: new Date().toISOString(), gitCommit: execSync("git rev-parse HEAD").toString().trim() });
  writeFileSync(resolve(root, "deployments", file), JSON.stringify(records, null, 2) + "\n");
}

/** Saves a receipt and adds a row to the evidence table, because the eth-rpc can prune receipts. */
export function recordTx(rail: string, action: string, receipt: { transactionHash: Hex; blockNumber: bigint; status: string }, spent: string) {
  const evidence = resolve(root, "evidence");
  mkdirSync(evidence, { recursive: true });
  writeFileSync(resolve(evidence, `receipt-${action.replace(/[^a-zA-Z0-9-]+/g, "-")}-${receipt.transactionHash}.json`), JSON.stringify(receipt, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  appendFileSync(resolve(evidence, "TRANSACTIONS.md"), `| ${rail} | ${action} | \`${receipt.transactionHash}\` | ${receipt.blockNumber} | ${receipt.status} | ${spent} |\n`);
  console.log(`${action}: ${receipt.transactionHash} block ${receipt.blockNumber} ${receipt.status}, spent ${spent}`);
}

export const fail = (error: any) => {
  console.error(String(error?.shortMessage ?? error?.message ?? error));
  process.exit(1);
};
