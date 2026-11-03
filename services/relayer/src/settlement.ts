import type { Address, Hex } from "viem";
import type { Db } from "./db";
import { writeOutcome, type FeedbackWriter } from "./trust";
import type { Webhooks } from "./webhooks";

const MAX_BLOCK_RANGE = 2_000n;
const PORTALDOT_CONFIRMATIONS = 2n;
const NEGATIVE_REFUND_BPS = 5_000;

export type ProtectEvent = { eventName: string; args: Record<string, any>; txHash: Hex };
export type BridgeOutEvent = { id: Hex; from: Address; recipient: Address; amount: bigint; destChainId: bigint; txHash: Hex };

/** The chain access the settlement workers need, so they can be tested without one. */
export type SettlementChain = {
  portaldotHead(): Promise<bigint>;
  protectEvents(from: bigint, to: bigint): Promise<ProtectEvent[]>;
  merchantOf(paymentId: bigint): Promise<Address>;
  release(paymentId: bigint): Promise<Hex>;
  bridgeOutEvents(from: bigint, to: bigint): Promise<BridgeOutEvent[]>;
  lockboxProcessed(destChainId: bigint, id: Hex): Promise<boolean>;
  lockboxRelease(destChainId: bigint, id: Hex, recipient: Address, amount: bigint): Promise<Hex>;
};

async function nextRange(chain: SettlementChain, db: Db, cursor: string, start: bigint) {
  const head = (await chain.portaldotHead()) - PORTALDOT_CONFIRMATIONS;
  const last = db.cursor(cursor);
  const from = last === null ? start : last + 1n;
  if (from > head) return null;
  return { from, to: from + MAX_BLOCK_RANGE - 1n < head ? from + MAX_BLOCK_RANGE - 1n : head };
}

/** Releases bridge-outs on the destination chain. The cursor only advances when all of a range succeed. */
export async function pollBridgeOut(chain: SettlementChain, db: Db, start: bigint, webhooks?: Webhooks): Promise<number> {
  const range = await nextRange(chain, db, "bridge-out", start);
  if (!range) return 0;
  let released = 0;
  for (const event of await chain.bridgeOutEvents(range.from, range.to)) {
    if (db.bridgeOut(event.id)?.status === "completed") continue;
    if (await chain.lockboxProcessed(event.destChainId, event.id)) {
      db.setBridgeOut(event.id, "completed", event.txHash);
      continue;
    }
    db.setBridgeOut(event.id, "pending", event.txHash);
    const releaseTx = await chain.lockboxRelease(event.destChainId, event.id, event.recipient, event.amount);
    db.setBridgeOut(event.id, "completed", event.txHash, releaseTx);
    await webhooks?.emit(event.from, "bridge.completed", { id: event.id, recipient: event.recipient, amount: event.amount, destChainId: event.destChainId, sourceTx: event.txHash, destTx: releaseTx });
    released++;
  }
  db.setCursor("bridge-out", range.to);
  return released;
}

/** Follows payment events: records holds, sends webhooks, and writes reputation back to Base. */
export async function pollOutcomes(chain: SettlementChain, db: Db, start: bigint, write: FeedbackWriter, portaldotChainId: number, webhooks?: Webhooks): Promise<number> {
  const range = await nextRange(chain, db, "outcomes", start);
  if (!range) return 0;
  let written = 0;

  const feedback = async (paymentId: bigint, subject: Address, result: "released" | "refunded", portaldotTx: Hex) => {
    const agentId = db.identityOf(subject);
    if (agentId === null) return;
    const outcome = await writeOutcome(db, write, { paymentId, agentId, result, portaldotTx }, portaldotChainId);
    if (outcome.written) {
      written++;
      await webhooks?.emit(subject, "reputation.written", { paymentId, agentId, result, baseTx: outcome.txHash, portaldotTx });
    }
  };

  for (const { eventName, args, txHash } of await chain.protectEvents(range.from, range.to)) {
    const id = (args.id ?? args.paymentId) as bigint;
    if (eventName === "PaymentOpened") {
      if (BigInt(args.releaseAt) > 0n) db.addHold(id, Number(args.releaseAt));
      await webhooks?.emit(args.merchant, "payment.confirmed", { id, buyer: args.buyer, amount: args.amount, releaseAt: args.releaseAt, txHash });
    } else if (eventName === "TrustApplied") {
      await webhooks?.emit(args.subject, "trust.applied", { id, score: args.score, srcChainId: args.srcChainId, srcBlock: args.srcBlock, txHash });
    } else if (eventName === "PaymentReleased") {
      db.removeHold(id);
      const merchant = await chain.merchantOf(id);
      await webhooks?.emit(merchant, "payment.released", { id, amount: args.amount, txHash });
      await feedback(id, merchant, "released", txHash);
      const agent = db.agentOfPayment(id);
      if (agent) await feedback(id, agent as Address, "released", txHash);
    } else if (eventName === "PaymentDisputed") {
      db.removeHold(id);
      await webhooks?.emit(await chain.merchantOf(id), "payment.disputed", { id, reasonHash: args.reasonHash, txHash });
    } else if (eventName === "PaymentRefunded") {
      await webhooks?.emit(await chain.merchantOf(id), "payment.refunded", { id, amount: args.amount, total: args.totalRefunded, txHash });
    } else if (eventName === "PaymentResolved") {
      const merchant = await chain.merchantOf(id);
      await webhooks?.emit(merchant, "payment.refunded", { id, amount: args.refunded, refundBps: args.refundBps, txHash });
      if (Number(args.refundBps) >= NEGATIVE_REFUND_BPS) await feedback(id, merchant, "refunded", txHash);
    }
  }
  db.setCursor("outcomes", range.to);
  return written;
}

/** Releases payments whose hold has passed. A failure leaves the hold for the next run. */
export async function runReleaseKeeper(chain: SettlementChain, db: Db, now = Math.floor(Date.now() / 1000)): Promise<number> {
  let released = 0;
  for (const id of db.dueHolds(now)) {
    try {
      await chain.release(id);
      db.removeHold(id);
      released++;
    } catch (error) {
      console.warn(`[keeper] release ${id} failed: ${String(error)}`);
    }
  }
  return released;
}
