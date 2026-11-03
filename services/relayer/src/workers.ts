import type { Chain } from "./chain";
import type { Store } from "./store";

// The public Base Sepolia RPC rejects eth_getLogs over 200 blocks.
const MAX_BLOCK_RANGE = 150n;
const MAX_BATCH = 50;
const SOURCE_CONFIRMATIONS = 2n;

/** Credits new locks once. A record made before sending, plus the on-chain flag, covers crashes. */
export async function pollBridge(chain: Chain, store: Store, startBlock: bigint): Promise<number> {
  const head = (await chain.sourceHead()) - SOURCE_CONFIRMATIONS;
  const from = store.cursor === null ? startBlock : store.cursor + 1n;
  if (from > head) return 0;
  const to = from + MAX_BLOCK_RANGE - 1n < head ? from + MAX_BLOCK_RANGE - 1n : head;

  let credited = 0;
  for (const lock of await chain.lockedEvents(from, to)) {
    const seen = store.get("bridge", lock.txHash);
    if (seen?.status === "done") continue;
    if (await chain.bridgeProcessed(lock.txHash)) {
      store.set("bridge", lock.txHash, { status: "done" });
      continue;
    }
    store.set("bridge", lock.txHash, { status: "submitting" });
    const txHash = await chain.credit(lock.recipient, lock.amount, lock.txHash);
    store.set("bridge", lock.txHash, { status: "done", txHash });
    credited++;
  }
  // Only reached when every lock succeeded, so a failure retries this range.
  store.cursor = to;
  return credited;
}

export async function runKeeper(chain: Chain): Promise<number> {
  let charged = 0;
  const count = await chain.subscriptionCount();
  for (let id = 1; id <= count; id++) {
    if (!(await chain.dueSubscription(id))) continue;
    try {
      await chain.charge(id);
      charged++;
    } catch (error) {
      console.warn(`[keeper] charge ${id} failed: ${String(error)}`);
    }
  }
  return charged;
}

export async function settleVouchers(chain: Chain, store: Store): Promise<number> {
  const batch = store.vouchers().slice(0, MAX_BATCH);
  if (batch.length === 0) return 0;
  await chain.redeemBatch(batch);
  for (const voucher of batch) store.removeVoucher(voucher.channelId, voucher.cumulativeAmount);
  return batch.length;
}

/** Runs `task` repeatedly with exponential backoff on failure (max 5 doublings). */
export function loop(name: string, intervalMs: number, task: () => Promise<unknown>) {
  let failures = 0;
  const tick = async () => {
    try {
      await task();
      failures = 0;
    } catch (error) {
      failures = Math.min(failures + 1, 5);
      console.warn(`[${name}] failed (${failures}): ${String(error)}`);
    }
    setTimeout(tick, intervalMs * 2 ** failures);
  };
  void tick();
}
