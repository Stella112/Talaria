import { createPublicClient, defineChain, http, type PublicClient, type Transport } from "viem";

export const PORTALDOT_EVM_RPC = "https://test-evm-rpc-v3.portaldot.dev";

export const portaldotTestnet = defineChain({
  id: 420420777,
  name: "Portaldot V3 Testnet",
  nativeCurrency: { name: "tPOT", symbol: "tPOT", decimals: 18 },
  rpcUrls: { default: { http: [PORTALDOT_EVM_RPC] } },
  testnet: true,
});

/** The single place RPC transports are built: 30 s timeout, up to 5 retries with exponential backoff. */
export function retryTransport(url: string): Transport {
  return http(url, { timeout: 30_000, retryCount: 5, retryDelay: 500 });
}

export function portaldotClient(rpcUrl: string = PORTALDOT_EVM_RPC): PublicClient {
  return createPublicClient({ chain: portaldotTestnet, transport: retryTransport(rpcUrl) }) as PublicClient;
}
