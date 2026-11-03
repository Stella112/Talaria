// Read-only: reports whether funds and configuration are in place. Never prints a key.
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, formatEther, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { portaldotClient } from "../../packages/sdk/src/chain";
import { ss58ToH160 } from "../../packages/sdk/src/utils/address";

loadEnv({ path: resolve(__dirname, "../../.env"), quiet: true });

(async () => {
  const deployer = process.env.DEPLOYER_H160 as Address;
  const base = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org", { retryCount: 5 }) });
  const portaldot = portaldotClient(process.env.PORTALDOT_EVM_RPC);
  console.log("Base Sepolia ETH", formatEther(await base.getBalance({ address: deployer })));
  console.log("Deployer tPOT", formatEther(await portaldot.getBalance({ address: deployer })));
  console.log("Native tPOT", formatEther(await portaldot.getBalance({ address: ss58ToH160(process.env.NATIVE_SS58!) })));
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) {
    console.log("Relayer key: not set");
  } else {
    try {
      const address = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`).address;
      console.log("Relayer address", address, address.toLowerCase() === deployer.toLowerCase() ? "(same as deployer)" : "(differs from deployer)");
    } catch {
      console.log("Relayer key: set but not a valid private key");
    }
  }
})().catch((error) => {
  console.error(String(error?.shortMessage ?? error));
  process.exit(1);
});
