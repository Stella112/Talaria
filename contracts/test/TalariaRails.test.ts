import { expect } from "chai";
import hre from "hardhat";
import { encodeAbiParameters, keccak256, parseSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deployCore, HOUR, increase, now, revertsWith, signIntent } from "./helpers";

const ref = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const START = 500_000_000n;

async function setup(name: string, rail: number) {
  const ctx = await deployCore();
  const module = await hre.viem.deployContract(name as any, [ctx.core.address]);
  await ctx.core.write.setModule([rail, module.address]);
  const alice = await ctx.as(name, module.address, ctx.alice);
  const bob = await ctx.as(name, module.address, ctx.bob);
  const carol = await ctx.as(name, module.address, ctx.carol);
  const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
  const bal = (who: any) => ctx.core.read.balances([who.account.address]);
  return { ...ctx, module: module as any, asAlice: alice, asBob: bob, asCarol: carol, asRelayer, bal };
}

describe("TalariaSubscriptions", () => {
  async function ready() {
    const ctx = await setup("TalariaSubscriptions", 2);
    await ctx.asBob.write.createPlan([100n, 3600, 2]); // Bob is the merchant
    await ctx.asAlice.write.subscribe([1]);
    return ctx;
  }

  it("charges when due, permissionlessly, and only then", async () => {
    const { asCarol, alice, bob, bal } = await ready();
    await asCarol.write.charge([1n]);
    expect(await bal(alice)).to.equal(START - 100n);
    expect(await bal(bob)).to.equal(START + 100n);
    await revertsWith(asCarol.write.charge([1n]), "Unavailable");
    await increase(HOUR);
    await asCarol.write.charge([1n]);
    expect(await bal(alice)).to.equal(START - 200n);
  });

  it("stops at maxPeriods", async () => {
    const { asCarol } = await ready();
    await asCarol.write.charge([1n]);
    await increase(HOUR);
    await asCarol.write.charge([1n]);
    await increase(HOUR);
    await revertsWith(asCarol.write.charge([1n]), "Unavailable");
  });

  it("pauses without back-billing, and cancels", async () => {
    const { asAlice, asBob, asCarol, alice, module, bal } = await ready();
    await revertsWith(asBob.write.setPaused([1n, true]), "NotAuthorized");
    await asAlice.write.setPaused([1n, true]);
    await revertsWith(asCarol.write.charge([1n]), "Unavailable");
    await increase(HOUR * 5n);
    await asAlice.write.setPaused([1n, false]);
    expect((await module.read.subscriptions([1n]))[2]).to.equal(Number(await now()));
    await revertsWith(asBob.write.cancel([1n]), "NotAuthorized");
    await asAlice.write.cancel([1n]);
    await revertsWith(asCarol.write.charge([1n]), "Unavailable");
    expect(await bal(alice)).to.equal(START);
  });

  it("subscribes through an intent only when terms match", async () => {
    const { core, alice, bob, asRelayer, module } = await ready();
    const a = alice.account.address;
    const base = { rail: 2, owner: a, signer: a, payee: bob.account.address, ref: ref(1n) };
    await revertsWith(asRelayer.write.execute(await signIntent(core, alice, { ...base, amount: 1n, nonce: 0n })), "InvalidParams");
    await asRelayer.write.execute(await signIntent(core, alice, { ...base, amount: 100n, nonce: 0n }));
    expect(await module.read.subscriptionCount()).to.equal(2);
  });

  it("rejects bad plans and direct onIntent calls", async () => {
    const { asBob, asAlice, alice, bob } = await ready();
    await revertsWith(asBob.write.createPlan([0n, 1, 1]), "InvalidParams");
    await revertsWith(asAlice.write.subscribe([9]), "Unavailable");
    await revertsWith(asAlice.write.onIntent([0, alice.account.address, alice.account.address, bob.account.address, 100n, ref(1n)]), "NotCore");
  });
});

describe("TalariaStreams", () => {
  async function ready() {
    const ctx = await setup("TalariaStreams", 3);
    await ctx.asAlice.write.startStream([ctx.bob.account.address, 10n, 100_000n]);
    return ctx;
  }

  it("escrows the deposit and lets the receiver withdraw accrual", async () => {
    const { asBob, alice, bob, bal, module } = await ready();
    expect(await bal(alice)).to.equal(START - 100_000n);
    await increase(100n);
    expect(await module.read.accrued([1n])).to.be.greaterThanOrEqual(1000n);
    await asBob.write.withdraw([1n]);
    expect(await bal(bob)).to.be.greaterThan(START + 999n);
    expect(await bal(bob)).to.be.lessThan(START + 1100n);
  });

  it("stops, pays what accrued and refunds the rest, conserving funds", async () => {
    const { asAlice, asBob, alice, bob, bal } = await ready();
    await increase(100n);
    await revertsWith(asBob.write.stopStream([1n]), "NotAuthorized");
    await asAlice.write.stopStream([1n]);
    expect((await bal(alice)) + (await bal(bob))).to.equal(START * 2n);
    expect(await bal(bob)).to.be.greaterThan(START + 999n);
    await revertsWith(asAlice.write.stopStream([1n]), "NotAuthorized");
  });

  it("caps accrual at the deposit and pays only once", async () => {
    const { asBob, bob, bal } = await ready();
    await increase(100_000n);
    await asBob.write.withdraw([1n]);
    expect(await bal(bob)).to.equal(START + 100_000n);
    await revertsWith(asBob.write.withdraw([1n]), "Unavailable");
  });

  it("restricts withdrawal to the receiver and validates input", async () => {
    const { asAlice, asCarol, bob } = await ready();
    await revertsWith(asCarol.write.withdraw([1n]), "NotAuthorized");
    await revertsWith(asAlice.write.startStream([bob.account.address, 0n, 1n]), "InvalidParams");
    await revertsWith(asAlice.write.startStream([bob.account.address, 1n, 2n ** 48n]), "InvalidParams");
  });

  it("starts through an intent", async () => {
    const { core, alice, bob, asRelayer, module } = await ready();
    const a = alice.account.address;
    await asRelayer.write.execute(await signIntent(core, alice, { rail: 3, owner: a, signer: a, payee: bob.account.address, amount: 50n, ref: ref(1n), nonce: 0n }));
    expect(await module.read.streamCount()).to.equal(2n);
  });
});

describe("TalariaChannels", () => {
  async function voucher(module: any, wallet: any, channelId: bigint, cumulativeAmount: bigint, nonce = 1n) {
    const chainId = await (await hre.viem.getPublicClient()).getChainId();
    const signature = await wallet.signTypedData({
      domain: { name: "TalariaChannels", version: "1", chainId, verifyingContract: module.address },
      types: {
        Voucher: [
          { name: "channelId", type: "uint256" },
          { name: "cumulativeAmount", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "Voucher",
      message: { channelId, cumulativeAmount, nonce },
    });
    const { r, s, v } = parseSignature(signature);
    return { channelId, cumulativeAmount, nonce, v: Number(v), r, s };
  }

  async function ready() {
    const ctx = await setup("TalariaChannels", 4);
    await ctx.asAlice.write.openChannel([ctx.bob.account.address, 1000n]);
    return ctx;
  }

  it("redeems the difference of cumulative vouchers", async () => {
    const { asCarol, module, alice, bob, bal } = await ready();
    await asCarol.write.redeem([await voucher(module, alice, 1n, 100n)]);
    expect(await bal(bob)).to.equal(START + 100n);
    await asCarol.write.redeem([await voucher(module, alice, 1n, 250n, 2n)]);
    expect(await bal(bob)).to.equal(START + 250n);
  });

  it("rejects non-increasing, over-deposit and foreign vouchers", async () => {
    const { asCarol, module, alice, bob } = await ready();
    await asCarol.write.redeem([await voucher(module, alice, 1n, 100n)]);
    await revertsWith(asCarol.write.redeem([await voucher(module, alice, 1n, 100n, 2n)]), "InvalidParams");
    await revertsWith(asCarol.write.redeem([await voucher(module, alice, 1n, 1001n)]), "InvalidParams");
    await revertsWith(asCarol.write.redeem([await voucher(module, bob, 1n, 200n)]), "NotAuthorized");
    await revertsWith(asCarol.write.redeem([await voucher(module, alice, 9n, 1n)]), "Unavailable");
  });

  it("batch redeems across channels and bounds the batch", async () => {
    const { asAlice, asCarol, module, alice, bob, bal } = await ready();
    await asAlice.write.openChannel([bob.account.address, 1000n]);
    await asCarol.write.redeemBatch([[await voucher(module, alice, 1n, 10n), await voucher(module, alice, 2n, 20n)]]);
    expect(await bal(bob)).to.equal(START + 30n);
    const v = await voucher(module, alice, 1n, 11n);
    await revertsWith(asCarol.write.redeemBatch([Array(51).fill(v)]), "InvalidParams");
  });

  it("closes only after the challenge window and refunds the unredeemed part", async () => {
    const { asAlice, asBob, asCarol, module, alice, bob, bal } = await ready();
    await revertsWith(asAlice.write.finishClose([1n]), "Unavailable");
    await revertsWith(asBob.write.requestClose([1n]), "NotAuthorized");
    await asAlice.write.requestClose([1n]);
    await revertsWith(asAlice.write.finishClose([1n]), "Unavailable");
    await asCarol.write.redeem([await voucher(module, alice, 1n, 400n)]); // provider can still redeem in the window
    await increase(HOUR + 1n);
    await asAlice.write.finishClose([1n]);
    expect(await bal(alice)).to.equal(START - 400n);
    expect(await bal(bob)).to.equal(START + 400n);
    await revertsWith(asCarol.write.redeem([await voucher(module, alice, 1n, 500n)]), "Unavailable");
  });

  it("lets a session key's vouchers settle a channel it opened by intent", async () => {
    const { core, asAlice, asCarol, asRelayer, module, alice, bob, carol, bal } = await ready();
    const zero = "0x0000000000000000000000000000000000000000";
    const coreAsAlice = await hre.viem.getContractAt("TalariaCore", core.address, { client: { wallet: alice } });
    await coreAsAlice.write.addSessionKey([carol.account.address, 100n, 100n, (await now()) + HOUR, 1 << 4, zero]);
    await asRelayer.write.execute(await signIntent(core, carol, { rail: 4, owner: alice.account.address, signer: carol.account.address, payee: bob.account.address, amount: 50n, nonce: 0n }));
    await asCarol.write.redeem([await voucher(module, carol, 2n, 50n)]);
    expect(await bal(bob)).to.equal(START + 50n);
    await revertsWith(asAlice.write.redeem([await voucher(module, alice, 2n, 50n)]), "NotAuthorized");
  });
});

describe("TalariaRemit", () => {
  const ttl = async () => Number((await now()) + HOUR);

  async function signClaim(module: any, code: `0x${string}`, id: bigint, receiver: `0x${string}`) {
    const chainId = await (await hre.viem.getPublicClient()).getChainId();
    const hash = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [BigInt(chainId), module.address, id, receiver],
      ),
    );
    return parseSignature(await privateKeyToAccount(code).sign({ hash }));
  }

  it("lets only the receiver claim an address remit", async () => {
    const ctx = await setup("TalariaRemit", 5);
    await ctx.asAlice.write.sendRemit([ctx.bob.account.address, false, 100n, true, await ttl()]);
    expect(await ctx.bal(ctx.alice)).to.equal(START - 100n);
    await revertsWith(ctx.asCarol.write.claimRemit([1n]), "NotAuthorized");
    await ctx.asBob.write.claimRemit([1n]);
    expect(await ctx.bal(ctx.bob)).to.equal(START + 100n);
    await revertsWith(ctx.asBob.write.claimRemit([1n]), "NotAuthorized");
    await revertsWith(ctx.asAlice.write.cancelRemit([1n]), "NotAuthorized");
  });

  it("claims a code remit for the signed receiver, submitted by anyone", async () => {
    const ctx = await setup("TalariaRemit", 5);
    const code = generatePrivateKey();
    await ctx.asAlice.write.sendRemit([privateKeyToAccount(code).address, true, 100n, true, await ttl()]);
    const carol = ctx.carol.account.address;
    const { r, s, v } = await signClaim(ctx.module, code, 1n, carol);
    // A watcher cannot redirect the signature to itself.
    await revertsWith(ctx.asBob.write.claimWithCode([1n, ctx.bob.account.address, Number(v), r, s]), "NotAuthorized");
    await ctx.asBob.write.claimWithCode([1n, carol, Number(v), r, s]);
    expect(await ctx.bal(ctx.carol)).to.equal(100n);
    expect(await ctx.bal(ctx.bob)).to.equal(START);
  });

  it("does not allow a direct claim of a code remit", async () => {
    const ctx = await setup("TalariaRemit", 5);
    await ctx.asAlice.write.sendRemit([ctx.bob.account.address, true, 100n, true, await ttl()]);
    await revertsWith(ctx.asBob.write.claimRemit([1n]), "NotAuthorized");
  });

  it("cancels until claimed, only if cancellable", async () => {
    const ctx = await setup("TalariaRemit", 5);
    await ctx.asAlice.write.sendRemit([ctx.bob.account.address, false, 100n, true, await ttl()]);
    await revertsWith(ctx.asBob.write.cancelRemit([1n]), "NotAuthorized");
    await ctx.asAlice.write.cancelRemit([1n]);
    expect(await ctx.bal(ctx.alice)).to.equal(START);
    await revertsWith(ctx.asBob.write.claimRemit([1n]), "NotAuthorized");
    await ctx.asAlice.write.sendRemit([ctx.bob.account.address, false, 100n, false, await ttl()]);
    await revertsWith(ctx.asAlice.write.cancelRemit([2n]), "Unavailable");
  });

  it("returns expired remits and blocks late claims", async () => {
    const ctx = await setup("TalariaRemit", 5);
    await ctx.asAlice.write.sendRemit([ctx.bob.account.address, false, 100n, false, await ttl()]);
    await revertsWith(ctx.asCarol.write.refundExpired([1n]), "Unavailable");
    await increase(HOUR + 1n);
    await revertsWith(ctx.asBob.write.claimRemit([1n]), "Unavailable");
    await ctx.asCarol.write.refundExpired([1n]);
    expect(await ctx.bal(ctx.alice)).to.equal(START);
    await revertsWith(ctx.asCarol.write.refundExpired([1n]), "Unavailable");
  });

  it("sends through an intent to an address and to a code", async () => {
    const ctx = await setup("TalariaRemit", 5);
    const a = ctx.alice.account.address;
    const zero = "0x0000000000000000000000000000000000000000";
    const codeAddr = privateKeyToAccount(generatePrivateKey()).address;
    await ctx.asRelayer.write.execute(await signIntent(ctx.core, ctx.alice, { rail: 5, owner: a, signer: a, payee: ctx.bob.account.address, amount: 5n, nonce: 0n }));
    await ctx.asRelayer.write.execute(await signIntent(ctx.core, ctx.alice, { rail: 5, owner: a, signer: a, payee: zero, amount: 5n, ref: ref(BigInt(codeAddr)), nonce: 1n }));
    expect((await ctx.module.read.remits([2n]))[4].toLowerCase()).to.equal(codeAddr.toLowerCase());
    expect((await ctx.module.read.remits([2n]))[5]).to.equal(true);
  });
});
