// Read-only probe of the Portaldot V3 testnet. Sends no transactions and reads no private keys.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rpc } from "./lib/rpc";
import { accountIdToH160, h160ToSs58, ss58ToH160 } from "../../packages/sdk/src/utils/address";

loadEnv({ path: resolve(__dirname, "../../.env") });

const EVM_RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const WS = process.env.PORTALDOT_WS || "wss://test-node-v3.portaldot.dev";

async function probeUrl(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return { url, status: response.status };
  } catch (error) {
    return { url, error: String(error) };
  }
}

async function balances(api: ApiPromise, h160: `0x${string}`, account: string) {
  const evm = await rpc(EVM_RPC, "eth_getBalance", [h160, "latest"]);
  const info = (await api.query.system.account(account)) as any;
  const wei = evm.ok ? BigInt(evm.result as string) : null;
  const free = BigInt(info.data.free.toString());
  return {
    h160,
    account,
    evmWei: wei?.toString() ?? evm,
    substrateFreePlanck: free.toString(),
    substrateReservedPlanck: info.data.reserved.toString(),
    wei_equals_free_times_1e4: wei === null ? null : wei === free * 10_000n,
  };
}

async function main() {
  const out: Record<string, unknown> = { timestampUTC: new Date().toISOString(), endpoints: { EVM_RPC, WS } };

  const evm: Record<string, unknown> = {};
  for (const method of ["eth_chainId", "eth_blockNumber", "web3_clientVersion", "eth_gasPrice", "net_version", "eth_maxPriorityFeePerGas"]) {
    evm[method] = await rpc(EVM_RPC, method);
  }
  const zero = { to: "0x0000000000000000000000000000000000000000", data: "0x" };
  evm.debug_traceCall = await rpc(EVM_RPC, "debug_traceCall", [zero, "latest", { tracer: "callTracer" }]);
  out.evm = evm;

  const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
  const [chain, finalizedHash, header] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.chain.getFinalizedHead(),
    api.rpc.chain.getHeader(),
  ]);
  const finalized = await api.rpc.chain.getHeader(finalizedHash);

  // Block time measured from the last 10 blocks' timestamps.
  const latest = header.number.toNumber();
  const momentAt = async (n: number) => {
    const at = await api.at(await api.rpc.chain.getBlockHash(n));
    return BigInt((await at.query.timestamp.now()).toString());
  };
  const measuredBlockTimeMs = latest > 10 ? Number(await momentAt(latest) - await momentAt(latest - 10)) / 10 : null;

  out.substrate = {
    chain: chain.toString(),
    specName: api.runtimeVersion.specName.toString(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    tokenDecimals: api.registry.chainDecimals,
    tokenSymbol: api.registry.chainTokens,
    ss58Format: api.registry.chainSS58,
    latestBlock: latest,
    finalizedBlock: finalized.number.toNumber(),
    measuredBlockTimeMs,
    existentialDeposit: api.consts.balances?.existentialDeposit?.toString() ?? null,
    hasRevivePallet: Boolean(api.tx.revive),
    reviveCalls: api.tx.revive ? Object.keys(api.tx.revive) : [],
    reviveStorage: api.query.revive ? Object.keys(api.query.revive) : [],
    reviveConsts: api.consts.revive ? Object.fromEntries(Object.entries(api.consts.revive).map(([k, v]) => [k, v.toString()])) : {},
  };

  // Check the mapping rule against accounts the chain has actually mapped.
  const mapped: unknown[] = [];
  if (api.query.revive?.originalAccount) {
    const entries = await api.query.revive.originalAccount.entriesPaged({ args: [], pageSize: 5 });
    for (const [key, value] of entries) {
      const onChainH160 = key.args[0].toHex() as `0x${string}`;
      const account = (value as any).unwrap ? (value as any).unwrap() : value;
      const derived = accountIdToH160(account.toU8a());
      mapped.push({
        onChainH160,
        derivedH160: derived,
        matches: derived.toLowerCase() === onChainH160.toLowerCase(),
        balances: await balances(api, onChainH160, account.toString()),
      });
    }
  }
  out.mappedAccountSamples = mapped;

  const { DEPLOYER_H160, NATIVE_SS58 } = process.env;
  out.deployerEvm = DEPLOYER_H160
    ? await balances(api, DEPLOYER_H160 as `0x${string}`, h160ToSs58(DEPLOYER_H160 as `0x${string}`))
    : "DEPLOYER_H160 not set";
  out.nativeWallet = NATIVE_SS58 ? await balances(api, ss58ToH160(NATIVE_SS58), NATIVE_SS58) : "NATIVE_SS58 not set";
  await api.disconnect();

  out.urls = await Promise.all(["https://node-console.portaldot.dev/", "https://scanner-testnet-v3.portaldot.dev"].map(probeUrl));

  const dir = resolve(__dirname, "../../evidence");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, "probe-chain.json");
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`Saved ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
