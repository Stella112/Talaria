import { expect } from "chai";
import hre from "hardhat";
import { parseSignature } from "viem";
import { deployCore, FUTURE, revertsWith } from "./helpers";

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
