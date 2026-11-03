// Live end-to-end demo: lock on Base Sepolia, relayer credits on Portaldot, payer settles an invoice
// gaslessly through the relayer API. Spends tPOT unless run with --preview.
import { config as loadEnv } from "dotenv";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, keccak256, toHex, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { portaldotClient, portaldotTestnet, retryTransport } from "../../packages/sdk/src/chain";
import { createTalaria } from "../../packages/sdk/src/client";
import { baseSepoliaDeployments, MockUSDCAbi, portaldotDeployments, TalariaCoreAbi, TalariaLockboxAbi, TalariaUSDAbi } from "../../packages/sdk/src/generated";
import { liveChain } from "../../services/relayer/src/chain";
import { buildServer } from "../../services/relayer/src/server";
import { Store } from "../../services/relayer/src/store";
import { pollBridge } from "../../services/relayer/src/workers";

const root = resolve(__dirname, "../..");
loadEnv({ path: resolve(root, ".env"), quiet: true });

const LOCK_AMOUNT = 10_000_000n; // 10 tUSD
const INVOICE_AMOUNT = 5_000_000n; // 5 tUSD
const preview = process.argv.includes("--preview");

const key = process.env.DEPLOYER_PRIVATE_KEY!;
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const rpc = process.env.PORTALDOT_EVM_RPC || portaldotTestnet.rpcUrls.default.http[0];
const portaldot = portaldotClient(rpc);
const wallet = createWalletClient({ account, chain: portaldotTestnet, transport: retryTransport(rpc) });
const baseTransport = retryTransport(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
const base = createPublicClient({ chain: baseSepolia, transport: baseTransport }) as PublicClient;
const baseWallet = createWalletClient({ account, chain: baseSepolia, transport: baseTransport });

const core = portaldotDeployments.TalariaCore;
const token = portaldotDeployments.TalariaUSD;
const usdc = baseSepoliaDeployments.MockUSDC;
const lockbox = baseSepoliaDeployments.TalariaLockbox;
const table = resolve(root, "evidence/TRANSACTIONS.md");

const balance = () => portaldot.getBalance({ address: account.address });

function record(rail: string, action: string, hash: Hex, block: bigint, status: string, spent: string, receipt: unknown) {
  writeFileSync(resolve(root, `evidence/receipt-${action}-${hash}.json`), JSON.stringify(receipt, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  appendFileSync(table, `| ${rail} | ${action} | \`${hash}\` | ${block} | ${status} | ${spent} |\n`);
  console.log(`${action}: ${hash} block ${block} ${status}, spent ${spent}`);
}

/** Sends one Portaldot transaction, stopping first if the balance does not cover the estimate. */
async function send(action: string, to: Address, abi: Abi, functionName: string, args: unknown[]) {
  const data = encodeFunctionData({ abi, functionName, args } as any);
  const before = await balance();
  const gas = await portaldot.estimateGas({ account, to, data });
  const maxCost = gas * (await portaldot.getGasPrice());
  console.log(`\n${action}: balance ${formatEther(before)}, estimated max ${formatEther(maxCost)} tPOT`);
  if (preview) return;
  if (before < maxCost) throw new Error(`STOPPED before ${action}: balance is below the estimate`);
  const hash = await wallet.sendTransaction({ to, data, gas });
  const receipt = await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${action} reverted: ${hash}`);
  record("setup", action, hash, receipt.blockNumber, receipt.status, `${formatEther(before - (await balance()))} tPOT`, receipt);
}

async function sendBase(action: string, to: Address, abi: Abi, functionName: string, args: unknown[]) {
  const hash = await baseWallet.sendTransaction({ to, data: encodeFunctionData({ abi, functionName, args } as any) });
  const receipt = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${action} reverted: ${hash}`);
  record("bridge (Base Sepolia)", action, hash, receipt.blockNumber, receipt.status, "test ETH", receipt);
  return receipt;
}

async function main() {
  if (preview) {
    console.log("PREVIEW: nothing is sent.");
    const relayer = await portaldot.readContract({ address: core, abi: TalariaCoreAbi, functionName: "relayer" });
    console.log(`Current relayer ${relayer}`);
    await send("setRelayer", core, TalariaCoreAbi as Abi, "setRelayer", [account.address]);
    return;
  }

  // One-time payer that never holds gas: its only funds are the bridge credit. The key is not stored.
  const payer = privateKeyToAccount(generatePrivateKey());
  console.log(`Payer ${payer.address}\nStart balance ${formatEther(await balance())} tPOT`);

  if ((await portaldot.readContract({ address: core, abi: TalariaCoreAbi, functionName: "relayer" })) !== account.address) {
    await send("setRelayer", core, TalariaCoreAbi as Abi, "setRelayer", [account.address]);
  }
  await send("approveReserve", token, TalariaUSDAbi as Abi, "approve", [core, LOCK_AMOUNT]);
  await send("fundReserve", core, TalariaCoreAbi as Abi, "fundReserve", [LOCK_AMOUNT]);

  await sendBase("mintMockUSDC", usdc, MockUSDCAbi as Abi, "mint", [LOCK_AMOUNT]);
  await sendBase("approveLockbox", usdc, MockUSDCAbi as Abi, "approve", [lockbox, LOCK_AMOUNT]);
  const intentRef = keccak256(toHex("talaria-demo-checkout"));
  const locked = await sendBase("lock", lockbox, TalariaLockboxAbi as Abi, "lock", [payer.address, LOCK_AMOUNT, intentRef]);

  // Real relayer code from here: the bridge worker and the HTTP API.
  const store = new Store(resolve(root, "services/relayer/data/state.json"));
  const chain = liveChain({ portaldot, base, wallet, core, lockbox, srcChainId: BigInt(baseSepolia.id), store, maxTxPerHour: 10, live: true });

  let before = await balance();
  for (let attempt = 0; attempt < 40 && (await pollBridge(chain, store, locked.blockNumber - 1n)) === 0; attempt++) {
    await new Promise((done) => setTimeout(done, 3_000));
  }
  const creditHash = store.get("bridge", locked.transactionHash)?.txHash as Hex | undefined;
  if (!creditHash) throw new Error("Bridge credit did not land");
  const creditReceipt = await portaldot.getTransactionReceipt({ hash: creditHash });
  record("bridge", "creditFromBridge", creditHash, creditReceipt.blockNumber, creditReceipt.status, `${formatEther(before - (await balance()))} tPOT`, creditReceipt);

  const sdk = createTalaria({ publicClient: portaldot });
  console.log(`Payer credited ${await sdk.getBalance(payer.address)} base units`);

  await send("createInvoice", core, TalariaCoreAbi as Abi, "createInvoice", [INVOICE_AMOUNT, keccak256(toHex("demo order 1")), Math.floor(Date.now() / 1000) + 3600]);
  const invoiceId = (await portaldot.readContract({ address: core, abi: TalariaCoreAbi, functionName: "invoiceCount" })) as bigint;

  const app = buildServer(chain, store);
  const relayerUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    before = await balance();
    const payerSdk = createTalaria({ account: payer, publicClient: portaldot, relayerUrl });
    const payHash = await payerSdk.payInvoice(invoiceId);
    const payReceipt = await portaldot.waitForTransactionReceipt({ hash: payHash, timeout: 180_000 });
    record("checkout", "payInvoice (gasless intent)", payHash, payReceipt.blockNumber, payReceipt.status, `${formatEther(before - (await balance()))} tPOT, paid by relayer`, payReceipt);
  } finally {
    await app.close();
  }

  const invoice = await sdk.getInvoice(invoiceId);
  console.log(`\nInvoice ${invoiceId}: payer ${invoice.payer}, amount ${invoice.amount}`);
  console.log(`Payer balance ${await sdk.getBalance(payer.address)}, merchant balance ${await sdk.getBalance(account.address)}`);
  console.log(`Payer tPOT ${formatEther(await portaldot.getBalance({ address: payer.address }))}`);
  console.log(`Deployer tPOT left ${formatEther(await balance())}`);
}

main().catch((error) => {
  console.error(String(error?.shortMessage ?? error?.message ?? error));
  process.exit(1);
});
