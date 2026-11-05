import { baseSepoliaDeployments, MockUSDCAbi, TalariaCoreAbi, TalariaLockboxV2Abi, toUnits } from "@talaria-pay/sdk";
import { createPublicClient, http, keccak256, parseEventLogs, toHex, type Address, type Hex, type TransactionReceipt } from "viem";
import { baseSepolia } from "viem/chains";
import { client, reader, sourceWallet, tusd } from "@/lib/talaria";

/** The four rails that run on Base Sepolia, on a second copy of Core. They are direct transactions, so they need Base test ETH. */
export const BASE = {
  core: baseSepoliaDeployments.TalariaCore,
  usdc: baseSepoliaDeployments.MockUSDC,
  lockbox: baseSepoliaDeployments.TalariaLockboxV2,
  subscriptions: baseSepoliaDeployments.TalariaSubscriptions,
  streams: baseSepoliaDeployments.TalariaStreams,
  remit: baseSepoliaDeployments.TalariaRemit,
};

export const baseClient = createPublicClient({ chain: baseSepolia, transport: http() });

/** Sends one transaction on Base Sepolia from the connected wallet, and waits for it. */
export async function baseTx(to: Address, abi: any, functionName: string, args: unknown[]): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const wallet = await sourceWallet(baseSepolia.id);
  const hash = await wallet.writeContract({ account: wallet.account!, chain: baseSepolia, address: to, abi, functionName, args });
  const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return { hash, receipt };
}

export function eventId(receipt: TransactionReceipt, abi: any, eventName: string): bigint {
  const [log] = parseEventLogs({ abi, logs: receipt.logs, eventName }) as any[];
  if (!log) throw new Error(`${eventName} was not found in this transaction`);
  return log.args.id as bigint;
}

export async function baseBalances(address: Address) {
  const [account, wallet, eth] = await Promise.all([
    baseClient.readContract({ address: BASE.core, abi: TalariaCoreAbi as any, functionName: "balances", args: [address] }) as Promise<bigint>,
    baseClient.readContract({ address: BASE.usdc, abi: MockUSDCAbi as any, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
    baseClient.getBalance({ address }),
  ]);
  return { account, wallet, eth };
}

/** Mints test mUSDC and deposits it into the Talaria account on Base. */
export async function fundOnBase(amount: string): Promise<Hex> {
  const units = toUnits(amount);
  await baseTx(BASE.usdc, MockUSDCAbi, "mint", [units]);
  await baseTx(BASE.usdc, MockUSDCAbi, "approve", [BASE.core, units]);
  return (await baseTx(BASE.core, TalariaCoreAbi, "deposit", [units])).hash;
}

/** Moves a balance on Base to Portaldot: withdraw, then lock. One trusted relayer credits it on Portaldot. */
export async function settleToPortaldot(amount: string, recipient: Address): Promise<Hex> {
  const units = toUnits(amount);
  const reserve = (await client.readContract({ address: reader.addresses.core, abi: TalariaCoreAbi as any, functionName: "bridgeReserve" })) as bigint;
  if (reserve < units) throw new Error(`The bridge reserve holds ${tusd(reserve)} tUSD, too little to credit this. Nothing was sent.`);
  await baseTx(BASE.core, TalariaCoreAbi, "withdraw", [units]);
  await baseTx(BASE.usdc, MockUSDCAbi, "approve", [BASE.lockbox, units]);
  return (await baseTx(BASE.lockbox, TalariaLockboxV2Abi, "lock", [recipient, units, keccak256(toHex(`settle-${recipient}-${Date.now()}`))])).hash;
}
