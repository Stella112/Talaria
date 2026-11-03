import { expect } from "chai";
import hre from "hardhat";
import { parseSignature } from "viem";
import { deployCore, FUTURE, revertsWith, signIntent } from "./helpers";

describe("TalariaCore accounts", () => {
  it("deposits and withdraws", async () => {
    const { token, core, alice, as } = await deployCore();
    expect(await core.read.balances([alice.account.address])).to.equal(500_000_000n);
    const c = await as("TalariaCore", core.address, alice);
    await c.write.withdraw([200_000_000n]);
    expect(await core.read.balances([alice.account.address])).to.equal(300_000_000n);
    expect(await token.read.balanceOf([alice.account.address])).to.equal(700_000_000n);
    await revertsWith(c.write.withdraw([300_000_001n]), "InsufficientBalance");
  });

  it("deposits through a permit submitted by a third party", async () => {
    const { token, core, carol, relayer, as } = await deployCore();
    const t = await as("TalariaUSD", token.address, carol);
    await t.write.faucet();
    const chainId = await (await hre.viem.getPublicClient()).getChainId();
    const sig = await carol.signTypedData({
      domain: { name: await token.read.name(), version: "1", chainId, verifyingContract: token.address },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: carol.account.address, spender: core.address, value: 10n, nonce: 0n, deadline: FUTURE },
    });
    const { r, s, v } = parseSignature(sig);
    const c = await as("TalariaCore", core.address, relayer);
    await c.write.depositWithPermit([carol.account.address, 10n, FUTURE, Number(v), r, s]);
    expect(await core.read.balances([carol.account.address])).to.equal(10n);
    expect(await core.read.balances([relayer.account.address])).to.equal(0n);
  });

  it("pays internally and emits a unique receipt", async () => {
    const { core, alice, bob, as } = await deployCore();
    const c = await as("TalariaCore", core.address, alice);
    const ref = `0x${"11".repeat(32)}`;
    await c.write.pay([bob.account.address, 5n, ref]);
    await c.write.pay([bob.account.address, 5n, ref]);
    const events = await core.getEvents.Receipt({}, { fromBlock: 0n });
    expect(events.length).to.equal(2);
    expect(events[0].args.receiptId).to.not.equal(events[1].args.receiptId);
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_010n);
  });
});

describe("TalariaCore intents", () => {
  async function setup() {
    const ctx = await deployCore();
    const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
    const base = {
      rail: 0,
      owner: ctx.alice.account.address,
      signer: ctx.alice.account.address,
      payee: ctx.bob.account.address,
      amount: 7n,
      nonce: 0n,
    };
    return { ...ctx, asRelayer, base };
  }

  it("executes an owner intent submitted by a relayer", async () => {
    const { core, alice, bob, asRelayer, base } = await setup();
    await asRelayer.write.execute(await signIntent(core, alice, base));
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_007n);
    expect(await core.read.nonces([alice.account.address])).to.equal(1n);
  });

  it("withdraws to the payee through an action", async () => {
    const { core, token, alice, carol, asRelayer, base } = await setup();
    await asRelayer.write.execute(await signIntent(core, alice, { ...base, rail: 0x10, payee: carol.account.address }));
    expect(await token.read.balanceOf([carol.account.address])).to.equal(7n);
  });

  it("rejects replay, wrong nonce, expiry and forged signatures", async () => {
    const { core, alice, bob, asRelayer, base } = await setup();
    const args = await signIntent(core, alice, base);
    await asRelayer.write.execute(args);
    await revertsWith(asRelayer.write.execute(args), "BadNonce");
    await revertsWith(asRelayer.write.execute(await signIntent(core, alice, { ...base, nonce: 5n })), "BadNonce");
    await revertsWith(asRelayer.write.execute(await signIntent(core, alice, { ...base, nonce: 1n, deadline: 1n })), "IntentExpired");
    await revertsWith(asRelayer.write.execute(await signIntent(core, bob, { ...base, nonce: 1n })), "BadSignature");
  });

  it("rejects a tampered amount", async () => {
    const { core, alice, asRelayer, base } = await setup();
    const [intent, v, r, s] = await signIntent(core, alice, base);
    await revertsWith(asRelayer.write.execute([{ ...intent, amount: 8n }, v, r, s]), "BadSignature");
  });

  it("rejects unknown rails", async () => {
    const { core, alice, asRelayer, base } = await setup();
    await revertsWith(asRelayer.write.execute(await signIntent(core, alice, { ...base, rail: 9 })), "UnknownRail");
  });
});
