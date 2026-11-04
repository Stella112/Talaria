import { baseSepolia, bscTestnet } from "viem/chains";

/** A chain funds can come from and go back to. Adding BNB later needs a deploy and one entry here. */
export type SourceChain = {
  chainId: number;
  name: string;
  rpc: string;
  lockbox?: `0x${string}`;
  token?: `0x${string}`;
  confirmations: bigint;
};

export function sourceChains(env: Record<string, string | undefined>, deployed: Record<string, `0x${string}` | undefined>, bnb: Record<string, `0x${string}` | undefined> = {}): SourceChain[] {
  return [
    {
      chainId: baseSepolia.id,
      name: "Base Sepolia",
      rpc: env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      lockbox: deployed.TalariaLockboxV2 ?? deployed.TalariaLockbox,
      token: deployed.MockUSDC,
      confirmations: 2n,
    },
    {
      chainId: bscTestnet.id,
      name: "BNB testnet",
      rpc: env.BNB_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com",
      lockbox: bnb.TalariaLockboxV2,
      token: bnb.MockUSDC,
      confirmations: 3n,
    },
  ];
}
