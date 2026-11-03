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

describe("TalariaCore checkout", () => {
  const META = `0x${"ab".repeat(32)}` as `0x${string}`;
  const idRef = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}` as `0x${string}`;

  async function setup() {
    const ctx = await deployCore();
    const merchant = await ctx.as("TalariaCore", ctx.core.address, ctx.bob);
    const payer = await ctx.as("TalariaCore", ctx.core.address, ctx.alice);
    const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
    await merchant.write.createInvoice([100n, META, Number((await now()) + HOUR)]);
    return { ...ctx, merchant, payer, asRelayer };
  }

  it("pays once and emits a receipt", async () => {
    const { core, alice, bob, payer } = await setup();
    await payer.write.payInvoice([1n]);
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_100n);
    expect(await core.read.balances([alice.account.address])).to.equal(499_999_900n);
    const [receipt] = await core.getEvents.Receipt({}, { fromBlock: 0n });
    expect(receipt.args.rail).to.equal(1);
    await revertsWith(payer.write.payInvoice([1n]), "InvoiceUnavailable");
  });

  it("rejects unknown and expired invoices", async () => {
    const { payer } = await setup();
    await revertsWith(payer.write.payInvoice([9n]), "InvoiceUnavailable");
    await increase(HOUR + 1n);
    await revertsWith(payer.write.payInvoice([1n]), "InvoiceUnavailable");
  });

  it("refunds partly and fully, never beyond the amount", async () => {
    const { core, alice, merchant, payer } = await setup();
    await revertsWith(merchant.write.refund([1n, 1n]), "RefundTooLarge");
    await payer.write.payInvoice([1n]);
    await revertsWith(payer.write.refund([1n, 1n]), "NotAuthorized");
    await merchant.write.refund([1n, 40n]);
    await merchant.write.refund([1n, 60n]);
    expect(await core.read.balances([alice.account.address])).to.equal(500_000_000n);
    await revertsWith(merchant.write.refund([1n, 1n]), "RefundTooLarge");
  });

  it("pays through an intent only when payee and amount match", async () => {
    const { core, alice, bob, asRelayer } = await setup();
    const a = alice.account.address;
    const base = { rail: 1, owner: a, signer: a, payee: bob.account.address, ref: idRef(1n) };
    await revertsWith(asRelayer.write.execute(await signIntent(core, alice, { ...base, amount: 1n, nonce: 0n })), "IntentMismatch");
    await revertsWith(asRelayer.write.execute(await signIntent(core, alice, { ...base, payee: a, amount: 100n, nonce: 0n })), "IntentMismatch");
    await asRelayer.write.execute(await signIntent(core, alice, { ...base, amount: 100n, nonce: 0n }));
    expect(await core.read.balances([bob.account.address])).to.equal(500_000_100n);
  });

  it("creates and refunds through intents", async () => {
    const { core, alice, bob, payer, asRelayer } = await setup();
    const b = bob.account.address;
    await asRelayer.write.execute(await signIntent(core, bob, { rail: 0x11, owner: b, signer: b, payee: b, amount: 5n, ref: META, nonce: 0n, deadline: (await now()) + HOUR }));
    expect(await core.read.invoiceCount()).to.equal(2n);
    await payer.write.payInvoice([2n]);
    await asRelayer.write.execute(await signIntent(core, bob, { rail: 0x21, owner: b, signer: b, payee: alice.account.address, amount: 5n, ref: idRef(2n), nonce: 1n }));
    expect(await core.read.balances([alice.account.address])).to.equal(500_000_000n);
  });
});

describe("TalariaCore bridge credit", () => {
  const TX = `0x${"cd".repeat(32)}` as `0x${string}`;

  async function setup() {
    const ctx = await deployCore();
    await ctx.token.write.mint([ctx.owner.account.address, 1000n]);
    await ctx.token.write.approve([ctx.core.address, 1000n]);
    await ctx.core.write.fundReserve([1000n]);
    await ctx.core.write.setRelayer([ctx.relayer.account.address]);
    const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
    return { ...ctx, asRelayer };
  }

  it("credits from the reserve and blocks replay", async () => {
    const { core, carol, asRelayer } = await setup();
    await asRelayer.write.creditFromBridge([carol.account.address, 300n, 84532n, TX]);
    expect(await core.read.balances([carol.account.address])).to.equal(300n);
    expect(await core.read.bridgeReserve()).to.equal(700n);
    await revertsWith(asRelayer.write.creditFromBridge([carol.account.address, 300n, 84532n, TX]), "AlreadyProcessed");
  });

  it("limits credit to the relayer and the reserve", async () => {
    const { core, carol, asRelayer } = await setup();
    await revertsWith(core.write.creditFromBridge([carol.account.address, 1n, 84532n, TX]), "NotAuthorized");
    await revertsWith(asRelayer.write.creditFromBridge([carol.account.address, 1001n, 84532n, TX]), "ReserveTooLow");
  });

  it("limits admin functions and rail transfers", async () => {
    const { core, alice, bob, asRelayer } = await setup();
    await revertsWith(asRelayer.write.setRelayer([alice.account.address]), "NotAuthorized");
    await revertsWith(asRelayer.write.setModule([2, alice.account.address]), "NotAuthorized");
    await revertsWith(asRelayer.write.railTransfer([2, alice.account.address, bob.account.address, 1n, TX, true]), "NotAuthorized");
    expect(await core.read.balances([alice.account.address])).to.equal(500_000_000n);
  });
});

describe("TalariaCore reentrancy", () => {
  it("blocks a rail that re-enters Core during an intent", async () => {
    const ctx = await deployCore();
    const bad = await hre.viem.deployContract("ReentrantRail", [ctx.core.address]);
    await ctx.core.write.setModule([7, bad.address]);
    const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
    const a = ctx.alice.account.address;
    await revertsWith(asRelayer.write.execute(await signIntent(ctx.core, ctx.alice, { rail: 7, owner: a, signer: a, payee: a, amount: 1n, nonce: 0n })), "ReentrancyGuardReentrantCall");
  });
});
