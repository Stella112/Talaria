// Read-only: prints deployment cost estimates. Sends nothing and needs no private key.
// Run: pnpm --filter @talaria-pay/contracts estimate
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeDeployData } from "viem";
import { rpc } from "./lib/rpc";

loadEnv({ path: resolve(__dirname, "../../.env") });

// UNVERIFIED on our own deployment: PortalNexus figures from CLAUDE.md 5.4, recalibrated in Phase 1.
const TPOT_PER_BYTE = 0.0589;
const TPOT_PER_CONTRACT = 18.32;

const EVM_RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const deployer = process.env.DEPLOYER_H160 as `0x${string}` | undefined;

const CONTRACTS: { name: string; args: () => unknown[] }[] = [{ name: "TalariaUSD", args: () => [deployer] }];

async function main() {
  const balance = deployer ? await rpc(EVM_RPC, "eth_getBalance", [deployer, "latest"]) : null;
  const gasPrice = await rpc(EVM_RPC, "eth_gasPrice");
  console.log(`Deployer ${deployer ?? "not set"}`);
  console.log(`Balance  ${balance?.ok ? Number(BigInt(balance.result as string)) / 1e18 : "unknown"} tPOT`);
  console.log(`Gas price ${gasPrice.ok ? BigInt(gasPrice.result as string) : "unknown"} wei`);

  let total = 0;
  for (const { name, args } of CONTRACTS) {
    const file = resolve(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
    if (!existsSync(file)) throw new Error(`${name} not compiled: run hardhat compile`);
    const artifact = JSON.parse(readFileSync(file, "utf8"));
    const bytes = (artifact.deployedBytecode.length - 2) / 2;
    const estimate = TPOT_PER_BYTE * bytes + TPOT_PER_CONTRACT;
    total += estimate;
    console.log(`\n${name}\n  runtime bytes  ${bytes}\n  deposit est.   ${estimate.toFixed(2)} tPOT`);

    if (deployer && gasPrice.ok) {
      const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: args() as never });
      const gas = await rpc(EVM_RPC, "eth_estimateGas", [{ from: deployer, data }]);
      if (gas.ok) {
        const cost = BigInt(gas.result as string) * BigInt(gasPrice.result as string);
        console.log(`  eth_estimateGas ${BigInt(gas.result as string)} (${Number(cost) / 1e18} tPOT at gas price)`);
      } else {
        console.log(`  eth_estimateGas failed: ${JSON.stringify(gas.error)}`);
      }
    }
  }
  console.log(`\nTotal deposit estimate ${total.toFixed(2)} tPOT`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
