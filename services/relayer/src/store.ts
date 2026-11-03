import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Record_ = { status: "submitting" | "done"; txHash?: string };
export type StoredVoucher = { channelId: string; cumulativeAmount: string; nonce: string; v: number; r: string; s: string };

type State = {
  bridge: Record<string, Record_>;
  intents: Record<string, Record_>;
  cursor: string | null;
  vouchers: Record<string, StoredVoucher>;
  sends: number[];
};

/** JSON persistence, written atomically on every change. */
export class Store {
  private state: State = { bridge: {}, intents: {}, cursor: null, vouchers: {}, sends: [] };

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) this.state = { ...this.state, ...JSON.parse(readFileSync(file, "utf8")) };
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  get(kind: "bridge" | "intents", key: string): Record_ | undefined {
    return this.state[kind][key];
  }

  set(kind: "bridge" | "intents", key: string, record: Record_) {
    this.state[kind][key] = record;
    this.save();
  }

  clear(kind: "bridge" | "intents", key: string) {
    delete this.state[kind][key];
    this.save();
  }

  get cursor(): bigint | null {
    return this.state.cursor === null ? null : BigInt(this.state.cursor);
  }

  set cursor(block: bigint | null) {
    this.state.cursor = block === null ? null : block.toString();
    this.save();
  }

  /** Keeps only the highest voucher per channel: it is the only one worth redeeming. */
  putVoucher(voucher: StoredVoucher): boolean {
    const current = this.state.vouchers[voucher.channelId];
    if (current && BigInt(current.cumulativeAmount) >= BigInt(voucher.cumulativeAmount)) return false;
    this.state.vouchers[voucher.channelId] = voucher;
    this.save();
    return true;
  }

  vouchers(): StoredVoucher[] {
    return Object.values(this.state.vouchers);
  }

  removeVoucher(channelId: string, cumulativeAmount: string) {
    if (this.state.vouchers[channelId]?.cumulativeAmount !== cumulativeAmount) return;
    delete this.state.vouchers[channelId];
    this.save();
  }

  /** Spend guard: returns false once `max` sends happened in the last hour. */
  takeSendSlot(max: number, now = Date.now()): boolean {
    this.state.sends = this.state.sends.filter((t) => now - t < 3_600_000);
    if (this.state.sends.length >= max) return false;
    this.state.sends.push(now);
    this.save();
    return true;
  }
}
