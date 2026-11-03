import { keccak256, parseAbi, recoverMessageAddress, toHex, type Address, type Hex, type LocalAccount, type PublicClient, type WalletClient } from "viem";
import type { Db } from "./db";

/** Same addresses on Base Sepolia and BNB testnet; code confirmed with eth_getCode on both. */
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

/** Signatures copied from abis/ in the official erc-8004/erc-8004-contracts repository. */
export const registryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

export const FEEDBACK_TAG = "talaria-settlement";
export const MIN_FEEDBACK = 3;
const ATTESTATION_TTL_SECONDS = 600n;

export type Tier = "trusted" | "established" | "new";

/**
 * The trust formula. Feedback values are 100 (clean release) or 0 (dispute refunded 50% or more),
 * so the registry's average is already on a 0-100 scale. The score clamps that average to 0-100
 * and rounds down. No feedback scores 0.
 */
export function scoreFrom(count: bigint, summaryValue: bigint, decimals: number): number {
  if (count === 0n) return 0;
  const whole = summaryValue / 10n ** BigInt(decimals);
  if (whole < 0n) return 0;
  return whole > 100n ? 100 : Number(whole);
}

/** Must match TalariaProtect._tierOf: fewer than 3 feedbacks is New, whatever the score. */
export function tierOf(score: number, feedbackCount: number): Tier {
  if (feedbackCount < MIN_FEEDBACK || score < 50) return "new";
  return score >= 80 ? "trusted" : "established";
}

export const linkMessage = (subject: Address, agentId: bigint) => `Link ERC-8004 agent ${agentId} on Base Sepolia to Portaldot address ${subject.toLowerCase()} for Talaria`;

export type Attestation = {
  subject: Address;
  agentId: bigint;
  score: number;
  feedbackCount: number;
  srcChainId: bigint;
  srcBlock: bigint;
  expiry: bigint;
  nonce: bigint;
};

const ATTESTATION_TYPES = {
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

export type TrustConfig = {
  base: PublicClient;
  db: Db;
  /** Signs attestations. Must not be the relayer's gas key. */
  attester: LocalAccount;
  /** The feedback client whose feedback counts towards a score. */
  settlementClient: Address;
  protect: Address;
  portaldotChainId: number;
  srcChainId: bigint;
  now?: () => number;
};

export type TrustView = { subject: Address; agentId: bigint | null; score: number; feedbackCount: number; tier: Tier; srcChainId: bigint; srcBlock: bigint | null };

export class TrustService {
  constructor(private readonly cfg: TrustConfig) {}

  /** Stores the link only if the wallet that owns the agent signed it. */
  async linkIdentity(subject: Address, agentId: bigint, signature: Hex) {
    const owner = await this.cfg.base.readContract({ address: IDENTITY_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [agentId] });
    const signer = await recoverMessageAddress({ message: linkMessage(subject, agentId), signature });
    if (signer.toLowerCase() !== owner.toLowerCase()) throw new Error("The signature is not from the wallet that owns this agent");
    this.cfg.db.linkIdentity(subject, agentId, owner, signature);
  }

  /** Reads reputation at a recent Base block. Unregistered subjects are New. */
  async getTrust(subject: Address): Promise<TrustView> {
    const agentId = this.cfg.db.identityOf(subject);
    if (agentId === null) return { subject, agentId, score: 0, feedbackCount: 0, tier: "new", srcChainId: this.cfg.srcChainId, srcBlock: null };
    const srcBlock = await this.cfg.base.getBlockNumber();
    const [count, value, decimals] = await this.cfg.base.readContract({
      address: REPUTATION_REGISTRY,
      abi: registryAbi,
      functionName: "getSummary",
      args: [agentId, [this.cfg.settlementClient], FEEDBACK_TAG, ""],
      blockNumber: srcBlock,
    });
    const score = scoreFrom(count, value, decimals);
    const feedbackCount = Number(count);
    return { subject, agentId, score, feedbackCount, tier: tierOf(score, feedbackCount), srcChainId: this.cfg.srcChainId, srcBlock };
  }

  /** Signs an attestation, or returns null for an unregistered subject (the contract treats that as New). */
  async attest(subject: Address): Promise<{ attestation: Attestation; sig: { v: number; r: Hex; s: Hex }; view: TrustView } | null> {
    const view = await this.getTrust(subject);
    if (view.agentId === null || view.srcBlock === null) return null;
    const now = BigInt(this.cfg.now?.() ?? Math.floor(Date.now() / 1000));
    const attestation: Attestation = {
      subject,
      agentId: view.agentId,
      score: view.score,
      feedbackCount: view.feedbackCount,
      srcChainId: view.srcChainId,
      srcBlock: view.srcBlock,
      expiry: now + ATTESTATION_TTL_SECONDS,
      nonce: this.cfg.db.nextCounter("attestation"),
    };
    const signature = await this.cfg.attester.signTypedData({
      domain: { name: "TalariaProtect", version: "1", chainId: this.cfg.portaldotChainId, verifyingContract: this.cfg.protect },
      types: ATTESTATION_TYPES,
      primaryType: "TrustAttestation",
      message: attestation,
    });
    return { attestation, sig: splitSignature(signature), view };
  }
}

export function splitSignature(signature: Hex) {
  const r = signature.slice(0, 66) as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  return { v: parseInt(signature.slice(130, 132), 16), r, s };
}

export type Outcome = {
  paymentId: bigint;
  /** Agent receiving the feedback: the merchant, or the paying agent. */
  agentId: bigint;
  result: "released" | "refunded";
  /** Portaldot transaction that settled this outcome. Feedback is never written without one. */
  portaldotTx: Hex;
};

export type FeedbackWriter = (agentId: bigint, value: bigint, tag2: string, feedbackURI: string, feedbackHash: Hex) => Promise<Hex>;

/** Real writer: simulates first, so the registry's self-feedback rule surfaces before any gas is spent. */
export function liveFeedbackWriter(base: PublicClient, wallet: WalletClient, live: boolean): FeedbackWriter {
  return async (agentId, value, tag2, feedbackURI, feedbackHash) => {
    const { request } = await base.simulateContract({
      account: wallet.account,
      address: REPUTATION_REGISTRY,
      abi: registryAbi,
      functionName: "giveFeedback",
      args: [agentId, value, 0, FEEDBACK_TAG, tag2, "", feedbackURI, feedbackHash],
    });
    if (!live) throw new Error("Refused giveFeedback: RELAYER_LIVE is not set");
    const hash = await wallet.writeContract(request as any);
    const receipt = await base.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`giveFeedback reverted in ${hash}`);
    return hash;
  };
}

/** Writes one feedback per payment, subject and outcome, however many times it is called. */
export async function writeOutcome(db: Db, write: FeedbackWriter, outcome: Outcome, portaldotChainId: number): Promise<{ txHash: Hex; written: boolean }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(outcome.portaldotTx)) throw new Error("Feedback needs the Portaldot transaction that settled the payment");
  const key = `${outcome.paymentId}:${outcome.agentId}:${outcome.result}`;
  const record = db.feedbackRecord(key);
  if (record?.status === "done") return { txHash: record.tx_hash as Hex, written: false };
  if (record?.status === "submitting") throw new Error(`Feedback ${key} is already being submitted, or an earlier attempt needs checking`);
  db.setFeedback(key, "submitting");
  const uri = `portaldot:${portaldotChainId}:tx:${outcome.portaldotTx}:payment:${outcome.paymentId}`;
  try {
    const txHash = await write(outcome.agentId, outcome.result === "released" ? 100n : 0n, outcome.result, uri, keccak256(toHex(uri)));
    db.setFeedback(key, "done", txHash);
    return { txHash, written: true };
  } catch (error) {
    // Only safe because simulation failures happen before anything is sent.
    db.clearFeedback(key);
    throw error;
  }
}
