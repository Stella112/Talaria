import { encodeAbiParameters, keccak256, parseSignature, stringToHex, type Address, type Hex, type LocalAccount } from "viem";

export type Sig = { v: number; r: Hex; s: Hex };

export type Mandate = {
  owner: Address;
  agent: Address;
  payeesHash: Hex;
  token: Address;
  minAmount: bigint;
  maxAmount: bigint;
  expiry: bigint;
  maxUses: number;
  checkoutHash: Hex;
  nonce: bigint;
};

export type Checkout = { orderId: Hex; amount: bigint; token: Address; payee: Address; expiry: bigint };
export type SignedMandate = { mandate: Mandate; sig: Sig; payees: Address[] };

export const PROTECT_TYPES = {
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
} as const;

export const payeesHash = (payees: Address[]) => keccak256(encodeAbiParameters([{ type: "address[]" }], [payees]));

/** The struct hash TalariaProtect uses as a mandate's id, matching its EIP-712 encoding. */
function structHash(primaryType: keyof typeof PROTECT_TYPES, message: Record<string, unknown>): Hex {
  const fields = PROTECT_TYPES[primaryType];
  const typeHash = keccak256(stringToHex(`${primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, ...fields] as any, [typeHash, ...fields.map((f) => message[f.name])] as any));
}

export const mandateHash = (mandate: Mandate) => structHash("Mandate", mandate);
export const checkoutHash = (checkout: Checkout) => structHash("Checkout", checkout);

export async function signProtect(account: LocalAccount, protect: Address, chainId: number, primaryType: keyof typeof PROTECT_TYPES, message: Record<string, unknown>): Promise<Sig> {
  const signature = await account.signTypedData({
    domain: { name: "TalariaProtect", version: "1", chainId, verifyingContract: protect },
    types: { [primaryType]: PROTECT_TYPES[primaryType] } as any,
    primaryType,
    message,
  } as any);
  const { r, s, v } = parseSignature(signature);
  return { v: Number(v), r, s };
}
