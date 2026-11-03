import { expect } from "chai";
import hre from "hardhat";
import { deployCore, HOUR, now, revertsWith, signIntent } from "./helpers";

const BASE = 84532n;
const ref = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const START = 500_000_000n;

async function setup() {
  const ctx = await deployCore();
  const out = await hre.viem.deployContract("TalariaBridgeOut", [ctx.core.address, ctx.owner.account.address]);
  await ctx.core.write.setModule([7, out.address]);
  await out.write.setDest([BASE, true]);
  const asAlice = await ctx.as("TalariaBridgeOut", out.address, ctx.alice);
  const coreAsAlice = await ctx.as("TalariaCore", ctx.core.address, ctx.alice);
  const asRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
  return { ...ctx, out, asAlice, coreAsAlice, asRelayer };
}

describe("TalariaBridgeOut", () => {
  it("takes the balance, emits a unique id and locks the funds for good", async () => {
    const { core, out, alice, carol, asAlice } = await setup();
    await asAlice.write.bridgeOut([100n, BASE, carol.account.address]);
    await asAlice.write.bridgeOut([100n, BASE, carol.account.address]);
    expect(await core.read.balances([alice.account.address])).to.equal(START - 200n);
    expect(await core.read.balances([out.address])).to.equal(200n);
    const events = await out.getEvents.BridgeOut({}, { fromBlock: 0n });
    expect(events.length).to.equal(2);
    expect(events[0].args.id).to.not.equal(events[1].args.id);
    expect(events[0].args.nonce).to.equal(0n);
    expect(events[0].args.recipient?.toLowerCase()).to.equal(carol.account.address);
  });

  it("rejects unknown chains, zero amounts, overdrafts and non-owner admin", async () => {
    const { carol, asAlice } = await setup();
    await revertsWith(asAlice.write.bridgeOut([1n, 1n, carol.account.address]), "InvalidParams");
    await revertsWith(asAlice.write.bridgeOut([0n, BASE, carol.account.address]), "InvalidParams");
    await revertsWith(asAlice.write.bridgeOut([START + 1n, BASE, carol.account.address]), "InsufficientBalance");
    await revertsWith(asAlice.write.setDest([1n, true]), "NotAuthorized");
  });

  it("works gaslessly by owner intent", async () => {
    const { core, alice, carol, asRelayer } = await setup();
    const a = alice.account.address;
    await asRelayer.write.execute(await signIntent(core, alice, { rail: 7, owner: a, signer: a, payee: carol.account.address, amount: 5n, ref: ref(BASE), nonce: 0n }));
    expect(await core.read.balances([a])).to.equal(START - 5n);
  });

  it("stops session keys unless the bridge rail is allowed", async () => {
    const { core, alice, carol, relayer, coreAsAlice, asRelayer } = await setup();
    const a = alice.account.address;
    const k = relayer.account.address; // any distinct key
    const zero = "0x0000000000000000000000000000000000000000";
    const expiry = (await now()) + HOUR;
    await coreAsAlice.write.addSessionKey([k, 100n, 100n, expiry, 2, zero]); // checkout only
    await asRelayer.write.execute(await signIntent(core, relayer, { rail: 7, owner: a, signer: k, payee: carol.account.address, amount: 5n, ref: ref(BASE), nonce: 0n }));
    expect(await core.read.balances([a])).to.equal(START); // queued, not paid
    expect((await core.getEvents.IntentQueued({}, { fromBlock: 0n })).length).to.equal(1);
    await coreAsAlice.write.addSessionKey([k, 100n, 100n, expiry, 128, zero]); // rail 7 allowed
    await asRelayer.write.execute(await signIntent(core, relayer, { rail: 7, owner: a, signer: k, payee: carol.account.address, amount: 5n, ref: ref(BASE), nonce: 1n }));
    expect(await core.read.balances([a])).to.equal(START - 5n);
  });
});

describe("TalariaLockboxV2", () => {
  const ID = ref(1n);

  async function box() {
    const [owner, relayer, payer, recipient] = await hre.viem.getWalletClients();
    const usdc = await hre.viem.deployContract("MockUSDC");
    const lockbox = await hre.viem.deployContract("TalariaLockboxV2", [usdc.address, owner.account.address, relayer.account.address]);
    const asPayer = await hre.viem.getContractAt("TalariaLockboxV2", lockbox.address, { client: { wallet: payer } });
    const asRelayer = await hre.viem.getContractAt("TalariaLockboxV2", lockbox.address, { client: { wallet: relayer } });
    const usdcAsPayer = await hre.viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: payer } });
    await usdcAsPayer.write.mint([1000n]);
    await usdcAsPayer.write.approve([lockbox.address, 1000n]);
    await asPayer.write.lock([recipient.account.address, 600n, ID]);
    return { usdc, lockbox, asPayer, asRelayer, recipient };
  }

  it("releases once per id", async () => {
    const { usdc, asRelayer, recipient } = await box();
    await asRelayer.write.release([ID, recipient.account.address, 100n]);
    expect(await usdc.read.balanceOf([recipient.account.address])).to.equal(100n);
    await revertsWith(asRelayer.write.release([ID, recipient.account.address, 100n]), "AlreadyProcessed");
  });

  it("allows only the relayer or owner, and never more than is locked", async () => {
    const { lockbox, asPayer, asRelayer, recipient } = await box();
    await revertsWith(asPayer.write.release([ID, recipient.account.address, 1n]), "NotRelayer");
    await revertsWith(asRelayer.write.release([ID, recipient.account.address, 601n]), "InsufficientLocked");
    await lockbox.write.release([ID, recipient.account.address, 1n]);
    await revertsWith(asRelayer.write.setRelayer([recipient.account.address]), "OwnableUnauthorizedAccount");
  });
});
