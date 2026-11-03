import { baseSepoliaDeployments, portaldotClient, portaldotDeployments, portaldotTestnet, retryTransport } from "@talaria-pay/sdk";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { liveChain } from "./chain";
import { buildServer } from "./server";
import { Store } from "./store";
import { loop, pollBridge, runKeeper, settleVouchers } from "./workers";

loadEnv({ path: resolve(__dirname, "../../../.env") });

const key = process.env.RELAYER_PRIVATE_KEY;
if (!key) throw new Error("RELAYER_PRIVATE_KEY is not set");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
const rpc = process.env.PORTALDOT_EVM_RPC;
const live = process.env.RELAYER_LIVE === "1";

const store = new Store(resolve(__dirname, "../data/state.json"));
const chain = liveChain({
  portaldot: portaldotClient(rpc),
  base: createPublicClient({ chain: baseSepolia, transport: retryTransport(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org") }) as PublicClient,
  wallet: createWalletClient({ account, chain: portaldotTestnet, transport: retryTransport(rpc || portaldotTestnet.rpcUrls.default.http[0]) }),
  core: portaldotDeployments.TalariaCore,
  lockbox: baseSepoliaDeployments.TalariaLockbox,
  subscriptions: portaldotDeployments.TalariaSubscriptions,
  channels: portaldotDeployments.TalariaChannels,
  srcChainId: BigInt(baseSepolia.id),
  store,
  maxTxPerHour: Number(process.env.RELAYER_MAX_TX_PER_HOUR || 20),
  live,
});

console.log(`[relayer] ${account.address} ${live ? "LIVE: writes spend tPOT" : "READ-ONLY: writes are refused"}`);

if (baseSepoliaDeployments.TalariaLockbox) {
  const startBlock = BigInt(process.env.BRIDGE_START_BLOCK || 0);
  loop("bridge", 15_000, () => pollBridge(chain, store, startBlock));
}
if (portaldotDeployments.TalariaSubscriptions) loop("keeper", 60_000, () => runKeeper(chain));
if (portaldotDeployments.TalariaChannels) loop("settler", 60_000, () => settleVouchers(chain, store));

buildServer(chain, store)
  .listen({ port: Number(process.env.RELAYER_PORT || 8787), host: "0.0.0.0" })
  .then((address) => console.log(`[relayer] listening on ${address}`));
