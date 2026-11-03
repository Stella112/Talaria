// Runs the real SDK against the real contracts on the local Hardhat chain.
import { expect } from "chai";
import http from "node:http";
import hre from "hardhat";
import { parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createTalaria, PriceTooHighError, RailBit, RailNotDeployedError, toRef } from "../../packages/sdk/src";

async function setup() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = (await hre.viem.getPublicClient()) as any;
  const token = await hre.viem.deployContract("TalariaUSD", [deployer.account.address]);
  const core = await hre.viem.deployContract("TalariaCore", [token.address, deployer.account.address]);
  const rails: Record<string, `0x${string}`> = {};
  for (const [key, name, id] of [["subscriptions", "TalariaSubscriptions", 2], ["streams", "TalariaStreams", 3], ["channels", "TalariaChannels", 4], ["remit", "TalariaRemit", 5]] as const) {
    const module = await hre.viem.deployContract(name, [core.address]);
    await core.write.setModule([id, module.address]);
    rails[key] = module.address;
  }
  const addresses = { token: token.address, core: core.address, ...rails };
  // The deployer stands in for the relayer: it pays gas for everyone else.
  const submitIntent = async ({ intent, v, r, s }: any) => {
    const hash = await core.write.execute([intent, v, r, s]);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  const user = async (funded = 100_000_000n) => {
    const account = privateKeyToAccount(generatePrivateKey());
    await deployer.sendTransaction({ to: account.address, value: parseEther("1") });
    await token.write.mint([account.address, funded]);
    return { account, sdk: createTalaria({ account, publicClient, addresses, submitIntent, walletClient: walletFor(account, publicClient) }) };
  };
  return { addresses, core, token, publicClient, submitIntent, user };
}

function walletFor(account: any, publicClient: any) {
  return {
    account,
    chain: publicClient.chain,
    sendTransaction: async (tx: any) => {
      const { createWalletClient, custom } = await import("viem");
      const wallet = createWalletClient({ account, chain: publicClient.chain, transport: custom(hre.network.provider) });
      return wallet.sendTransaction(tx);
    },
  } as any;
}

describe("SDK integration", () => {
  it("deposits by permit, checks out, refunds and lists receipts", async () => {
    const { user } = await setup();
    const payer = await user();
    const merchant = await user();
    await payer.sdk.deposit("50");
    expect(await payer.sdk.getBalance()).to.equal(50_000_000n);

    const { invoiceId } = await merchant.sdk.createCheckout({ amount: "12.5", currency: "USD", metadata: { order: 1 } });
    await payer.sdk.payInvoice(invoiceId);
    expect(await merchant.sdk.getBalance()).to.equal(12_500_000n);
    await merchant.sdk.refund(invoiceId, "2.5");
    expect(await payer.sdk.getBalance()).to.equal(40_000_000n);

    const receipts = await payer.sdk.getReceipts({ payer: payer.account.address });
    expect(receipts.length).to.equal(1);
    expect(receipts[0].amount).to.equal(12_500_000n);
    await payer.sdk.withdrawBalance("40");
    expect(await payer.sdk.getBalance()).to.equal(0n);
  });

  it("uses a session key within policy and queues beyond it", async () => {
    const { user, addresses, publicClient, submitIntent, core } = await setup();
    const owner = await user();
    const merchant = await user();
    await owner.sdk.deposit("50");
    const agent = privateKeyToAccount(generatePrivateKey());
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + 86400n * 365n;
    await owner.sdk.addSessionKey({ key: agent.address, maxPerTx: "5", maxPerDay: "8", expiry, rails: RailBit.checkout });
    const policy = await owner.sdk.getPolicy(agent.address);
    expect(policy.maxPerTx).to.equal(5_000_000n);
    expect(policy.maxPerDay).to.equal(8_000_000n);
    expect(policy.rails).to.equal(RailBit.checkout);

    const agentSdk = createTalaria({ account: agent, owner: owner.account.address, publicClient, addresses, submitIntent });
    const small = await merchant.sdk.createCheckout({ amount: "5", currency: "USD" });
    await agentSdk.payInvoice(small.invoiceId);
    expect(await merchant.sdk.getBalance()).to.equal(5_000_000n);

    const big = await merchant.sdk.createCheckout({ amount: "6", currency: "USD" });
    await agentSdk.payInvoice(big.invoiceId);
    expect(await merchant.sdk.getBalance()).to.equal(5_000_000n);
    expect((await core.getEvents.IntentQueued({}, { fromBlock: 0n })).length).to.equal(1);
  });

  it("runs subscription, stream and remit flows", async () => {
    const { user, addresses, publicClient } = await setup();
    const a = await user();
    const b = await user();
    await a.sdk.deposit("50");

    const { planId } = await b.sdk.createPlan({ amount: "1", interval: 3600, maxPeriods: 3 });
    const { subId } = await a.sdk.subscribe(planId);
    expect(subId).to.equal(1n);
    await a.sdk.cancel(subId);

    const { streamId } = await a.sdk.startStream({ to: b.account.address, ratePerMonth: "2592", deposit: "10" });
    expect(await publicClient.readContract({ address: addresses.streams, abi: (await hre.artifacts.readArtifact("TalariaStreams")).abi, functionName: "streamCount" })).to.equal(1n);
    await a.sdk.stopStream(streamId);

    const direct = await a.sdk.sendRemit({ to: b.account.address, amount: "3" });
    await b.sdk.claimRemit(direct.remitId);
    const link = await a.sdk.sendRemit({ amount: "3" });
    expect(link.claimCode).to.match(/^0x[0-9a-f]{64}$/);
    await a.sdk.cancelRemit(link.remitId);
    expect(await b.sdk.getBalance()).to.be.greaterThanOrEqual(3_000_000n);
  });

  it("pays a 402 API with vouchers end to end, then settles once", async () => {
    const { user, addresses, publicClient } = await setup();
    const agent = await user();
    const provider = await user();
    await agent.sdk.deposit("10");

    const accepted: any[] = [];
    const gate = provider.sdk.paywall({ price: "0.01", provider: provider.account.address, onVoucher: (v) => void accepted.push(v) });
    const server = http.createServer(async (req, res) => {
      const result = await gate.check(req.headers["x-talaria-voucher"]);
      res.setHeader("content-type", "application/json");
      if (!result.paid) {
        res.statusCode = 402;
        res.end(JSON.stringify(result.body));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((done) => server.listen(0, done));
    const url = `http://127.0.0.1:${(server.address() as any).port}/data`;

    try {
      const unpaid = await fetch(url);
      expect(unpaid.status).to.equal(402);
      for (let i = 0; i < 10; i++) {
        const response = await agent.sdk.fetch(url, { maxPrice: "0.02", channelDeposit: "1" });
        expect(response.status).to.equal(200);
      }
      expect(accepted.length).to.equal(10);
      expect(accepted[9].cumulativeAmount).to.equal(100_000n);

      // A replayed voucher must not buy another call.
      const replay = await fetch(url, { headers: { "x-talaria-voucher": JSON.stringify(accepted[9], (_, v) => (typeof v === "bigint" ? v.toString() : v)) } });
      expect(replay.status).to.equal(402);

      let refused = false;
      try {
        await agent.sdk.fetch(url, { maxPrice: "0.001" });
      } catch (error) {
        refused = error instanceof PriceTooHighError;
      }
      expect(refused).to.equal(true);

      const channels = await hre.viem.getContractAt("TalariaChannels", addresses.channels as any);
      await channels.write.redeem([accepted[9]]);
      expect(await provider.sdk.getBalance()).to.equal(100_000n);
    } finally {
      server.close();
    }
    void publicClient;
  });

  it("reports rails with no deployed contract instead of faking them", async () => {
    const { addresses, publicClient } = await setup();
    const account = privateKeyToAccount(generatePrivateKey());
    const sdk = createTalaria({ account, publicClient, addresses: { token: addresses.token, core: addresses.core, channels: undefined } });
    let caught: unknown;
    try {
      await sdk.openChannel({ provider: account.address, deposit: "1" });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(RailNotDeployedError);
    void toRef;
  });
});
