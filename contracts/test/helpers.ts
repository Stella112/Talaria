import { expect } from "chai";
import hre from "hardhat";

export async function revertsWith(call: Promise<unknown>, name: string) {
  try {
    await call;
  } catch (error) {
    expect(String(error)).to.include(name);
    return;
  }
  expect.fail(`expected revert ${name}`);
}

export const HOUR = 3600n;
export const FUTURE = 2n ** 40n;

export async function increase(seconds: bigint) {
  await hre.network.provider.send("evm_increaseTime", [Number(seconds)]);
  await hre.network.provider.send("evm_mine");
}

export async function now() {
  const client = await hre.viem.getPublicClient();
  return (await client.getBlock()).timestamp;
}

/** Deploys tUSD and Core, then funds Alice and Bob's internal accounts with `funded` each. */
export async function deployCore(funded = 500_000_000n) {
  const [owner, alice, bob, carol, relayer] = await hre.viem.getWalletClients();
  const token = await hre.viem.deployContract("TalariaUSD", [owner.account.address]);
  const core = await hre.viem.deployContract("TalariaCore", [token.address, owner.account.address]);
  const as = async <T extends string>(name: T, address: `0x${string}`, wallet: any) =>
    hre.viem.getContractAt(name as any, address, { client: { wallet } }) as any;
  for (const user of [alice, bob]) {
    const t = await as("TalariaUSD", token.address, user);
    const c = await as("TalariaCore", core.address, user);
    await t.write.faucet();
    await t.write.approve([core.address, funded]);
    await c.write.deposit([funded]);
  }
  return { token, core, owner, alice, bob, carol, relayer, as };
}
