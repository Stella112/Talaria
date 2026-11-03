import { expect } from "chai";
import hre from "hardhat";
import { parseSignature } from "viem";
import { deployCore, FUTURE, HOUR, increase, now, revertsWith, signIntent } from "./helpers";

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

describe("TalariaCore session keys", () => {
  const RAIL_ACCOUNT_BIT = 1;

  async function setup(payee?: `0x${string}`, maxPerTx = 10n, maxPerDay = 15n) {
    const ctx = await deployCore();
    const asAlice = await ctx.as("TalariaCore", ctx.core.address, ctx.alice);
    const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
    const key = ctx.carol;
    const zero = "0x0000000000000000000000000000000000000000";
    await asAlice.write.addSessionKey([key.account.address, maxPerTx, maxPerDay, (await now()) + HOUR * 48n, RAIL_ACCOUNT_BIT, payee ?? zero]);
    const base = { rail: 0, owner: ctx.alice.account.address, signer: key.account.address, payee: ctx.bob.account.address, amount: 5n };
    const pending = () => ctx.core.getEvents.IntentQueued({}, { fromBlock: 0n });
    return { ...ctx, asAlice, asRelayer, key, base, pending };
  }

  it("pays within policy", async () => {
    const { core, bob, key, asRelayer, base, pending } = await setup();
    await asRelayer.write.execute(await signIntent(core, key, { ...base, nonce: 0n }));
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_005n);
    expect((await pending()).length).to.equal(0);
  });

  it("queues an intent over maxPerTx and moves no funds", async () => {
    const { core, bob, key, asRelayer, base, pending } = await setup();
    await asRelayer.write.execute(await signIntent(core, key, { ...base, amount: 11n, nonce: 0n }));
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_000n);
    expect((await pending()).length).to.equal(1);
  });

  it("queues over the daily cap and resets the next day", async () => {
    const { core, key, asRelayer, base, pending } = await setup();
    await asRelayer.write.execute(await signIntent(core, key, { ...base, amount: 10n, nonce: 0n }));
    await asRelayer.write.execute(await signIntent(core, key, { ...base, amount: 6n, nonce: 1n }));
    expect((await pending()).length).to.equal(1);
    await increase(HOUR * 25n);
    await asRelayer.write.execute(await signIntent(core, key, { ...base, amount: 6n, nonce: 2n }));
    expect((await pending()).length).to.equal(1);
  });

  it("queues a disallowed rail and a disallowed payee", async () => {
    const { core, key, carol, asRelayer, base, pending } = await setup(undefined);
    await asRelayer.write.execute(await signIntent(core, key, { ...base, rail: 1, nonce: 0n }));
    expect((await pending()).length).to.equal(1);
    const ctx2 = await setup(carol.account.address);
    await ctx2.asRelayer.write.execute(await signIntent(ctx2.core, ctx2.key, { ...ctx2.base, nonce: 0n }));
    expect((await ctx2.pending()).length).to.equal(1);
  });

  it("lets only the owner approve or reject, once", async () => {
    const { core, bob, key, asAlice, asRelayer, base, pending } = await setup();
    const args = await signIntent(core, key, { ...base, amount: 11n, nonce: 0n });
    await asRelayer.write.execute(args);
    await revertsWith(asRelayer.write.approvePending([args[0]]), "NotAuthorized");
    await asAlice.write.approvePending([args[0]]);
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_011n);
    await revertsWith(asAlice.write.approvePending([args[0]]), "NotPending");

    const second = await signIntent(core, key, { ...base, amount: 12n, nonce: 1n });
    await asRelayer.write.execute(second);
    const hash = (await pending())[1].args.intentHash!;
    await revertsWith(asRelayer.write.rejectPending([hash]), "NotAuthorized");
    await asAlice.write.rejectPending([hash]);
    await revertsWith(asAlice.write.approvePending([second[0]]), "NotPending");
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_011n);
  });

  it("rejects expired, revoked and unknown keys", async () => {
    const { core, key, bob, asAlice, asRelayer, base } = await setup();
    await revertsWith(asRelayer.write.execute(await signIntent(core, bob, { ...base, signer: bob.account.address, nonce: 0n })), "KeyInvalid");
    await asAlice.write.revokeSessionKey([key.account.address]);
    await revertsWith(asRelayer.write.execute(await signIntent(core, key, { ...base, nonce: 0n })), "KeyInvalid");
    const ctx2 = await setup();
    await increase(HOUR * 49n);
    await revertsWith(ctx2.asRelayer.write.execute(await signIntent(ctx2.core, ctx2.key, { ...ctx2.base, nonce: 0n })), "KeyInvalid");
  });

  it("does not let a session key manage keys", async () => {
    const { core, key, asRelayer, base } = await setup();
    await revertsWith(asRelayer.write.execute(await signIntent(core, key, { ...base, rail: 0x20, amount: 0n, nonce: 0n })), "NotAuthorized");
    await revertsWith(asRelayer.write.execute(await signIntent(core, key, { ...base, rail: 0x30, amount: 0n, nonce: 0n })), "NotAuthorized");
  });

  it("lets the owner add and revoke keys gaslessly", async () => {
    const { core, alice, carol, asRelayer } = await setup();
    const k = alice.account.address;
    const expiry = (await now()) + HOUR;
    const ref = `0x${((expiry << 168n) | (1n << 160n)).toString(16).padStart(64, "0")}` as `0x${string}`;
    const base = { rail: 0x20, owner: k, signer: k, payee: carol.account.address, amount: (3n << 64n) | 4n, ref };
    await asRelayer.write.execute(await signIntent(core, alice, { ...base, nonce: 0n }));
    const stored = await core.read.sessionKeys([k, carol.account.address]);
    expect(stored[0]).to.equal(3n);
    expect(stored[1]).to.equal(4n);
    expect(stored[4]).to.equal(Number(expiry));
    await asRelayer.write.execute(await signIntent(core, alice, { ...base, rail: 0x30, amount: 0n, nonce: 1n }));
    expect((await core.read.sessionKeys([k, carol.account.address]))[4]).to.equal(0);
  });
});
