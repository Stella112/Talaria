// Read-only: confirms the deployed TalariaCore answers on the live chain.
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, defineChain, formatEther, http } from "viem";

const root = resolve(__dirname, "../..");
loadEnv({ path: resolve(root, ".env") });
const RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const chain = defineChain({
  id: 420420777,
  name: "Portaldot V3 Testnet",
  nativeCurrency: { name: "tPOT", symbol: "tPOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

(async () => {
  const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000, retryCount: 5 }) });
  const records = JSON.parse(readFileSync(resolve(root, "deployments/portaldot-testnet.json"), "utf8"));
  const address = records.find((r: any) => r.name === "TalariaCore").address;
  const { abi } = JSON.parse(readFileSync(resolve(__dirname, "../artifacts/contracts/TalariaCore.sol/TalariaCore.json"), "utf8"));
  for (const functionName of ["token", "owner", "relayer", "invoiceCount", "receiptCount", "bridgeReserve", "domainSeparator"]) {
    console.log(functionName, String(await pub.readContract({ address, abi, functionName })));
  }
  console.log("deployer tPOT", formatEther(await pub.getBalance({ address: process.env.DEPLOYER_H160 as `0x${string}` })));
})().catch((error) => {
  console.error(String(error?.shortMessage ?? error));
  process.exit(1);
});
