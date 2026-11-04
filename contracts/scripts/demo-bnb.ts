// BNB testnet as a second source chain. Each step checks first, so a rerun repeats nothing that is done.
// Spends test BNB. --set-dest also costs about 3.86 tPOT, and --lock makes the relayer spend tPOT on a credit.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, keccak256, parseAbi, parseEther, toHex, type Abi, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { retryTransport } from "../../packages/sdk/src/chain";
import { addressOf, artifact, fail, flag, keyAccount, portaldot, portaldotWallet, preview, recordTx, root } from "./lib/env";

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const VPS_RELAYER = "0x3bA9789027CD303075438ec99ABaCBaCbd28eA08" as const;
const LOCK_AMOUNT = 2_000_000n;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const rpc = process.env.BNB_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com";
const transport = retryTransport(rpc);
const client = createPublicClient({ chain: bscTestnet, transport });
const walletOf = (account: ReturnType<typeof keyAccount>) => createWalletClient({ account, chain: bscTestnet, transport });
const FILE = "bnb-testnet.json";

async function main() {
  const deployer = keyAccount("DEPLOYER_PRIVATE_KEY");
  const agent = keyAccount("AGENT_SESSION_KEY");
  const buyer = keyAccount("DEMO_BUYER_KEY");
  const usdc = addressOf(FILE, "MockUSDC")!;
  const lockbox = addressOf(FILE, "TalariaLockboxV2")!;
  console.log(preview ? "PREVIEW: nothing is sent." : "LIVE");
  console.log("Deployer", formatEther(await client.getBalance({ address: deployer.address })), "tBNB");
  if (preview) return;

  if (flag("--topup")) {
    for (const [name, to, amount] of [["relayer", VPS_RELAYER, "0.02"], ["agent", agent.address, "0.01"]] as const) {
      if ((await client.getBalance({ address: to })) > 0n) { console.log(`${name} already has test BNB`); continue; }
      const hash = await walletOf(deployer).sendTransaction({ to, value: parseEther(amount) });
      recordTx("setup (BNB testnet)", `send ${amount} tBNB to ${name}`, await client.waitForTransactionReceipt({ hash, timeout: 180_000 }), "test BNB");
    }
  }

  if (flag("--register")) {
    const file = resolve(root, "deployments/identities-bnb.json");
    const done = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    if (done["Talaria Autopilot"]) console.log("Agent already registered", done["Talaria Autopilot"].agentId);
    else {
      const uri = `data:application/json,${encodeURIComponent(JSON.stringify({ name: "Talaria Autopilot", description: "Talaria demo agent, testnet only" }))}`;
      const abi = parseAbi(["function register(string agentURI) returns (uint256 agentId)"]);
      const { request, result } = await client.simulateContract({ account: agent, address: IDENTITY, abi, functionName: "register", args: [uri] });
      const hash = await walletOf(agent).writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error(`Registration failed in ${hash}`);
      recordTx("identity (BNB testnet)", "register Talaria Autopilot", receipt, "test BNB");
      done["Talaria Autopilot"] = { wallet: agent.address, agentId: result.toString(), registerTx: hash };
      writeFileSync(file, JSON.stringify(done, null, 2) + "\n");
      console.log("Agent id", result.toString());
    }
  }

  if (flag("--set-dest")) {
    const bridgeOut = addressOf("portaldot-testnet.json", "TalariaBridgeOut")!;
    const abi = artifact("TalariaBridgeOut").abi as Abi;
    if (await portaldot.readContract({ address: bridgeOut, abi, functionName: "allowedDest", args: [BigInt(bscTestnet.id)] })) console.log("BNB is already allowed");
    else {
      const hash = await portaldotWallet(deployer).sendTransaction({ to: bridgeOut, data: encodeFunctionData({ abi, functionName: "setDest", args: [BigInt(bscTestnet.id), true] }) });
      recordTx("setup", "setDest bnb-testnet", await portaldot.waitForTransactionReceipt({ hash, timeout: 180_000 }), "tPOT");
    }
  }

  if (flag("--lock")) {
    const usdcAbi = parseAbi(["function mint(uint256 amount)", "function approve(address spender, uint256 amount) returns (bool)"]);
    const lockAbi = parseAbi(["function lock(address portaldotRecipient, uint256 amount, bytes32 intentRef)"]);
    const steps = [
      ["mint mUSDC", usdc, encodeFunctionData({ abi: usdcAbi, functionName: "mint", args: [LOCK_AMOUNT] })],
      ["approve lockbox", usdc, encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [lockbox, LOCK_AMOUNT] })],
      ["lock on BNB", lockbox, encodeFunctionData({ abi: lockAbi, functionName: "lock", args: [buyer.address, LOCK_AMOUNT, keccak256(toHex(`demo-bnb-${Date.now()}`))] })],
    ] as const;
    // LOCK_TX picks up a lock already sent, to wait for its credit without locking again.
    let lockTx = (process.env.LOCK_TX ?? "0x") as Hex;
    for (const [action, to, data] of process.env.LOCK_TX ? [] : steps) {
      lockTx = await walletOf(deployer).sendTransaction({ to, data });
      recordTx("bridge (BNB testnet)", action, await client.waitForTransactionReceipt({ hash: lockTx, timeout: 180_000 }), "test BNB");
    }
    const core = addressOf("portaldot-testnet.json", "TalariaCore")!;
    const coreAbi = artifact("TalariaCore").abi as Abi;
    const creditAbi = parseAbi(["event BridgeCredited(address indexed user, uint256 amount, uint256 srcChainId, bytes32 indexed srcTxHash)"]);
    const from = await portaldot.getBlockNumber();
    for (const deadline = Date.now() + 300_000; ; await sleep(5_000)) {
      if (await portaldot.readContract({ address: core, abi: coreAbi, functionName: "bridgeProcessed", args: [lockTx] }).catch(() => false)) break;
      if (Date.now() > deadline) throw new Error(`No credit for ${lockTx} after 5 minutes`);
    }
    const logs = await portaldot.getLogs({ address: core, event: creditAbi[0], args: { srcTxHash: lockTx }, fromBlock: from - (process.env.LOCK_TX ? 300n : 5n) });
    if (!logs[0]) throw new Error(`Credited, but the event for ${lockTx} was not found`);
    const receipt = await portaldot.getTransactionReceipt({ hash: logs[0].transactionHash });
    recordTx("bridge", "credit from BNB testnet, sent by the VPS relayer", receipt, "tPOT");
    console.log("Credit", logs[0].transactionHash, "source chain", logs[0].args.srcChainId);
  }
}

main().catch(fail);
