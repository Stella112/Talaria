// Real numbers only: every figure is read from the chain or our own records. Sends nothing.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TalariaCoreAbi, TalariaProtectAbi } from "../../packages/sdk/src/generated";
import { Db } from "../../services/relayer/src/db";
import { addressOf, fail, portaldot, readRecords, root } from "./lib/env";

const CORE_DEPLOY_BLOCK = 305483n;

async function main() {
  const core = addressOf("portaldot-testnet.json", "TalariaCore")!;
  const protect = addressOf("portaldot-testnet.json", "TalariaProtect");
  const read = (functionName: string) => portaldot.readContract({ address: core, abi: TalariaCoreAbi as any, functionName }) as Promise<bigint>;
  const count = async (eventName: string) => (protect ? (await portaldot.getContractEvents({ address: protect, abi: TalariaProtectAbi as any, eventName, fromBlock: CORE_DEPLOY_BLOCK })).length : null);

  const table = resolve(root, "evidence/TRANSACTIONS.md");
  const rows = existsSync(table) ? readFileSync(table, "utf8").split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Rail")) : [];
  const identities = resolve(root, "deployments/identities.json");
  const database = resolve(root, "services/relayer/data/talaria.sqlite");

  const stats = {
    readAtUTC: new Date().toISOString(),
    latestBlock: (await portaldot.getBlockNumber()).toString(),
    contractsDeployed: { portaldot: readRecords("portaldot-testnet.json").length, baseSepolia: readRecords("base-sepolia.json").length },
    invoicesCreated: (await read("invoiceCount")).toString(),
    receiptsIssued: (await read("receiptCount")).toString(),
    protectedPayments: await count("PaymentOpened"),
    paymentsReleased: await count("PaymentReleased"),
    disputes: await count("PaymentDisputed"),
    disputesResolved: await count("PaymentResolved"),
    refunds: await count("PaymentRefunded"),
    trustApplied: await count("TrustApplied"),
    subjectsRegistered: existsSync(identities) ? Object.keys(JSON.parse(readFileSync(identities, "utf8"))).length : 0,
    recordedTransactions: rows.length,
    feedbackWrittenToBase: existsSync(database) ? new Db(database).countFeedback() : 0,
    note: "null means the contract is not deployed yet. Log-based counts may undercount if the RPC has pruned logs.",
  };
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(fail);
