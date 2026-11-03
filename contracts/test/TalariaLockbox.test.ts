import { expect } from "chai";
import hre from "hardhat";
import { getAddress } from "viem";
import { revertsWith } from "./helpers";

const REF = `0x${"aa".repeat(32)}` as `0x${string}`;

async function setup() {
  const [owner, payer, recipient] = await hre.viem.getWalletClients();
  const usdc = await hre.viem.deployContract("MockUSDC");
  const box = await hre.viem.deployContract("TalariaLockbox", [usdc.address, owner.account.address]);
  const usdcAsPayer = await hre.viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: payer } });
  const boxAsPayer = await hre.viem.getContractAt("TalariaLockbox", box.address, { client: { wallet: payer } });
  await usdcAsPayer.write.mint([1000n]);
  await usdcAsPayer.write.approve([box.address, 1000n]);
  return { usdc, box, boxAsPayer, usdcAsPayer, owner, payer, recipient };
}

describe("MockUSDC", () => {
  it("is labelled as a test token and caps each mint", async () => {
    const { usdc, usdcAsPayer } = await setup();
    expect(await usdc.read.name()).to.equal("Mock USDC (test, no value)");
    expect(await usdc.read.decimals()).to.equal(6);
    await revertsWith(usdcAsPayer.write.mint([10_000_000_001n]), "MintTooLarge");
  });
});

describe("TalariaLockbox", () => {
  it("locks tokens and emits what the relayer needs", async () => {
    const { usdc, box, boxAsPayer, payer, recipient } = await setup();
    await boxAsPayer.write.lock([recipient.account.address, 600n, REF]);
    expect(await usdc.read.balanceOf([box.address])).to.equal(600n);
    const [event] = await box.getEvents.Locked({}, { fromBlock: 0n });
    expect(event.args.payer).to.equal(getAddress(payer.account.address));
    expect(event.args.portaldotRecipient).to.equal(getAddress(recipient.account.address));
    expect(event.args.amount).to.equal(600n);
    expect(event.args.intentRef).to.equal(REF);
  });

  it("rejects zero amounts, zero recipients and missing allowance", async () => {
    const { boxAsPayer, recipient } = await setup();
    await revertsWith(boxAsPayer.write.lock([recipient.account.address, 0n, REF]), "ZeroAmount");
    await revertsWith(boxAsPayer.write.lock(["0x0000000000000000000000000000000000000000", 1n, REF]), "ZeroAddress");
    await revertsWith(boxAsPayer.write.lock([recipient.account.address, 1001n, REF]), "ERC20InsufficientAllowance");
  });

  it("lets only the owner release", async () => {
    const { usdc, box, boxAsPayer, payer, recipient } = await setup();
    await boxAsPayer.write.lock([recipient.account.address, 600n, REF]);
    await revertsWith(boxAsPayer.write.release([payer.account.address, 1n, REF]), "OwnableUnauthorizedAccount");
    await box.write.release([payer.account.address, 600n, REF]);
    expect(await usdc.read.balanceOf([payer.account.address])).to.equal(1000n);
  });
});
