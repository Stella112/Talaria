import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import { bytesToHex, getAddress, hexToBytes, keccak256, type Address, type Hex } from "viem";

/** SS58 prefix used by Portaldot (CLAUDE.md 5.1). */
export const SS58_PREFIX = 42;
/** 1 planck (14 decimals) = 10^4 wei (18 decimals). */
export const WEI_PER_PLANCK = 10_000n;

const EE_SUFFIX = new Uint8Array(12).fill(0xee);

function hasEeSuffix(account: Uint8Array): boolean {
  return account.slice(20).every((byte) => byte === 0xee);
}

/** AccountId32 of an unmapped EVM address: H160 ‖ 0xEE × 12. */
export function h160ToAccountId(h160: Address): Uint8Array {
  const account = new Uint8Array(32);
  account.set(hexToBytes(getAddress(h160)));
  account.set(EE_SUFFIX, 20);
  return account;
}

/** Native SS58 address that holds the balance of an EVM address. */
export function h160ToSs58(h160: Address, prefix: number = SS58_PREFIX): string {
  return encodeAddress(h160ToAccountId(h160), prefix);
}

/** H160 of an AccountId32: strips 0xEE × 12, otherwise the last 20 bytes of keccak256(account). */
export function accountIdToH160(account: Uint8Array): Address {
  if (account.length !== 32) throw new Error(`Expected 32-byte account, got ${account.length}`);
  if (hasEeSuffix(account)) return getAddress(bytesToHex(account.slice(0, 20)));
  const hash: Hex = keccak256(account);
  return getAddress(`0x${hash.slice(-40)}`);
}

/** H160 of an SS58 address. Native accounts must still call Revive.map_account() to use it. */
export function ss58ToH160(ss58: string): Address {
  return accountIdToH160(decodeAddress(ss58));
}

export function plancksToWei(plancks: bigint): bigint {
  return plancks * WEI_PER_PLANCK;
}

/** Truncates anything below one planck. */
export function weiToPlancks(wei: bigint): bigint {
  return wei / WEI_PER_PLANCK;
}
