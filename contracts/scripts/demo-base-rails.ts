// Real transactions for the four rails on Base Sepolia, and with --settle, proceeds to Portaldot.
// Spends test ETH. --settle also costs the relayer tPOT for the credit on Portaldot.
import { encodeFunctionData, formatEther, keccak256, parseSignature, toHex, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPaywall } from "../../packages/sdk/src/paywall";
import { signVoucher } from "../../packages/sdk/src/intents";
import { addressOf, artifact, base, BASE_CHAIN_ID, baseWallet, fail, flag, keyAccount, recordTx } from "./lib/env";

const USDC = 1_000_000n;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const file = "base-sepolia.json";

async function main() {
  const buyer = keyAccount("DEMO_BUYER_KEY");
  const merchant = keyAccount("TRUSTED_COFFEE_KEY");
  const usdc = addressOf(file, "MockUSDC")!;
  const core = addressOf(file, "TalariaCore")!;
  const lockbox = addressOf(file, "TalariaLockboxV2")!;
  const subs = addressOf(file, "TalariaSubscriptions")!;
  const streams = addressOf(file, "TalariaStreams")!;
  const channels = addressOf(file, "TalariaChannels")!;
  const remit = addressOf(file, "TalariaRemit")!;

  const call = async (who: typeof buyer, rail: string, action: string, name: string, to: Address, functionName: string, args: unknown[]) => {
    const abi = artifact(name).abi as Abi;
    const hash = await baseWallet(who).sendTransaction({ to, data: encodeFunctionData({ abi, functionName, args }) });
    const receipt = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${action} reverted: ${hash}`);
    recordTx(rail, action, receipt, "test ETH");
    return receipt;
  };
  const read = (name: string, address: Address, functionName: string, args: unknown[] = []) => base.readContract({ address, abi: artifact(name).abi as Abi, functionName, args }) as Promise<any>;
  const balance = (who: Address) => read("TalariaCore", core, "balances", [who]);

  if (flag("--settle")) {
    const proceeds = (await balance(merchant.address)) as bigint;
    if (proceeds === 0n) throw new Error("The merchant has no proceeds on Base");
    console.log(`Settling ${proceeds} base units to Portaldot for ${merchant.address}`);
    await call(merchant, "settlement (Base Sepolia)", "withdraw proceeds", "TalariaCore", core, "withdraw", [proceeds]);
    await call(merchant, "settlement (Base Sepolia)", "approve lockbox", "MockUSDC", usdc, "approve", [lockbox, proceeds]);
    await call(merchant, "settlement (Base Sepolia)", "lock proceeds", "TalariaLockboxV2", lockbox, "lock", [merchant.address, proceeds, keccak256(toHex(`base-rails-${Date.now()}`))]);
    return console.log("Locked. The relayer credits this on Portaldot.");
  }

  console.log(`Buyer ${formatEther(await base.getBalance({ address: buyer.address }))} ETH, merchant ${formatEther(await base.getBalance({ address: merchant.address }))} ETH`);

  console.log("\n== Fund the buyer on Base");
  await call(buyer, "setup (Base Sepolia)", "mint mUSDC", "MockUSDC", usdc, "mint", [30n * USDC]);
  await call(buyer, "setup (Base Sepolia)", "approve core", "MockUSDC", usdc, "approve", [core, 30n * USDC]);
  await call(buyer, "setup (Base Sepolia)", "deposit", "TalariaCore", core, "deposit", [30n * USDC]);

  console.log("\n== Subscriptions");
  await call(merchant, "subscriptions (Base Sepolia)", "create plan", "TalariaSubscriptions", subs, "createPlan", [USDC, 60, 3]);
  const planId = await read("TalariaSubscriptions", subs, "planCount");
  await call(buyer, "subscriptions (Base Sepolia)", "subscribe", "TalariaSubscriptions", subs, "subscribe", [planId]);
  const subId = await read("TalariaSubscriptions", subs, "subscriptionCount");
  await call(merchant, "subscriptions (Base Sepolia)", "charge", "TalariaSubscriptions", subs, "charge", [subId]);
  await call(buyer, "subscriptions (Base Sepolia)", "cancel", "TalariaSubscriptions", subs, "cancel", [subId]);

  console.log("\n== Streaming");
  await call(buyer, "streaming (Base Sepolia)", "start stream", "TalariaStreams", streams, "startStream", [merchant.address, 10_000n, 5n * USDC]);
  const streamId = await read("TalariaStreams", streams, "streamCount");
  await sleep(10_000);
  await call(merchant, "streaming (Base Sepolia)", "withdraw accrued", "TalariaStreams", streams, "withdraw", [streamId]);
  await call(buyer, "streaming (Base Sepolia)", "stop stream", "TalariaStreams", streams, "stopStream", [streamId]);

  console.log("\n== Pay-per-call: 10 calls checked by the real paywall, then one settlement");
  await call(buyer, "pay-per-call (Base Sepolia)", "open channel", "TalariaChannels", channels, "openChannel", [merchant.address, 2n * USDC]);
  const channelId = await read("TalariaChannels", channels, "channelCount");
  const gate = createPaywall({ client: base, channels, token: usdc }, { price: "0.01", provider: merchant.address });
  let latest: any;
  for (let call_ = 1n; call_ <= 10n; call_++) {
    latest = await signVoucher(buyer, channels, BASE_CHAIN_ID, { channelId, cumulativeAmount: call_ * 10_000n, nonce: call_ });
    const result = await gate.check(JSON.stringify(latest, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    if (!result.paid) throw new Error(`Paywall refused call ${call_}: ${JSON.stringify(result.body)}`);
  }
  console.log("10 calls accepted off-chain");
  await call(merchant, "pay-per-call (Base Sepolia)", "redeem 10 calls in one batch", "TalariaChannels", channels, "redeemBatch", [[latest]]);
  await call(buyer, "pay-per-call (Base Sepolia)", "request close", "TalariaChannels", channels, "requestClose", [channelId]);

  console.log("\n== Remittance");
  const expiry = Math.floor(Date.now() / 1000) + 86_400;
  await call(buyer, "remittance (Base Sepolia)", "send to address", "TalariaRemit", remit, "sendRemit", [merchant.address, false, USDC, true, expiry]);
  await call(merchant, "remittance (Base Sepolia)", "claim", "TalariaRemit", remit, "claimRemit", [await read("TalariaRemit", remit, "remitCount")]);
  const code = generatePrivateKey();
  await call(buyer, "remittance (Base Sepolia)", "send claim link", "TalariaRemit", remit, "sendRemit", [privateKeyToAccount(code).address, true, USDC, true, expiry]);
  const linkId = await read("TalariaRemit", remit, "remitCount");
  const { keccak256: _k, encodeAbiParameters } = await import("viem");
  void _k;
  const hash: Hex = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }], [BigInt(BASE_CHAIN_ID), remit, linkId, merchant.address]));
  const { r, s, v } = parseSignature(await privateKeyToAccount(code).sign({ hash }));
  await call(merchant, "remittance (Base Sepolia)", "claim with link", "TalariaRemit", remit, "claimWithCode", [linkId, merchant.address, Number(v), r, s]);

  console.log(`\nBuyer balance ${await balance(buyer.address)}, merchant proceeds ${await balance(merchant.address)} base units`);
  console.log(`Buyer ${formatEther(await base.getBalance({ address: buyer.address }))} ETH, merchant ${formatEther(await base.getBalance({ address: merchant.address }))} ETH`);
}

main().catch(fail);
