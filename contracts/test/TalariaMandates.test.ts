import { expect } from "chai";
import hre from "hardhat";
import { encodeAbiParameters, keccak256, parseSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deployCore, FUTURE, increase, now, revertsWith, signIntent } from "./helpers";

const START = 500_000_000n;
const ZERO32 = `0x${"00".repeat(32)}` as `0x${string}`;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const TUSD = (n: number) => BigInt(n) * 1_000_000n;
const TIERS = { holdTrusted: 0, holdEstablished: 600, holdNew: 1800, capTrusted: TUSD(100), capEstablished: TUSD(25), capNew: TUSD(5) };
const NO_SIG = { v: 0, r: ZERO32, s: ZERO32 };

const TYPES = {
  Mandate: [
    { name: "owner", type: "address" },
    { name: "agent", type: "address" },
    { name: "payeesHash", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "minAmount", type: "uint256" },
    { name: "maxAmount", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "maxUses", type: "uint32" },
    { name: "checkoutHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
  PaymentAuth: [
    { name: "mandateHash", type: "bytes32" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "ref", type: "bytes32" },
    { name: "use", type: "uint32" },
  ],
  Checkout: [
    { name: "orderId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "token", type: "address" },
    { name: "payee", type: "address" },
    { name: "expiry", type: "uint256" },
  ],
  TrustAttestation: [
    { name: "subject", type: "address" },
    { name: "agentId", type: "uint256" },
    { name: "score", type: "uint8" },
    { name: "feedbackCount", type: "uint32" },
    { name: "srcChainId", type: "uint256" },
    { name: "srcBlock", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const payeesHash = (payees: string[]) => keccak256(encodeAbiParameters([{ type: "address[]" }], [payees as `0x${string}`[]]));

async function setup() {
  const ctx = await deployCore();
  const wallets = await hre.viem.getWalletClients();
  const attester = wallets[6];
  const protect: any = await hre.viem.deployContract("TalariaProtect", [ctx.core.address, ctx.token.address, wallets[5].account.address, attester.account.address, TIERS]);
  await ctx.core.write.setModule([6, protect.address]);
  const chainId = await (await hre.viem.getPublicClient()).getChainId();
  const domain = { name: "TalariaProtect", version: "1", chainId, verifyingContract: protect.address };
  const sign = async (wallet: any, primaryType: keyof typeof TYPES, message: Record<string, unknown>) => {
    const { r, s, v } = parseSignature(await wallet.signTypedData({ domain, types: { [primaryType]: TYPES[primaryType] }, primaryType, message }));
    return { v: Number(v), r, s };
  };
  const hashOf = (primaryType: keyof typeof TYPES, message: Record<string, any>) => {
    const fields = TYPES[primaryType];
    const typeString = `${primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
    const typeHash = keccak256(new TextEncoder().encode(typeString));
    return keccak256(encodeAbiParameters([{ type: "bytes32" }, ...fields] as any, [typeHash, ...fields.map((f) => message[f.name])] as any));
  };
  const agent = privateKeyToAccount(generatePrivateKey());
  const relayer = await ctx.as("TalariaProtect", protect.address, ctx.relayer);
  let attNonce = 0n;
  let mandateNonce = 0n;

  const attest = async (subject: string, score: number, count: number, signer: any = attester) => {
    const attestation = { subject, agentId: 1n, score, feedbackCount: count, srcChainId: 84532n, srcBlock: 1n, expiry: FUTURE, nonce: attNonce++ };
    return { attestation, sig: await sign(signer, "TrustAttestation", attestation) };
  };
  const NO_TRUST = { attestation: { subject: ZERO_ADDR, agentId: 0n, score: 0, feedbackCount: 0, srcChainId: 0n, srcBlock: 0n, expiry: 0n, nonce: 0n }, sig: NO_SIG };
  const EMPTY_CHECKOUT = { orderId: ZERO32, amount: 0n, token: ZERO_ADDR, payee: ZERO_ADDR, expiry: 0n };

  const mandateFor = (over: Record<string, unknown> = {}) => ({
    owner: ctx.alice.account.address,
    agent: agent.address,
    payeesHash: payeesHash([ctx.bob.account.address]),
    token: ctx.token.address,
    minAmount: 1n,
    maxAmount: TUSD(100),
    expiry: FUTURE,
    maxUses: 2,
    checkoutHash: ZERO32,
    nonce: mandateNonce++,
    ...over,
  });

  /** Builds and submits a payment. `over` replaces any field of the call. */
  const pay = async (mandate: any, amount: bigint, over: Record<string, any> = {}, use = 0) => {
    const payee = over.payee ?? ctx.bob.account.address;
    const ref = over.ref ?? ZERO32;
    const mandateHash = hashOf("Mandate", mandate);
    const agentSig = await sign(over.agentWallet ?? agent, "PaymentAuth", { mandateHash, payee, amount, ref, use });
    const call = {
      mandate,
      mandateSig: await sign(over.ownerWallet ?? ctx.alice, "Mandate", mandate),
      payees: over.payees ?? [ctx.bob.account.address],
      payee,
      amount,
      ref,
      agentSig,
      checkout: over.checkout ?? EMPTY_CHECKOUT,
      checkoutSig: over.checkoutSig ?? NO_SIG,
      merchantTrust: over.merchantTrust ?? NO_TRUST,
      agentTrust: over.agentTrust ?? NO_TRUST,
    };
    return relayer.write.payWithMandate([call]);
  };
  const bal = (who: any) => ctx.core.read.balances([who.account.address]);
  return { ...ctx, protect, sign, hashOf, agent, relayer, attest, mandateFor, pay, bal, attester, domain };
}

describe("TalariaProtect mandates", () => {
  it("pays within an open mandate and holds for a new merchant", async () => {
    const { mandateFor, pay, protect, alice, bob, bal } = await setup();
    await pay(mandateFor(), TUSD(1));
    expect(await bal(alice)).to.equal(START - TUSD(1));
    expect(await bal(bob)).to.equal(START);
    const payment = await protect.read.payments([1n]);
    expect(payment[5]).to.equal(1);
    expect(BigInt(payment[4]) - (await now())).to.equal(1800n);
  });

  it("settles instantly for a trusted merchant and records the mandate", async () => {
    const { mandateFor, pay, attest, protect, bob, bal, hashOf } = await setup();
    const mandate = mandateFor();
    await pay(mandate, TUSD(1), { merchantTrust: await attest(bob.account.address, 90, 5) });
    expect(await bal(bob)).to.equal(START + TUSD(1));
    const [used] = await protect.getEvents.MandateUsed({}, { fromBlock: 0n });
    expect(used.args.mandateHash).to.equal(hashOf("Mandate", mandate));
    expect((await protect.getEvents.TrustApplied({}, { fromBlock: 0n })).length).to.equal(1);
  });

  it("rejects a wrong owner signature, agent signature, payee, amount range, token or expiry", async () => {
    const { mandateFor, pay, bob, carol, token, alice } = await setup();
    await revertsWith(pay(mandateFor(), TUSD(1), { ownerWallet: bob }), "BadMandate");
    const stranger = privateKeyToAccount(generatePrivateKey());
    await revertsWith(pay(mandateFor(), TUSD(1), { agentWallet: stranger }), "BadMandate");
    await revertsWith(pay(mandateFor(), TUSD(1), { payee: carol.account.address, payees: [carol.account.address] }), "BadMandate");
    await revertsWith(pay(mandateFor(), TUSD(1), { payee: carol.account.address }), "BadMandate");
    await revertsWith(pay(mandateFor({ minAmount: TUSD(2) }), TUSD(1)), "BadMandate");
    await revertsWith(pay(mandateFor({ token: alice.account.address }), TUSD(1)), "BadMandate");
    await revertsWith(pay(mandateFor({ expiry: (await now()) - 1n }), TUSD(1)), "BadMandate");
    void token;
  });

  it("allows any listed payee", async () => {
    const { mandateFor, pay, bob, carol, bal } = await setup();
    const list = [bob.account.address, carol.account.address];
    await pay(mandateFor({ payeesHash: payeesHash(list) }), TUSD(1), { payee: carol.account.address, payees: list, merchantTrust: undefined });
    expect(await bal(carol)).to.equal(0n); // held, so nothing has reached Carol yet
  });

  it("enforces max uses, and an agent signature cannot be replayed", async () => {
    const { mandateFor, pay } = await setup();
    const mandate = mandateFor();
    await pay(mandate, TUSD(1), {}, 0);
    await revertsWith(pay(mandate, TUSD(1), {}, 0), "BadMandate"); // same use number
    await pay(mandate, TUSD(1), {}, 1);
    await revertsWith(pay(mandate, TUSD(1), {}, 2), "BadMandate"); // over maxUses
  });

  it("stops after the owner revokes by intent, and nobody else can revoke it", async () => {
    const { mandateFor, pay, hashOf, core, as, alice, bob, bal } = await setup();
    const mandate = mandateFor();
    const hash = hashOf("Mandate", mandate);
    const relay = await as("TalariaCore", core.address, bob);
    const b = bob.account.address;
    await relay.write.execute(await signIntent(core, bob, { rail: 0x36, owner: b, signer: b, payee: b, amount: 0n, ref: hash, nonce: 0n }));
    await pay(mandate, TUSD(1)); // Bob's revoke does not touch Alice's mandate
    const a = alice.account.address;
    await relay.write.execute(await signIntent(core, alice, { rail: 0x36, owner: a, signer: a, payee: b, amount: 0n, ref: hash, nonce: 0n }));
    await revertsWith(pay(mandate, TUSD(1), {}, 1), "BadMandate");
    expect(await bal(alice)).to.equal(START - TUSD(1));
  });
});

describe("TalariaProtect closed mandates", () => {
  async function closed() {
    const ctx = await setup();
    const checkout = { orderId: `0x${"ab".repeat(32)}` as `0x${string}`, amount: TUSD(2), token: ctx.token.address, payee: ctx.bob.account.address, expiry: FUTURE };
    return { ...ctx, checkout, mandate: ctx.mandateFor({ checkoutHash: ctx.hashOf("Checkout", checkout) }), checkoutSig: await ctx.sign(ctx.bob, "Checkout", checkout) };
  }

  it("pays the exact merchant-signed cart", async () => {
    const { mandate, pay, checkout, checkoutSig, protect, hashOf } = await closed();
    await pay(mandate, TUSD(2), { checkout, checkoutSig });
    const [used] = await protect.getEvents.MandateUsed({}, { fromBlock: 0n });
    expect(used.args.checkoutHash).to.equal(hashOf("Checkout", checkout));
  });

  it("cannot be used for another cart, amount, signer or an expired checkout", async () => {
    const { mandate, pay, checkout, checkoutSig, carol, sign, hashOf, mandateFor } = await closed();
    await revertsWith(pay(mandate, TUSD(2)), "BadMandate");
    await revertsWith(pay(mandate, TUSD(1), { checkout, checkoutSig }), "BadMandate");
    const other = { ...checkout, orderId: `0x${"cd".repeat(32)}` as `0x${string}` };
    await revertsWith(pay(mandate, TUSD(2), { checkout: other, checkoutSig: await sign(carol, "Checkout", other) }), "BadMandate");
    await revertsWith(pay(mandate, TUSD(2), { checkout, checkoutSig: await sign(carol, "Checkout", checkout) }), "BadMandate");
    const expired = { ...checkout, expiry: (await now()) - 1n };
    const expiredSig = await sign(carol, "Checkout", expired);
    await revertsWith(pay(mandateFor({ checkoutHash: hashOf("Checkout", expired) }), TUSD(2), { checkout: expired, checkoutSig: expiredSig }), "BadMandate");
  });
});

describe("TalariaProtect trust-priced agent caps", () => {
  it("caps an agent with no attestation at the New tier", async () => {
    const { mandateFor, pay } = await setup();
    await revertsWith(pay(mandateFor(), TUSD(5) + 1n), "OverAgentCap");
    await pay(mandateFor(), TUSD(5));
  });

  it("raises the cap with the agent's own reputation", async () => {
    const { mandateFor, pay, attest, agent } = await setup();
    await revertsWith(pay(mandateFor(), TUSD(25) + 1n, { agentTrust: await attest(agent.address, 50, 3) }), "OverAgentCap");
    await pay(mandateFor(), TUSD(25), { agentTrust: await attest(agent.address, 50, 3) });
    await revertsWith(pay(mandateFor(), TUSD(100) + 1n, { agentTrust: await attest(agent.address, 80, 3) }), "OverAgentCap");
    await pay(mandateFor(), TUSD(100), { agentTrust: await attest(agent.address, 80, 3) });
  });

  it("treats fewer than 3 feedbacks as New, and uses the lower of the two caps", async () => {
    const { mandateFor, pay, attest, agent } = await setup();
    await revertsWith(pay(mandateFor(), TUSD(6), { agentTrust: await attest(agent.address, 100, 2) }), "OverAgentCap");
    await revertsWith(pay(mandateFor({ maxAmount: TUSD(10) }), TUSD(11), { agentTrust: await attest(agent.address, 90, 5) }), "OverAgentCap");
  });

  it("rejects another subject's or a forged attestation", async () => {
    const { mandateFor, pay, attest, agent, bob, carol } = await setup();
    await revertsWith(pay(mandateFor(), TUSD(1), { agentTrust: await attest(bob.account.address, 90, 5) }), "BadAttestation");
    await revertsWith(pay(mandateFor(), TUSD(1), { agentTrust: await attest(agent.address, 90, 5, carol) }), "BadAttestation");
    await revertsWith(pay(mandateFor(), TUSD(1), { merchantTrust: await attest(agent.address, 90, 5) }), "BadAttestation");
  });

  it("lets a mandate payment be disputed during its hold", async () => {
    const { mandateFor, pay, as, protect, alice } = await setup();
    await pay(mandateFor(), TUSD(1));
    await (await as("TalariaProtect", protect.address, alice)).write.dispute([1n, ZERO32]);
    expect((await protect.read.payments([1n]))[5]).to.equal(2);
    await increase(1800n);
  });
});
