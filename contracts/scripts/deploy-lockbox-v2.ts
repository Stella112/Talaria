// Deploys TalariaLockboxV2 to Base Sepolia. Spends test ETH only.
import { encodeDeployData, formatEther } from "viem";
import { addRecord, addressOf, artifact, base, baseWallet, fail, keyAccount, preview, recordTx, runtimeBytes } from "./lib/env";

async function main() {
  const account = keyAccount("DEPLOYER_PRIVATE_KEY");
  const relayer = keyAccount("RELAYER_PRIVATE_KEY").address;
  const usdc = addressOf("base-sepolia.json", "MockUSDC")!;
  const { abi, bytecode } = artifact("TalariaLockboxV2");
  const data = encodeDeployData({ abi, bytecode, args: [usdc, account.address, relayer] as never });
  const gas = await base.estimateGas({ account, data });
  const price = await base.getGasPrice();
  const before = await base.getBalance({ address: account.address });
  console.log(`${preview ? "PREVIEW: nothing is sent." : "LIVE"}\nTalariaLockboxV2 ${runtimeBytes("TalariaLockboxV2")} bytes\nToken ${usdc}\nBalance ${formatEther(before)} ETH\nEstimated ${formatEther(gas * price)} ETH`);
  if (preview) return;
  const hash = await baseWallet(account).sendTransaction({ data });
  const receipt = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed in ${hash}`);
  addRecord("base-sepolia.json", { name: "TalariaLockboxV2", address: receipt.contractAddress, deployTxHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeBytecodeBytes: runtimeBytes("TalariaLockboxV2"), deployer: account.address });
  recordTx("deploy (Base Sepolia)", "TalariaLockboxV2", receipt, "test ETH");
  console.log(`Address ${receipt.contractAddress}\nRun: node contracts/scripts/export-sdk.js`);
}

main().catch(fail);
