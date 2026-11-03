import type { Address, Hex, LocalAccount } from "viem";
import { parseSignature, parseUnits } from "viem";

export const TOKEN_DECIMALS = 6;

/** Rail in the low 4 bits, action in the high 4 bits (see TalariaCore.Intent). */
export const Rail = {
  transfer: 0x00,
  withdraw: 0x10,
  addKey: 0x20,
  revokeKey: 0x30,
  payInvoice: 0x01,
  createInvoice: 0x11,
  refund: 0x21,
  subscribe: 0x02,
  cancelSub: 0x12,
  startStream: 0x03,
  withdrawStream: 0x13,
  stopStream: 0x23,
  openChannel: 0x04,
  requestClose: 0x14,
  finishClose: 0x24,
  sendRemit: 0x05,
  cancelRemit: 0x15,
  claimRemit: 0x25,
} as const;

/** Bit values for a session key's allowed-rails mask. */
export const RailBit = { account: 1, checkout: 2, subscriptions: 4, streams: 8, channels: 16, remit: 32 } as const;

export type Intent = {
  rail: number;
  owner: Address;
  signer: Address;
  payee: Address;
  amount: bigint;
  ref: Hex;
  nonce: bigint;
  deadline: bigint;
};

export type SignedIntent = { intent: Intent; v: number; r: Hex; s: Hex };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ZERO_REF = `0x${"00".repeat(32)}` as Hex;

export const toRef = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
export const toUnits = (amount: string | number | bigint): bigint =>
  typeof amount === "bigint" ? amount : parseUnits(String(amount), TOKEN_DECIMALS);

const INTENT_TYPES = {
  Intent: [
    { name: "rail", type: "uint8" },
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "ref", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export async function signIntent(account: LocalAccount, core: Address, chainId: number, intent: Intent): Promise<SignedIntent> {
  const signature = await account.signTypedData({
    domain: { name: "TalariaCore", version: "1", chainId, verifyingContract: core },
    types: INTENT_TYPES,
    primaryType: "Intent",
    message: intent,
  });
  const { r, s, v } = parseSignature(signature);
  return { intent, v: Number(v), r, s };
}

export type Voucher = { channelId: bigint; cumulativeAmount: bigint; nonce: bigint };
export type SignedVoucher = Voucher & { v: number; r: Hex; s: Hex };

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "channelId", type: "uint256" },
    { name: "cumulativeAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const voucherDomain = (channels: Address, chainId: number) =>
  ({ name: "TalariaChannels", version: "1", chainId, verifyingContract: channels }) as const;

export async function signVoucher(account: LocalAccount, channels: Address, chainId: number, voucher: Voucher): Promise<SignedVoucher> {
  const signature = await account.signTypedData({
    domain: voucherDomain(channels, chainId),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: voucher,
  });
  const { r, s, v } = parseSignature(signature);
  return { ...voucher, v: Number(v), r, s };
}
