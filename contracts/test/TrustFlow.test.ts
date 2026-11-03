// LOCAL: the demo money shot through the real SDK, relayer API, workers and contracts on a Hardhat
// chain. Only the Base registry read and the feedback write are stubbed, because ERC-8004 is not
// deployed on this local chain. The lockbox runs here too, standing in for Base Sepolia.
import { expect } from "chai";
import hre from "hardhat";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createTalaria } from "../../packages/sdk/src";
import { liveChain, liveSettlement } from "../../services/relayer/src/chain";
import { Db } from "../../services/relayer/src/db";
import { buildServer } from "../../services/relayer/src/server";
import { pollBridgeOut, pollOutcomes, runReleaseKeeper } from "../../services/relayer/src/settlement";
import { Store } from "../../services/relayer/src/store";
import { TrustService } from "../../services/relayer/src/trust";
import { deployCore, increase, now } from "./helpers";

const BASE = 84532;
const TUSD = (n: number) => BigInt(n) * 1_000_000n;
const TIERS = { holdTrusted: 0, holdEstablished: 600, holdNew: 1800, capTrusted: TUSD(100), capEstablished: TUSD(25), capNew: TUSD(5) };
const AGENT_NEW = 1n;
const NEW_SHOP = 2n;
const COFFEE = 3n;

describe("LOCAL trust-priced settlement, end to end", () => {
  it("runs the money shot", async () => {
    const ctx = await deployCore();
    const wallets = await hre.viem.getWalletClients();
    const arbiter = wallets[5];
    const publicClient = (await hre.viem.getPublicClient()) as any;
    const chainId = await publicClient.getChainId();
    const relayerWallet = ctx.relayer as any;
    const attester = privateKeyToAccount(generatePrivateKey());

    const protect = await hre.viem.deployContract("TalariaProtect", [ctx.core.address, ctx.token.address, arbiter.account.address, attester.address, TIERS]);
    const bridgeOut = await hre.viem.deployContract("TalariaBridgeOut", [ctx.core.address, ctx.owner.account.address]);
    const usdc = await hre.viem.deployContract("MockUSDC");
    const lockbox = await hre.viem.deployContract("TalariaLockboxV2", [usdc.address, ctx.owner.account.address, ctx.relayer.account.address]);
    await ctx.core.write.setModule([6, protect.address]);
    await ctx.core.write.setModule([7, bridgeOut.address]);
    await ctx.core.write.setRelayer([ctx.relayer.account.address]);
    await bridgeOut.write.setDest([BigInt(BASE), true]);

    // Fund the lockbox, as earlier locks would have, and the bridge reserve.
    await usdc.write.mint([TUSD(50)]);
    await usdc.write.approve([lockbox.address, TUSD(50)]);
    await lockbox.write.lock([ctx.owner.account.address, TUSD(50), `0x${"00".repeat(32)}`]);
    await ctx.token.write.mint([ctx.owner.account.address, TUSD(50)]);
    await ctx.token.write.approve([ctx.core.address, TUSD(50)]);
    await ctx.core.write.fundReserve([TUSD(50)]);

    const buyer = privateKeyToAccount(generatePrivateKey());
    const agent = privateKeyToAccount(generatePrivateKey());
    const newShop = privateKeyToAccount(generatePrivateKey());
    const coffee = privateKeyToAccount(generatePrivateKey());

    // A buyer holding no gas gets funds through the real credit path.
    const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
    await asRelayer.write.creditFromBridge([buyer.address, TUSD(20), BigInt(BASE), `0x${"11".repeat(32)}`]);

    const db = new Db();
    const store = new Store();
    db.linkIdentity(newShop.address, NEW_SHOP, newShop.address, "0x");
    db.linkIdentity(coffee.address, COFFEE, coffee.address, "0x");
    db.linkIdentity(agent.address, AGENT_NEW, agent.address, "0x");

    // STUB: reputation that would come from the registry on Base.
    const reputation: Record<string, readonly [bigint, bigint, number]> = {
      [NEW_SHOP.toString()]: [0n, 0n, 0],
      [COFFEE.toString()]: [5n, 100n, 0],
      [AGENT_NEW.toString()]: [0n, 0n, 0],
    };
    const base = { getBlockNumber: async () => 999n, readContract: async ({ args }: any) => reputation[args[0].toString()] } as any;
    const trust = new TrustService({ base, db, attester, settlementClient: wallets[7].account.address, protect: protect.address, portaldotChainId: chainId, srcChainId: BigInt(BASE) });

    const common = { portaldot: publicClient, wallet: relayerWallet, core: ctx.core.address, store, maxTxPerHour: 100, live: true };
    const chain = liveChain({ ...common, base: publicClient, srcChainId: BigInt(BASE) });
    const settlement = liveSettlement({ ...common, protect: protect.address, bridgeOut: bridgeOut.address, destinations: new Map([[BigInt(BASE), { client: publicClient, wallet: relayerWallet, lockbox: lockbox.address }]]) });

    const app = buildServer(chain, store, { db, trust, protect: settlement });
    const relayerUrl = await app.listen({ port: 0, host: "127.0.0.1" });
    const addresses = { token: ctx.token.address, core: ctx.core.address, protect: protect.address, bridgeOut: bridgeOut.address };
    const sdkFor = (account: any, extra = {}) => createTalaria({ account, publicClient, relayerUrl, addresses, ...extra });
    const buyerSdk = sdkFor(buyer);
    const agentSdk = sdkFor(agent);

    const written: { agentId: bigint; value: bigint; tag: string; uri: string }[] = [];
    const write = async (agentId: bigint, value: bigint, tag: string, uri: string) => {
      written.push({ agentId, value, tag, uri }); // STUB: would call giveFeedback on Base
      return `0x${"ee".repeat(32)}` as `0x${string}`;
    };
    const sync = async () => {
      for (let i = 0; i < 3; i++) await hre.network.provider.send("evm_mine");
    };

    try {
      expect((await buyerSdk.getTrust(newShop.address)).tier).to.equal("new");
      expect((await buyerSdk.getTrust(coffee.address)).tier).to.equal("trusted");

      // 1-2. The agent buys from New Shop under a mandate, and the funds are held.
      const newShopMandate = await buyerSdk.createMandate({ agent: agent.address, payees: [newShop.address], maxAmount: "10" });
      const first = await agentSdk.payWithMandate(newShopMandate, { payee: newShop.address, amount: "2" });
      const paymentId = BigInt(first.paymentId!);
      const held = await buyerSdk.getPayment(paymentId);
      expect(held.status).to.equal("held");
      expect(BigInt(held.releaseAt) - (await now())).to.be.closeTo(1800n, 5n);
      expect(await buyerSdk.getBalance(newShop.address)).to.equal(0n);

      // An untrusted agent cannot exceed its low cap, even though the mandate allows it.
      let capped = "";
      await agentSdk.payWithMandate(await buyerSdk.createMandate({ agent: agent.address, payees: [newShop.address], maxAmount: "10" }), { payee: newShop.address, amount: "6" }).catch((error: Error) => {
        capped = error.message;
      });
      expect(capped).to.include("Relayer 400");

      // 3. The buyer disputes gaslessly, and the arbiter refunds in full.
      await buyerSdk.dispute(paymentId);
      expect((await buyerSdk.getPayment(paymentId)).status).to.equal("disputed");
      await (await ctx.as("TalariaProtect", protect.address, arbiter)).write.resolve([paymentId, 10_000]);
      expect((await buyerSdk.getPayment(paymentId)).status).to.equal("resolved");
      expect(await buyerSdk.getBalance()).to.equal(TUSD(20));

      // 4. The refund goes back to Base through bridge-out.
      const { id } = await buyerSdk.bridgeOut({ amount: "2", destChainId: BASE, recipient: buyer.address });
      await sync();
      expect(await pollBridgeOut(settlement, db, 0n)).to.equal(1);
      expect(await usdc.read.balanceOf([buyer.address])).to.equal(TUSD(2));
      expect((await buyerSdk.getBridgeStatus(id)).status).to.equal("completed");
      expect(await pollBridgeOut(settlement, db, 0n)).to.equal(0);

      // 5. Negative feedback for New Shop.
      await pollOutcomes(settlement, db, 0n, write, chainId);
      expect(written).to.have.length(1);
      expect(written[0]).to.include({ agentId: NEW_SHOP, value: 0n, tag: "refunded" });

      // 6. The agent buys from Trusted Coffee: instant settlement and positive feedback.
      const coffeeMandate = await buyerSdk.createMandate({ agent: agent.address, payees: [coffee.address], maxAmount: "5" });
      const second = await agentSdk.payWithMandate(coffeeMandate, { payee: coffee.address, amount: "3" });
      expect((await buyerSdk.getPayment(BigInt(second.paymentId!))).status).to.equal("released");
      expect(await buyerSdk.getBalance(coffee.address)).to.equal(TUSD(3));
      const [applied] = await protect.getEvents.TrustApplied({ paymentId: BigInt(second.paymentId!) }, { fromBlock: 0n });
      expect(applied.args.score).to.equal(100);
      await sync();
      await pollOutcomes(settlement, db, 0n, write, chainId);
      expect(written.map((w) => [w.agentId, w.value])).to.deep.equal([
        [NEW_SHOP, 0n],
        [COFFEE, 100n],
        [AGENT_NEW, 100n],
      ]);
      expect(written[1].uri).to.include(`:payment:${second.paymentId}`);

      // A plain protected payment to New Shop is held, then the keeper releases it after the window.
      await buyerSdk.payProtected({ merchant: newShop.address, amount: "1" });
      const third = await protect.read.paymentCount();
      await sync();
      await pollOutcomes(settlement, db, 0n, write, chainId);
      await increase(1801n);
      expect(await runReleaseKeeper(settlement, db, Number(await now()))).to.equal(1);
      expect((await buyerSdk.getPayment(third)).status).to.equal("released");
      await sync();
      await pollOutcomes(settlement, db, 0n, write, chainId);
      expect(written.at(-1)).to.include({ agentId: NEW_SHOP, value: 100n, tag: "released" });
    } finally {
      await app.close();
    }
  });
});
