// Deploys TalariaBridgeOut and TalariaProtect to Portaldot, then connects them to Core.
// Spends tPOT: run without --preview only after explicit approval.
import { encodeDeployData, encodeFunctionData, formatEther, type Abi } from "viem";
import { addRecord, addressOf, artifact, BASE_CHAIN_ID, estimateTpot, fail, keyAccount, portaldot, portaldotWallet, preview, recordTx, runtimeBytes } from "./lib/env";

const TUSD = 1_000_000n;
// Set once at deploy: the contract has no setter, to save about 28 tPOT.
const TIERS = { holdTrusted: 0, holdEstablished: 600, holdNew: 1800, capTrusted: 100n * TUSD, capEstablished: 25n * TUSD, capNew: 5n * TUSD };

async function main() {
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  const attester = keyAccount("ATTESTER_PRIVATE_KEY").address;
  const core = addressOf("portaldot-testnet.json", "TalariaCore")!;
  const token = addressOf("portaldot-testnet.json", "TalariaUSD")!;
  const wallet = portaldotWallet(account);

  const plan: { name: string; args: unknown[] }[] = [
    { name: "TalariaBridgeOut", args: [core, account.address] },
    { name: "TalariaProtect", args: [core, token, account.address, attester, TIERS] },
  ];

  const balance = await portaldot.getBalance({ address: account.address });
  const gasPrice = await portaldot.getGasPrice();
  console.log(`${preview ? "PREVIEW: nothing is sent." : "LIVE"}\nDeployer ${account.address}\nBalance ${formatEther(balance)} tPOT\nArbiter ${account.address}\nAttester ${attester}`);

  let total = 0n;
  const encoded = plan.map(({ name, args }) => ({ name, data: encodeDeployData({ abi: artifact(name).abi, bytecode: artifact(name).bytecode, args: args as never }) }));
  for (const { name, data } of encoded) {
    const gas = await portaldot.estimateGas({ account, data });
    total += gas * gasPrice;
    console.log(`\n${name}\n  runtime bytes   ${runtimeBytes(name)}\n  fitted estimate ${estimateTpot(runtimeBytes(name)).toFixed(2)} tPOT\n  eth_estimateGas ${gas} (${formatEther(gas * gasPrice)} tPOT)`);
  }
  console.log(`\nBatch total by eth_estimateGas: ${formatEther(total)} tPOT`);
  if (preview) return;
  if (balance < total) throw new Error("NOT SENT: balance is below the estimate");

  const deployed: Record<string, `0x${string}`> = {};
  for (const { name, data } of encoded) {
    const before = await portaldot.getBalance({ address: account.address });
    const hash = await wallet.sendTransaction({ data, gas: await portaldot.estimateGas({ account, data }) });
    const receipt = await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} failed in ${hash}`);
    const spent = formatEther(before - (await portaldot.getBalance({ address: account.address })));
    deployed[name] = receipt.contractAddress;
    addRecord("portaldot-testnet.json", { name, address: receipt.contractAddress, deployTxHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeBytecodeBytes: runtimeBytes(name), depositEstimateTPOT: estimateTpot(runtimeBytes(name)), depositActualTPOT: null, totalBalanceChangeTPOT: spent, deployer: account.address });
    recordTx("deploy", name, receipt, `${spent} tPOT`);
  }

  const call = async (action: string, to: `0x${string}`, name: string, functionName: string, args: unknown[]) => {
    const before = await portaldot.getBalance({ address: account.address });
    const hash = await wallet.sendTransaction({ to, data: encodeFunctionData({ abi: artifact(name).abi as Abi, functionName, args }) });
    const receipt = await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${action} failed in ${hash}`);
    recordTx("setup", action, receipt, `${formatEther(before - (await portaldot.getBalance({ address: account.address })))} tPOT`);
  };
  await call("setModule protect", core, "TalariaCore", "setModule", [6, deployed.TalariaProtect]);
  await call("setModule bridge-out", core, "TalariaCore", "setModule", [7, deployed.TalariaBridgeOut]);
  await call("setDest base-sepolia", deployed.TalariaBridgeOut, "TalariaBridgeOut", "setDest", [BigInt(BASE_CHAIN_ID), true]);
  console.log("Run: node contracts/scripts/export-sdk.js");
}

main().catch(fail);
