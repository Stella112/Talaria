// Prepares the live demo: moves the relayer role to the VPS wallet, funds the bridge reserve and
// gives each demo wallet a little test ETH. Spends tPOT and test ETH: run only after approval.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeFunctionData, formatEther, parseEther, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { h160ToSs58 } from "../../packages/sdk/src/utils/address";
import { TalariaCoreAbi, TalariaLockboxV2Abi, TalariaUSDAbi } from "../../packages/sdk/src/generated";
import { addressOf, base, baseWallet, fail, keyAccount, portaldot, portaldotWallet, preview, recordTx, root } from "./lib/env";

const RESERVE = 50_000_000n; // 50 tUSD
const ETH_EACH = parseEther("0.003");

async function main() {
  const deployer = keyAccount("DEPLOYER_PRIVATE_KEY");
  const vpsKey = readFileSync(resolve(root, "deploy/.env.talaria"), "utf8").match(/^RELAYER_PRIVATE_KEY=(0x[0-9a-f]{64})/m)?.[1] as Hex;
  const relayer = privateKeyToAccount(vpsKey).address;
  const core = addressOf("portaldot-testnet.json", "TalariaCore")!;
  const token = addressOf("portaldot-testnet.json", "TalariaUSD")!;
  const lockbox = addressOf("base-sepolia.json", "TalariaLockboxV2")!;
  const wallet = portaldotWallet(deployer);
  const ethWallet = baseWallet(deployer);
  const price = await portaldot.getGasPrice();

  const recipients = [
    ["VPS relayer", relayer],
    ["settlement", keyAccount("SETTLEMENT_PRIVATE_KEY").address],
    ["demo buyer", keyAccount("DEMO_BUYER_KEY").address],
    ["demo client", keyAccount("DEMO_CLIENT_KEY").address],
    ["agent", keyAccount("AGENT_SESSION_KEY").address],
    ["Trusted Coffee", keyAccount("TRUSTED_COFFEE_KEY").address],
    ["New Shop", keyAccount("NEW_SHOP_KEY").address],
  ] as const;

  const steps: [string, `0x${string}`, Abi, string, unknown[]][] = [
    ["Core setRelayer", core, TalariaCoreAbi as Abi, "setRelayer", [relayer]],
    ["approve reserve", token, TalariaUSDAbi as Abi, "approve", [core, RESERVE]],
  ];

  console.log(`${preview ? "PREVIEW: nothing is sent." : "LIVE"}`);
  console.log(`VPS relayer ${relayer}\nFund it with tPOT at ${h160ToSs58(relayer)}`);
  console.log(`Deployer ${formatEther(await portaldot.getBalance({ address: deployer.address }))} tPOT, ${formatEther(await base.getBalance({ address: deployer.address }))} ETH`);
  console.log(`Current Core relayer ${await portaldot.readContract({ address: core, abi: TalariaCoreAbi as any, functionName: "relayer" })}`);
  console.log(`Current reserve ${await portaldot.readContract({ address: core, abi: TalariaCoreAbi as any, functionName: "bridgeReserve" })}`);
  console.log(`Test ETH: ${formatEther(ETH_EACH)} each to ${recipients.map(([name]) => name).join(", ")}`);
  for (const [action, to, abi, functionName, args] of steps) {
    const gas = await portaldot.estimateGas({ account: deployer, to, data: encodeFunctionData({ abi, functionName, args }) });
    console.log(`${action}: estimated ${formatEther(gas * price)} tPOT`);
  }
  console.log("fundReserve follows the approval, so it is estimated at about 3.86 tPOT.");
  if (preview) return;

  const send = async (action: string, to: `0x${string}`, abi: Abi, functionName: string, args: unknown[]) => {
    const before = await portaldot.getBalance({ address: deployer.address });
    const hash = await wallet.sendTransaction({ to, data: encodeFunctionData({ abi, functionName, args }) });
    const receipt = await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${action} reverted: ${hash}`);
    recordTx("setup", action, receipt, `${formatEther(before - (await portaldot.getBalance({ address: deployer.address })))} tPOT`);
  };
  for (const [action, to, abi, functionName, args] of steps) await send(action, to, abi, functionName, args);
  await send("fund reserve", core, TalariaCoreAbi as Abi, "fundReserve", [RESERVE]);

  const lockboxHash = await ethWallet.writeContract({ address: lockbox, abi: TalariaLockboxV2Abi as any, functionName: "setRelayer", args: [relayer] });
  recordTx("setup (Base Sepolia)", "Lockbox setRelayer", await base.waitForTransactionReceipt({ hash: lockboxHash, timeout: 180_000 }), "test ETH");
  for (const [name, address] of recipients) {
    const hash = await ethWallet.sendTransaction({ to: address, value: ETH_EACH });
    recordTx("setup (Base Sepolia)", `fund ${name}`, await base.waitForTransactionReceipt({ hash, timeout: 180_000 }), "test ETH");
  }
}

main().catch(fail);
