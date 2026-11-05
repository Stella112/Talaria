import { baseSepoliaDeployments, bnbTestnetDeployments, createTalaria, portaldotClient, portaldotTestnet, type Talaria } from "@talaria-pay/sdk";
import { formatUnits, type Address, type Hex, type LocalAccount, type WalletClient } from "viem";
import { baseSepolia, bscTestnet } from "viem/chains";
import { createConfig, http } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { injected } from "wagmi/connectors";

const BNB_RPC = "https://bsc-testnet-rpc.publicnode.com";

export const wagmiConfig = createConfig({
  chains: [portaldotTestnet, baseSepolia, bscTestnet],
  connectors: [injected()],
  transports: { [portaldotTestnet.id]: http(), [baseSepolia.id]: http(), [bscTestnet.id]: http(BNB_RPC) },
  ssr: true,
});

export const RELAYER_PATH = "/api/relayer";
export const AGENT_PATH = "/api/agent";
/** Core was deployed here, so older blocks hold no events worth scanning. */
export const CORE_DEPLOY_BLOCK = 305483n;

export const client = portaldotClient(typeof window === "undefined" ? undefined : `${window.location.origin}/api/rpc`);
/** Read-only SDK: needs no wallet. */
export const reader = createTalaria({ publicClient: client });
// New locks go to V2, the lockbox the relayer watches.
export const LOCKBOX = baseSepoliaDeployments.TalariaLockboxV2 ?? baseSepoliaDeployments.TalariaLockbox;
export const MOCK_USDC = baseSepoliaDeployments.MockUSDC;

/** Chains a payer can fund from. One trusted relayer credits locks from each on Portaldot. */
export const SOURCES = [
  { id: "base", name: "Base Sepolia", short: "Base", chain: baseSepolia, rpc: undefined, lockbox: LOCKBOX, usdc: MOCK_USDC },
  { id: "bnb", name: "BNB testnet", short: "BNB", chain: bscTestnet, rpc: BNB_RPC, lockbox: bnbTestnetDeployments.TalariaLockboxV2, usdc: bnbTestnetDeployments.MockUSDC },
] as const;

/** Lets the SDK sign with a browser wallet. The key stays in the wallet. */
function walletAccount(wallet: WalletClient): LocalAccount {
  const account = wallet.account!;
  return {
    address: account.address,
    type: "local",
    source: "custom",
    publicKey: "0x",
    signTypedData: (typedData: any) => wallet.signTypedData({ ...typedData, account }),
    signMessage: () => Promise.reject(new Error("Not used")),
    signTransaction: () => Promise.reject(new Error("Not used")),
  } as unknown as LocalAccount;
}

/** Switches the wallet to Portaldot and returns an SDK that signs with it. */
export async function signer(): Promise<Talaria> {
  await switchChain(wagmiConfig, { chainId: portaldotTestnet.id });
  const wallet = await getWalletClient(wagmiConfig, { chainId: portaldotTestnet.id });
  return createTalaria({ account: walletAccount(wallet), publicClient: client, relayerUrl: RELAYER_PATH, walletClient: wallet });
}

/** Same as `signer`, for the few actions that are direct transactions and need tPOT. */
export async function sourceWallet(chainId: 84532 | 97): Promise<WalletClient> {
  await switchChain(wagmiConfig, { chainId });
  return getWalletClient(wagmiConfig, { chainId });
}

export const tusd = (value: bigint | number) => formatUnits(BigInt(value), 6);
export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const isTx = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
export type { Address, Hex };

export function explain(error: unknown): string {
  const message = (error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message ?? String(error);
  if (/ECONNREFUSED|Failed to fetch|Relayer 500/i.test(message)) return "The relayer is not reachable. Nothing was sent.";
  if (/insufficient|exceeds balance/i.test(message)) return "This wallet has too little tPOT for this direct transaction.";
  return message.split("\n")[0];
}
