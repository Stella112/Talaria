import { expect } from "chai";
import hre from "hardhat";
import { parseSignature, toFunctionSelector } from "viem";
import { deployCore, FUTURE, HOUR, increase, now, revertsWith, signIntent } from "./helpers";

const START = 500_000_000n;
const TEN_MIN = 600n;
const THIRTY_MIN = 1800n;
const AMOUNT = 1000n;
const ref = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const TIERS = { holdTrusted: 0, holdEstablished: 600, holdNew: 1800, capTrusted: 100_000_000n, capEstablished: 25_000_000n, capNew: 5_000_000n };

export async function deployProtect() {
  const ctx = await deployCore();
  const wallets = await hre.viem.getWalletClients();
  const [arbiter, attester, stranger] = [wallets[5], wallets[6], wallets[7]];
  const protect = await hre.viem.deployContract("TalariaProtect", [ctx.core.address, ctx.token.address, arbiter.account.address, attester.account.address, TIERS]);
  await ctx.core.write.setModule([6, protect.address]);
  const at = (wallet: any) => ctx.as("TalariaProtect", protect.address, wallet);
  const chainId = await (await hre.viem.getPublicClient()).getChainId();
  const bal = (who: any) => ctx.core.read.balances([who.account.address]);
  const asRelayer = await at(ctx.relayer);

  let nonce = 0n;
  const attest = async (subject: `0x${string}`, score: number, feedbackCount: number, over: Record<string, unknown> = {}, signer: any = attester) => {
    const message = { subject, agentId: 7n, score, feedbackCount, srcChainId: 84532n, srcBlock: 100n, expiry: FUTURE, nonce: nonce++, ...over };
    const signature = await signer.signTypedData({
      domain: { name: "TalariaProtect", version: "1", chainId, verifyingContract: protect.address },
      types: {
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
      },
      primaryType: "TrustAttestation",
      message,
    });
    const { r, s, v } = parseSignature(signature);
    return { attestation: message, sig: { v: Number(v), r, s } };
  };

  /** Alice pays Bob through payWithTrust. Each buyer intent uses the next nonce. */
  let buyerNonce = 0n;
  const payTrusted = async (att: Awaited<ReturnType<typeof attest>>, amount = AMOUNT) => {
    const a = ctx.alice.account.address;
    const [intent, v, r, s] = await signIntent(ctx.core, ctx.alice, { rail: 6, owner: a, signer: a, payee: ctx.bob.account.address, amount, nonce: buyerNonce++ });
    await asRelayer.write.payWithTrust([intent, { v, r, s }, att.attestation, att.sig]);
    return protect.read.paymentCount();
  };
  const coreAsRelayer = await ctx.as("TalariaCore", ctx.core.address, ctx.relayer);
  const payNoAttestation = async () => {
    const a = ctx.alice.account.address;
    await coreAsRelayer.write.execute(await signIntent(ctx.core, ctx.alice, { rail: 6, owner: a, signer: a, payee: ctx.bob.account.address, amount: AMOUNT, nonce: buyerNonce++ }));
    return protect.read.paymentCount();
  };
  return { ...ctx, protect, at, attest, payTrusted, payNoAttestation, arbiter, attester, stranger, bal, asRelayer, coreAsRelayer };
}

const held = async (protect: any, id: bigint) => BigInt((await protect.read.payments([id]))[4]) - (await now());

describe("TalariaProtect tiers", () => {
  const cases: [number, number, bigint, string][] = [
    [100, 3, 0n, "Trusted at 100"],
    [80, 3, 0n, "Trusted at the 80 boundary"],
    [79, 3, TEN_MIN, "Established at 79"],
    [50, 3, TEN_MIN, "Established at the 50 boundary"],
    [49, 3, THIRTY_MIN, "New at 49"],
    [100, 2, THIRTY_MIN, "New with fewer than 3 feedbacks, even at 100"],
    [50, 2, THIRTY_MIN, "New with 2 feedbacks at 50"],
  ];
  for (const [score, count, hold, label] of cases) {
    it(label, async () => {
      const { protect, attest, payTrusted, bob, bal } = await deployProtect();
      const id = await payTrusted(await attest(bob.account.address, score, count));
      const payment = await protect.read.payments([id]);
      if (hold === 0n) {
        expect(payment[5]).to.equal(3);
        expect(await bal(bob)).to.equal(START + AMOUNT);
      } else {
        expect(payment[5]).to.equal(1);
        expect(await held(protect, id)).to.equal(hold);
        expect(await bal(bob)).to.equal(START);
      }
    });
  }

  it("falls back to the New tier with no attestation", async () => {
    const { protect, payNoAttestation, alice, bal } = await deployProtect();
    const id = await payNoAttestation();
    expect(await held(protect, id)).to.equal(THIRTY_MIN);
    expect(await bal(alice)).to.equal(START - AMOUNT);
    expect((await protect.getEvents.TrustApplied({}, { fromBlock: 0n })).length).to.equal(0);
  });

  it("emits TrustApplied with the source chain details", async () => {
    const { protect, attest, payTrusted, bob } = await deployProtect();
    const id = await payTrusted(await attest(bob.account.address, 86, 5));
    const [event] = await protect.getEvents.TrustApplied({}, { fromBlock: 0n });
    expect(event.args.paymentId).to.equal(id);
    expect(event.args.score).to.equal(86);
    expect(event.args.srcChainId).to.equal(84532n);
    expect(event.args.srcBlock).to.equal(100n);
  });

});

describe("TalariaProtect attestations", () => {
  it("rejects expired, wrong-signer, replayed and wrong-subject attestations", async () => {
    const { attest, payTrusted, bob, alice, stranger } = await deployProtect();
    const subject = bob.account.address;
    await revertsWith(payTrusted(await attest(subject, 90, 5, { expiry: (await now()) - 1n })), "BadAttestation");
    await revertsWith(payTrusted(await attest(subject, 90, 5, {}, stranger)), "BadAttestation");
    await revertsWith(payTrusted(await attest(alice.account.address, 90, 5)), "BadAttestation");
    await revertsWith(payTrusted(await attest(subject, 90, 5, { score: 99 }).then((a) => ({ ...a, attestation: { ...a.attestation, score: 50 } }))), "BadAttestation");
  });

  it("rejects a replayed attestation", async () => {
    const { attest, bob, alice, core, asRelayer } = await deployProtect();
    const att = await attest(bob.account.address, 90, 5);
    const a = alice.account.address;
    const pay = async (nonce: bigint) => {
      const [intent, v, r, s] = await signIntent(core, alice, { rail: 6, owner: a, signer: a, payee: bob.account.address, amount: AMOUNT, nonce });
      return asRelayer.write.payWithTrust([intent, { v, r, s }, att.attestation, att.sig]);
    };
    await pay(0n);
    await revertsWith(pay(1n), "BadAttestation");
  });

  it("rejects a non-payment intent", async () => {
    const { attest, bob, alice, core, asRelayer } = await deployProtect();
    const att = await attest(bob.account.address, 90, 5);
    const a = alice.account.address;
    const [intent, v, r, s] = await signIntent(core, alice, { rail: 0x16, owner: a, signer: a, payee: bob.account.address, amount: 0n, nonce: 0n });
    await revertsWith(asRelayer.write.payWithTrust([intent, { v, r, s }, att.attestation, att.sig]), "BadAttestation");
  });

  it("clears the attested hold when an intent is queued for its owner", async () => {
    const { attest, bob, alice, carol, core, at, protect, asRelayer, as, payNoAttestation } = await deployProtect();
    void at;
    const asAlice = await as("TalariaCore", core.address, alice);
    const zero = "0x0000000000000000000000000000000000000000";
    await asAlice.write.addSessionKey([carol.account.address, 1n, 1n, (await now()) + HOUR, 64, zero]);
    const att = await attest(bob.account.address, 90, 5);
    const [intent, v, r, s] = await signIntent(core, carol, { rail: 6, owner: alice.account.address, signer: carol.account.address, payee: bob.account.address, amount: AMOUNT, nonce: 0n });
    await asRelayer.write.payWithTrust([intent, { v, r, s }, att.attestation, att.sig]);
    expect(await protect.read.paymentCount()).to.equal(0n);
    expect((await core.getEvents.IntentQueued({}, { fromBlock: 0n })).length).to.equal(1);
    const id = await payNoAttestation();
    expect(await held(protect, id)).to.equal(THIRTY_MIN); // not the trusted hold from the attestation
  });
});

describe("TalariaProtect release and disputes", () => {
  async function heldPayment() {
    const ctx = await deployProtect();
    const id = await ctx.payNoAttestation();
    return { ...ctx, id, asAlice: await ctx.at(ctx.alice), asBob: await ctx.at(ctx.bob), asArbiter: await ctx.at(ctx.arbiter), asStranger: await ctx.at(ctx.stranger) };
  }

  it("releases only after the window, and only once", async () => {
    const { id, asStranger, bob, bal } = await heldPayment();
    await revertsWith(asStranger.write.release([id]), "WindowOpen");
    await increase(THIRTY_MIN);
    await asStranger.write.release([id]);
    expect(await bal(bob)).to.equal(START + AMOUNT);
    await revertsWith(asStranger.write.release([id]), "NotHeld");
  });

  it("allows a dispute only by the buyer and only during the hold", async () => {
    const { id, asAlice, asBob } = await heldPayment();
    await revertsWith(asBob.write.dispute([id, ref(1n)]), "NotAuthorized");
    await increase(THIRTY_MIN);
    await revertsWith(asAlice.write.dispute([id, ref(1n)]), "WindowClosed");
  });

  it("freezes a disputed payment against release and refund", async () => {
    const { id, asAlice, asBob, asStranger } = await heldPayment();
    await asAlice.write.dispute([id, ref(1n)]);
    await increase(THIRTY_MIN);
    await revertsWith(asStranger.write.release([id]), "NotHeld");
    await revertsWith(asBob.write.refund([id, 1n]), "NotHeld");
    await revertsWith(asAlice.write.dispute([id, ref(1n)]), "NotHeld");
  });

  it("does not allow disputing an instantly settled payment", async () => {
    const { attest, payTrusted, bob, at, alice } = await deployProtect();
    const id = await payTrusted(await attest(bob.account.address, 90, 5));
    await revertsWith((await at(alice)).write.dispute([id, ref(1n)]), "NotHeld");
  });

  it("lets only the arbiter resolve, with exact split math", async () => {
    const { id, asAlice, asArbiter, asStranger, alice, bob, bal, protect } = await heldPayment();
    await revertsWith(asArbiter.write.resolve([id, 2500]), "NotHeld");
    await asAlice.write.dispute([id, ref(1n)]);
    await revertsWith(asStranger.write.resolve([id, 2500]), "NotAuthorized");
    await revertsWith(asArbiter.write.resolve([id, 10_001]), "InvalidParams");
    await asArbiter.write.resolve([id, 2500]);
    expect(await bal(alice)).to.equal(START - AMOUNT + 250n);
    expect(await bal(bob)).to.equal(START + 750n);
    expect((await protect.read.payments([id]))[5]).to.equal(5);
    await revertsWith(asArbiter.write.resolve([id, 0]), "NotHeld");
  });

  it("handles full refund and full payout resolutions, and rounds in the merchant's favour", async () => {
    for (const [bps, buyer, merchant] of [[10_000, AMOUNT, 0n], [0, 0n, AMOUNT], [3333, 333n, 667n]] as const) {
      const { id, asAlice, asArbiter, alice, bob, bal } = await heldPayment();
      await asAlice.write.dispute([id, ref(1n)]);
      await asArbiter.write.resolve([id, bps]);
      expect(await bal(alice)).to.equal(START - AMOUNT + buyer);
      expect(await bal(bob)).to.equal(START + merchant);
    }
  });

  it("disputes and refunds gaslessly by intent", async () => {
    const { id, core, alice, bob, coreAsRelayer, protect, bal } = await heldPayment();
    const a = alice.account.address;
    const b = bob.account.address;
    await coreAsRelayer.write.execute(await signIntent(core, alice, { rail: 0x16, owner: a, signer: a, payee: b, amount: 0n, ref: ref(id), nonce: 1n }));
    expect((await protect.read.payments([id]))[5]).to.equal(2);
    await coreAsRelayer.write.execute(await signIntent(core, alice, { rail: 6, owner: a, signer: a, payee: b, amount: AMOUNT, nonce: 2n }));
    const next = await protect.read.paymentCount();
    await revertsWith(coreAsRelayer.write.execute(await signIntent(core, bob, { rail: 0x26, owner: b, signer: b, payee: b, amount: 1n, ref: ref(next), nonce: 0n })), "InvalidParams");
    await coreAsRelayer.write.execute(await signIntent(core, bob, { rail: 0x26, owner: b, signer: b, payee: a, amount: 10n, ref: ref(next), nonce: 0n }));
    expect(await bal(alice)).to.equal(START - 2n * AMOUNT + 10n);
  });
});

describe("TalariaProtect refunds", () => {
  async function ready(hold: "held" | "released") {
    const ctx = await deployProtect();
    const id = hold === "held" ? await ctx.payNoAttestation() : await ctx.payTrusted(await ctx.attest(ctx.bob.account.address, 90, 5));
    return { ...ctx, id, asBob: await ctx.at(ctx.bob), asAlice: await ctx.at(ctx.alice), asStranger: await ctx.at(ctx.stranger) };
  }

  it("reduces a held payment, then releases only the rest", async () => {
    const { id, asBob, asStranger, alice, bob, bal } = await ready("held");
    await asBob.write.refund([id, 400n]);
    expect(await bal(alice)).to.equal(START - 600n);
    await increase(THIRTY_MIN);
    await asStranger.write.release([id]);
    expect(await bal(bob)).to.equal(START + 600n);
  });

  it("pulls from the merchant's balance after release", async () => {
    const { id, asBob, alice, bob, bal, protect } = await ready("released");
    await asBob.write.refund([id, 400n]);
    expect(await bal(alice)).to.equal(START - 600n);
    expect(await bal(bob)).to.equal(START + 600n);
    await asBob.write.refund([id, 600n]);
    expect(await bal(alice)).to.equal(START);
    expect((await protect.read.payments([id]))[5]).to.equal(4);
  });

  it("rejects refunds that are too large, zero, or from anyone else", async () => {
    const { id, asBob, asAlice } = await ready("released");
    await revertsWith(asAlice.write.refund([id, 1n]), "NotAuthorized");
    await revertsWith(asBob.write.refund([id, AMOUNT + 1n]), "RefundTooLarge");
    await revertsWith(asBob.write.refund([id, 0n]), "RefundTooLarge");
    await asBob.write.refund([id, AMOUNT]);
    await revertsWith(asBob.write.refund([id, 1n]), "NotHeld");
  });

  it("stops a full refund of a held payment from being released", async () => {
    const { id, asBob, asStranger } = await ready("held");
    await asBob.write.refund([id, AMOUNT]);
    await increase(THIRTY_MIN);
    await revertsWith(asStranger.write.release([id]), "NotHeld");
  });

  it("blocks direct onIntent calls and rejects amounts above 48 bits", async () => {
    const { asAlice, alice, bob, attest, payTrusted } = await ready("held");
    // Hardhat cannot always name this error, so match its selector in the underlying message.
    let details = "";
    await asAlice.write.onIntent([0, alice.account.address, alice.account.address, bob.account.address, 1n, ref(1n)]).catch((error: any) => {
      details = String(error.details ?? error.message);
    });
    expect(details).to.include(toFunctionSelector("NotCore()"));
    await revertsWith(payTrusted(await attest(bob.account.address, 90, 5), 2n ** 48n), "InvalidParams");
  });
});
