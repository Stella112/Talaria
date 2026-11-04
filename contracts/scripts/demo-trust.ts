// The live money shot. Needs the batch deployed, subjects registered and the relayer running live.
// Spends tPOT through the relayer. Every hash goes to evidence/TRANSACTIONS.md.
//   --fund     lock mUSDC on Base for the buyer, and wait for the relayer's credit
//   --seed     real purchases from Trusted Coffee, to build its history (each waits out the New hold)
import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from "viem";
import { createTalaria } from "../../packages/sdk/src";
import { addressOf, base, BASE_CHAIN_ID, baseWallet, fail, flag, keyAccount, portaldot, portaldotWallet, preview, recordTx } from "./lib/env";

const SEED_PURCHASES = 3;
const POLL_MS = 5_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const log = (text: string) => console.log(`\n== ${text}`);

async function waitFor<T>(what: string, check: () => Promise<T | null | undefined | false>, timeoutMs = 300_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check().catch(() => null);
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(POLL_MS);
  }
}

async function main() {
  const relayerUrl = process.env.RELAYER_URL;
  if (!relayerUrl) throw new Error("RELAYER_URL is not set");
  const protect = addressOf("portaldot-testnet.json", "TalariaProtect");
  const bridgeOut = addressOf("portaldot-testnet.json", "TalariaBridgeOut");
  const lockbox = addressOf("base-sepolia.json", "TalariaLockboxV2");
  const usdc = addressOf("base-sepolia.json", "MockUSDC")!;
  if (!protect || !bridgeOut || !lockbox) throw new Error("Deploy TalariaProtect, TalariaBridgeOut and TalariaLockboxV2 first");

  const buyer = keyAccount("DEMO_BUYER_KEY");
  const agent = keyAccount("AGENT_SESSION_KEY");
  const newShop = keyAccount("NEW_SHOP_KEY").address;
  const coffee = keyAccount("TRUSTED_COFFEE_KEY").address;
  const arbiter = keyAccount("DEPLOYER_PRIVATE_KEY");
  const common = { publicClient: portaldot, relayerUrl };
  const buyerSdk = createTalaria({ account: buyer, ...common });
  const agentSdk = createTalaria({ account: agent, ...common });

  log("Trust as read from Base");
  for (const [name, subject] of [["New Shop", newShop], ["Trusted Coffee", coffee], ["Agent", agent.address]] as const) console.log(name, await buyerSdk.getTrust(subject));
  console.log("Buyer balance", await buyerSdk.getBalance(), "base units");
  if (preview) return console.log("PREVIEW: nothing was sent.");

  const portaldotRecord = async (rail: string, action: string, hash: Hex) => {
    const receipt = await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 });
    recordTx(rail, action, receipt, "paid by relayer");
  };

  const fundFromBase = async (amount: bigint, ref: string) => {
    const account = baseWallet(buyer);
    const usdcAbi = parseAbi(["function mint(uint256 amount)", "function approve(address spender, uint256 amount) returns (bool)"]);
    const lockAbi = parseAbi(["function lock(address portaldotRecipient, uint256 amount, bytes32 intentRef)"]);
    const start = await buyerSdk.getBalance();
    for (const [action, to, data] of [
      ["mint mUSDC", usdc, encodeFunctionData({ abi: usdcAbi, functionName: "mint", args: [amount] })],
      ["approve lockbox", usdc, encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [lockbox, amount] })],
      ["lock on Base", lockbox, encodeFunctionData({ abi: lockAbi, functionName: "lock", args: [buyer.address, amount, keccak256(toHex(ref))] })],
    ] as const) {
      const hash = await account.sendTransaction({ to, data });
      recordTx("bridge (Base Sepolia)", action, await base.waitForTransactionReceipt({ hash, timeout: 180_000 }), "test ETH");
    }
    await waitFor("the bridge credit", async () => (await buyerSdk.getBalance()) >= start + amount);
    console.log("Credited. Buyer balance", await buyerSdk.getBalance(), "base units");
  };

  if (flag("--fund")) return fundFromBase(12_000_000n, `demo-fund-${Date.now()}`);

  if (flag("--seed")) {
    log(`Building Trusted Coffee's history with ${SEED_PURCHASES} real purchases`);
    for (let i = 0; i < SEED_PURCHASES; i++) {
      const mandate = await buyerSdk.createMandate({ agent: agent.address, payees: [coffee], maxAmount: "1" });
      const { txHash, paymentId } = await agentSdk.payWithMandate(mandate, { payee: coffee, amount: "1" });
      await portaldotRecord("seed", `Trusted Coffee purchase ${paymentId}`, txHash);
    }
    return console.log("The relayer releases these after the hold, then writes feedback. Re-run without --seed afterwards.");
  }

  log("1. Fund from Base Sepolia");
  await fundFromBase(5_000_000n, `demo-trust-${Date.now()}`);

  log("2. The agent buys from New Shop under a mandate: funds are held");
  const first = await agentSdk.payWithMandate(await buyerSdk.createMandate({ agent: agent.address, payees: [newShop], maxAmount: "2" }), { payee: newShop, amount: "2" });
  await portaldotRecord("protect", "mandate purchase, New Shop", first.txHash);
  const id = BigInt(first.paymentId!);
  console.log(await buyerSdk.getPayment(id));

  log("3. Dispute, then the arbiter refunds in full");
  await portaldotRecord("protect", "dispute", await buyerSdk.dispute(id));
  const resolve = await portaldotWallet(arbiter).writeContract({ address: protect, abi: parseAbi(["function resolve(uint256 id, uint16 refundBps)"]), functionName: "resolve", args: [id, 10_000] });
  await portaldotRecord("protect", "arbiter resolve", resolve);

  log("4. The refund goes back to Base");
  const out = await buyerSdk.bridgeOut({ amount: "2", destChainId: BASE_CHAIN_ID, recipient: buyer.address });
  await portaldotRecord("bridge-out", "bridgeOut", out.txHash);
  const status = await waitFor("the release on Base", async () => {
    const current = await buyerSdk.getBridgeStatus(out.id);
    return current.status === "completed" ? current : null;
  });
  console.log("Released on Base:", status.destTx);

  log("5. The relayer writes negative feedback for New Shop");
  console.log(await waitFor("feedback for New Shop", async () => {
    const trust = await buyerSdk.getTrust(newShop);
    return trust.feedbackCount > 0 ? trust : null;
  }));

  log("6. The agent buys from Trusted Coffee");
  const second = await agentSdk.payWithMandate(await buyerSdk.createMandate({ agent: agent.address, payees: [coffee], maxAmount: "2" }), { payee: coffee, amount: "2" });
  await portaldotRecord("protect", "mandate purchase, Trusted Coffee", second.txHash);
  console.log(await buyerSdk.getPayment(BigInt(second.paymentId!)));
}

main().catch(fail);
