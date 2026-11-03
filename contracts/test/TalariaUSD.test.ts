import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseSignature } from "viem";

const ONE_K = 1_000_000_000n;

async function deploy() {
  const [owner, alice, bob] = await hre.viem.getWalletClients();
  const token = await hre.viem.deployContract("TalariaUSD", [owner.account.address]);
  const asAlice = await hre.viem.getContractAt("TalariaUSD", token.address, { client: { wallet: alice } });
  return { token, asAlice, owner, alice, bob };
}

async function revertsWith(call: Promise<unknown>, name: string) {
  try {
    await call;
  } catch (error) {
    expect(String(error)).to.include(name);
    return;
  }
  expect.fail(`expected revert ${name}`);
}

describe("TalariaUSD", () => {
  it("is labelled as a 6-decimal test token", async () => {
    const { token } = await deploy();
    expect(await token.read.name()).to.equal("Talaria Test USD (no value)");
    expect(await token.read.symbol()).to.equal("tUSD");
    expect(await token.read.decimals()).to.equal(6);
  });

  it("lets only the owner mint", async () => {
    const { token, asAlice, owner, alice } = await deploy();
    await token.write.mint([alice.account.address, 5n]);
    expect(await token.read.balanceOf([alice.account.address])).to.equal(5n);
    await revertsWith(asAlice.write.mint([owner.account.address, 1n]), "OwnableUnauthorizedAccount");
  });

  it("requires two steps to transfer ownership", async () => {
    const { token, asAlice, owner, alice } = await deploy();
    await token.write.transferOwnership([alice.account.address]);
    expect(await token.read.owner()).to.equal(getAddress(owner.account.address));
    await asAlice.write.acceptOwnership();
    expect(await token.read.owner()).to.equal(getAddress(alice.account.address));
  });

  it("pays a fixed faucet amount and tracks it", async () => {
    const { token, asAlice, alice } = await deploy();
    await asAlice.write.faucet();
    expect(await token.read.balanceOf([alice.account.address])).to.equal(ONE_K);
    expect(await token.read.faucetMinted()).to.equal(ONE_K);
  });

  it("stops the faucet at the global cap", async () => {
    const { token, asAlice } = await deploy();
    const cap = await token.read.FAUCET_CAP();
    const slot = "0x" + (await findFaucetSlot(token.address)).toString(16);
    await hre.network.provider.send("hardhat_setStorageAt", [
      token.address,
      slot,
      "0x" + cap.toString(16).padStart(64, "0"),
    ]);
    await revertsWith(asAlice.write.faucet(), "FaucetCapReached");
  });

  it("accepts a permit so a third party can transfer without owner gas", async () => {
    const { token, asAlice, owner, alice, bob } = await deploy();
    await asAlice.write.faucet();
    const signature = await signPermit(token, alice, owner.account.address, ONE_K, 0n);
    const { r, s, v } = parseSignature(signature);
    const deadline = 2n ** 64n;
    await token.write.permit([alice.account.address, owner.account.address, ONE_K, deadline, Number(v), r, s]);
    await token.write.transferFrom([alice.account.address, bob.account.address, ONE_K]);
    expect(await token.read.balanceOf([bob.account.address])).to.equal(ONE_K);
    expect(await token.read.nonces([alice.account.address])).to.equal(1n);
    await revertsWith(
      token.write.permit([alice.account.address, owner.account.address, ONE_K, deadline, Number(v), r, s]),
      "ERC2612InvalidSigner",
    );
  });

  it("rejects an expired permit", async () => {
    const { token, owner, alice } = await deploy();
    const signature = await signPermit(token, alice, owner.account.address, 1n, 0n, 1n);
    const { r, s, v } = parseSignature(signature);
    await revertsWith(
      token.write.permit([alice.account.address, owner.account.address, 1n, 1n, Number(v), r, s]),
      "ERC2612ExpiredSignature",
    );
  });
});

async function findFaucetSlot(address: `0x${string}`) {
  // OpenZeppelin v5 ERC20 and Ownable use regular slots here; locate faucetMinted by its value.
  const [, alice] = await hre.viem.getWalletClients();
  const token = await hre.viem.getContractAt("TalariaUSD", address, { client: { wallet: alice } });
  await token.write.faucet();
  const target = "0x" + ONE_K.toString(16).padStart(64, "0");
  const client = await hre.viem.getPublicClient();
  const total = await token.read.totalSupply();
  for (let slot = 0n; slot < 32n; slot++) {
    const value = await client.getStorageAt({ address, slot: `0x${slot.toString(16)}` });
    // totalSupply holds the same value, so skip a slot that no longer tracks after a mint.
    if (value === target && slot > 2n && total === ONE_K) return slot;
  }
  throw new Error("faucetMinted slot not found");
}

async function signPermit(
  token: any,
  signer: any,
  spender: `0x${string}`,
  value: bigint,
  nonce: bigint,
  deadline: bigint = 2n ** 64n,
) {
  const chainId = await (await hre.viem.getPublicClient()).getChainId();
  return signer.signTypedData({
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
    message: { owner: signer.account.address, spender, value, nonce, deadline },
  });
}
