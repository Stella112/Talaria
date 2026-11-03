import { decodeAddress, evmToAddress } from "@polkadot/util-crypto";
import { bytesToHex, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { accountIdToH160, h160ToAccountId, h160ToSs58, plancksToWei, ss58ToH160, weiToPlancks } from "../src/utils/address";

// Well-known Substrate dev account //Alice.
const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ALICE_PUBKEY = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const H160 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

describe("h160ToAccountId", () => {
  it("appends twelve 0xEE bytes", () => {
    expect(bytesToHex(h160ToAccountId(H160))).toBe(`${H160.toLowerCase()}${"ee".repeat(12)}`);
  });
  it("rejects malformed addresses", () => {
    expect(() => h160ToAccountId("0x1234")).toThrow();
  });
});

describe("h160ToSs58 / ss58ToH160", () => {
  it("round-trips an EVM address through SS58", () => {
    const ss58 = h160ToSs58(H160);
    expect(ss58.startsWith("5")).toBe(true);
    expect(ss58ToH160(ss58)).toBe(H160);
  });
  it("encodes exactly the EE-suffixed account", () => {
    expect(bytesToHex(decodeAddress(h160ToSs58(H160)))).toBe(`${H160.toLowerCase()}${"ee".repeat(12)}`);
  });
  it("is not the legacy Frontier conversion", () => {
    expect(h160ToSs58(H160)).not.toBe(evmToAddress(H160, 42));
  });
  it("hashes native accounts: last 20 bytes of keccak256(pubkey)", () => {
    expect(bytesToHex(decodeAddress(ALICE))).toBe(ALICE_PUBKEY);
    expect(ss58ToH160(ALICE).toLowerCase()).toBe(`0x${keccak256(ALICE_PUBKEY).slice(-40)}`);
  });
  it("matches the known revive address of //Alice", () => {
    expect(ss58ToH160(ALICE).toLowerCase()).toBe("0x9621dde636de098b43efb0fa9b61facfe328f99d");
  });
  it("rejects wrong-length accounts and bad checksums", () => {
    expect(() => accountIdToH160(new Uint8Array(20))).toThrow();
    expect(() => ss58ToH160(`${ALICE.slice(0, -1)}R`)).toThrow();
  });
});

describe("unit conversion", () => {
  it("converts 14-decimal planck to 18-decimal wei", () => {
    expect(plancksToWei(10n ** 14n)).toBe(10n ** 18n);
    expect(weiToPlancks(10n ** 18n)).toBe(10n ** 14n);
    expect(weiToPlancks(9_999n)).toBe(0n);
  });
});
