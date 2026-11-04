import { baseSepoliaDeployments, bnbTestnetDeployments, portaldotClient, portaldotDeployments, portaldotTestnet, retryTransport } from "@talaria-pay/sdk";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, parseEther, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, bscTestnet } from "viem/chains";
import { liveChain, liveSettlement } from "./chain";
import { sourceChains } from "./config";
import { Db } from "./db";
import { buildServer } from "./server";
import { pollBridgeOut, pollOutcomes, runReleaseKeeper } from "./settlement";
import { Store } from "./store";
import { liveFeedbackWriter, TrustService } from "./trust";
import { Webhooks } from "./webhooks";
import { loop, pollBridge, runKeeper, settleVouchers } from "./workers";

loadEnv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const toAccount = (key: string) => privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const key = process.env.RELAYER_PRIVATE_KEY;
if (!key) throw new Error("RELAYER_PRIVATE_KEY is not set");
const account = toAccount(key);
const rpc = process.env.PORTALDOT_EVM_RPC || portaldotTestnet.rpcUrls.default.http[0];
const live = process.env.RELAYER_LIVE === "1";
const maxTxPerHour = Number(process.env.RELAYER_MAX_TX_PER_HOUR || 5);
const floorWei = parseEther(process.env.RELAYER_MIN_TPOT || "30");

const store = new Store(resolve(__dirname, "../data/state.json"));
const db = new Db(resolve(__dirname, "../data/talaria.sqlite"));
const webhooks = new Webhooks(db);
const portaldot = portaldotClient(rpc);
const wallet = createWalletClient({ account, chain: portaldotTestnet, transport: retryTransport(rpc) });
const deployed = { ...baseSepoliaDeployments };
const sources = sourceChains(process.env, deployed, bnbTestnetDeployments);
const [source] = sources;
const base = createPublicClient({ chain: baseSepolia, transport: retryTransport(source.rpc) }) as PublicClient;
const baseWallet = createWalletClient({ account, chain: baseSepolia, transport: retryTransport(source.rpc) });

const common = { portaldot, wallet, core: portaldotDeployments.TalariaCore, store, maxTxPerHour, live, floorWei };
const chain = liveChain({
  ...common,
  base,
  lockbox: source.lockbox,
  subscriptions: portaldotDeployments.TalariaSubscriptions,
  channels: portaldotDeployments.TalariaChannels,
  srcChainId: BigInt(source.chainId),
});

const protect = portaldotDeployments.TalariaProtect;
const bridgeOut = portaldotDeployments.TalariaBridgeOut;
const v2 = deployed.TalariaLockboxV2;
const clientFor = (rpcUrl: string, id: number) => createPublicClient({ chain: id === bscTestnet.id ? bscTestnet : baseSepolia, transport: retryTransport(rpcUrl) }) as PublicClient;
const walletFor = (rpcUrl: string, id: number) => createWalletClient({ account, chain: id === bscTestnet.id ? bscTestnet : baseSepolia, transport: retryTransport(rpcUrl) });
const bnb = sources.find((s) => s.chainId === bscTestnet.id);
const settlement = liveSettlement({
  ...common,
  protect,
  bridgeOut,
  destinations: new Map([
    ...(v2 ? [[BigInt(source.chainId), { client: base, wallet: baseWallet, lockbox: v2 }] as const] : []),
    ...(bnb?.lockbox ? [[BigInt(bnb.chainId), { client: clientFor(bnb.rpc, bnb.chainId), wallet: walletFor(bnb.rpc, bnb.chainId), lockbox: bnb.lockbox }] as const] : []),
  ]),
});

const trust =
  protect && process.env.ATTESTER_PRIVATE_KEY && process.env.SETTLEMENT_PRIVATE_KEY
    ? new TrustService({
        base,
        db,
        attester: toAccount(process.env.ATTESTER_PRIVATE_KEY),
        settlementClient: toAccount(process.env.SETTLEMENT_PRIVATE_KEY).address,
        protect,
        portaldotChainId: portaldotTestnet.id,
        srcChainId: BigInt(source.chainId),
      })
    : undefined;

console.log(`[relayer] ${account.address} ${live ? "LIVE: writes spend tPOT" : "READ-ONLY: writes are refused"}`);

const startBlock = BigInt(process.env.BRIDGE_START_BLOCK || 0);
if (source.lockbox) loop("bridge", 15_000, () => pollBridge(chain, store, startBlock));
if (bnb?.lockbox) {
  const bnbChain = liveChain({ ...common, base: clientFor(bnb.rpc, bnb.chainId), lockbox: bnb.lockbox, srcChainId: BigInt(bnb.chainId) });
  const bnbCursor = new Store(resolve(__dirname, "../data/state-bnb.json"));
  loop("bridge-bnb", 15_000, () => pollBridge(bnbChain, bnbCursor, BigInt(process.env.BNB_START_BLOCK || 0)));
}
if (portaldotDeployments.TalariaSubscriptions) loop("keeper", 60_000, () => runKeeper(chain));
if (portaldotDeployments.TalariaChannels) loop("settler", 60_000, () => settleVouchers(chain, store));

const settlementStart = BigInt(process.env.SETTLEMENT_START_BLOCK || 0);
if (bridgeOut && v2) loop("bridge-out", 15_000, () => pollBridgeOut(settlement, db, settlementStart, webhooks));
if (protect && process.env.SETTLEMENT_PRIVATE_KEY) {
  const settlementWallet = createWalletClient({ account: toAccount(process.env.SETTLEMENT_PRIVATE_KEY), chain: baseSepolia, transport: retryTransport(source.rpc) });
  const write = liveFeedbackWriter(base, settlementWallet, live);
  loop("outcomes", 15_000, () => pollOutcomes(settlement, db, settlementStart, write, portaldotTestnet.id, webhooks));
  loop("release", 30_000, () => runReleaseKeeper(settlement, db));
}

buildServer(chain, store, { db, trust, webhooks, protect: protect ? settlement : undefined })
  .listen({ port: Number(process.env.RELAYER_PORT || 8787), host: "0.0.0.0" })
  .then((address) => console.log(`[relayer] listening on ${address}`));
