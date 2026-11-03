// Runs faucet, permit and transferFrom on the deployed TalariaUSD. Spends tPOT: run only after approval.
import { config as loadEnv } from "dotenv";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, http, parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ss58ToH160 } from "../../packages/sdk/src/utils/address";

const root = resolve(__dirname, "../..");
loadEnv({ path: resolve(root, ".env") });

const RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const chain = defineChain({
  id: 420420777,
  name: "Portaldot V3 Testnet",
  nativeCurrency: { name: "tPOT", symbol: "tPOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const AMOUNT = 100_000_000n; // 100 tUSD

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY!;
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const recipient = ss58ToH160(process.env.NATIVE_SS58!);
  const transport = http(RPC, { timeout: 30_000, retryCount: 5, retryDelay: 1_000 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  const records = JSON.parse(readFileSync(resolve(root, "deployments/portaldot-testnet.json"), "utf8"));
  const address = records.find((r: any) => r.name === "TalariaUSD").address as `0x${string}`;
  const { abi } = JSON.parse(readFileSync(resolve(__dirname, "../artifacts/contracts/TalariaUSD.sol/TalariaUSD.json"), "utf8"));

  const table = resolve(root, "evidence/TRANSACTIONS.md");
  if (!existsSync(table)) writeFileSync(table, "| Rail | Action | Tx hash | Block | Result | tPOT spent |\n|---|---|---|---|---|---|\n");

  async function send(label: string, functionName: string, args: unknown[]) {
    const data = encodeFunctionData({ abi, functionName, args });
    const before = await pub.getBalance({ address: account.address });
    const gas = await pub.estimateGas({ account, to: address, data });
    const maxCost = gas * (await pub.getGasPrice());
    console.log(`\n${label}: balance ${formatEther(before)}, estimated max ${formatEther(maxCost)} tPOT`);
    if (before < maxCost) {
      console.log("NOT SENT: balance is below the estimate.");
      process.exit(2);
    }
    const hash = await wallet.sendTransaction({ to: address, data, gas });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    const spent = formatEther(before - (await pub.getBalance({ address: account.address })));
    writeFileSync(
      resolve(root, `evidence/receipt-${label}-${hash}.json`),
      JSON.stringify(receipt, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n",
    );
    appendFileSync(table, `| tUSD | ${label} | \`${hash}\` | ${receipt.blockNumber} | ${receipt.status} | ${spent} |\n`);
    console.log(`${hash} block ${receipt.blockNumber} ${receipt.status}, spent ${spent} tPOT`);
    if (receipt.status !== "success") process.exit(1);
  }

  await send("faucet", "faucet", []);

  const read = (functionName: string, args: unknown[] = []) => pub.readContract({ address, abi, functionName, args }) as Promise<any>;
  const nonce = await read("nonces", [account.address]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await account.signTypedData({
    domain: { name: await read("name"), version: "1", chainId: chain.id, verifyingContract: address },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: account.address, spender: account.address, value: AMOUNT, nonce, deadline },
  });
  const { r, s, v } = parseSignature(signature);
  await send("permit", "permit", [account.address, account.address, AMOUNT, deadline, Number(v), r, s]);
  await send("transferFrom", "transferFrom", [account.address, recipient, AMOUNT]);

  console.log(`\nDeployer tUSD ${await read("balanceOf", [account.address])}`);
  console.log(`Recipient ${recipient} tUSD ${await read("balanceOf", [recipient])}`);
  console.log(`Nonce ${await read("nonces", [account.address])}`);
  console.log(`Deployer ${formatEther(await pub.getBalance({ address: account.address }))} tPOT`);
}

main().catch((error) => {
  console.error(String(error?.shortMessage ?? error?.message ?? error));
  process.exit(1);
});
