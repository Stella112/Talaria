import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DeliveryRow = { id: number; event_id: string; merchant: string; type: string; attempts: number; status: string; last_error: string | null };

/** SQLite records for trust, feedback, webhooks and idempotency. Uses Node's built-in driver. */
export class Db {
  private readonly db: DatabaseSync;

  constructor(file = ":memory:") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identities (subject TEXT PRIMARY KEY, agent_id TEXT NOT NULL, owner TEXT NOT NULL, signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS feedback (outcome_key TEXT PRIMARY KEY, status TEXT NOT NULL, tx_hash TEXT);
      CREATE TABLE IF NOT EXISTS webhooks (merchant TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, merchant TEXT NOT NULL, type TEXT NOT NULL, attempts INTEGER NOT NULL, status TEXT NOT NULL, last_error TEXT);
      CREATE TABLE IF NOT EXISTS cursors (name TEXT PRIMARY KEY, block TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bridge_out (id TEXT PRIMARY KEY, status TEXT NOT NULL, source_tx TEXT NOT NULL, dest_tx TEXT);
      CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, release_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payment_agents (id TEXT PRIMARY KEY, agent TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, body_hash TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL);
    `);
  }

  cursor(name: string): bigint | null {
    const row = this.db.prepare("SELECT block FROM cursors WHERE name = ?").get(name) as { block: string } | undefined;
    return row ? BigInt(row.block) : null;
  }

  setCursor(name: string, block: bigint) {
    this.db.prepare("INSERT INTO cursors VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block").run(name, block.toString());
  }

  bridgeOut(id: string) {
    return this.db.prepare("SELECT status, source_tx, dest_tx FROM bridge_out WHERE id = ?").get(id) as { status: string; source_tx: string; dest_tx: string | null } | undefined;
  }

  setBridgeOut(id: string, status: "pending" | "completed", sourceTx: string, destTx?: string) {
    this.db.prepare("INSERT INTO bridge_out VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, dest_tx = COALESCE(excluded.dest_tx, bridge_out.dest_tx)").run(id, status, sourceTx, destTx ?? null);
  }

  addHold(id: bigint, releaseAt: number) {
    this.db.prepare("INSERT OR IGNORE INTO holds VALUES (?, ?)").run(id.toString(), releaseAt);
  }

  removeHold(id: bigint) {
    this.db.prepare("DELETE FROM holds WHERE id = ?").run(id.toString());
  }

  dueHolds(now: number): bigint[] {
    return (this.db.prepare("SELECT id FROM holds WHERE release_at <= ? ORDER BY release_at").all(now) as { id: string }[]).map((row) => BigInt(row.id));
  }

  setPaymentAgent(id: bigint, agent: string) {
    this.db.prepare("INSERT OR REPLACE INTO payment_agents VALUES (?, ?)").run(id.toString(), agent.toLowerCase());
  }

  agentOfPayment(id: bigint): string | null {
    const row = this.db.prepare("SELECT agent FROM payment_agents WHERE id = ?").get(id.toString()) as { agent: string } | undefined;
    return row?.agent ?? null;
  }

  linkIdentity(subject: string, agentId: bigint, owner: string, signature: string) {
    this.db
      .prepare("INSERT INTO identities VALUES (?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET agent_id = excluded.agent_id, owner = excluded.owner, signature = excluded.signature")
      .run(subject.toLowerCase(), agentId.toString(), owner, signature);
  }

  identityOf(subject: string): bigint | null {
    const row = this.db.prepare("SELECT agent_id FROM identities WHERE subject = ?").get(subject.toLowerCase()) as { agent_id: string } | undefined;
    return row ? BigInt(row.agent_id) : null;
  }

  /** Next value of a named counter, starting at zero. Survives restarts. */
  nextCounter(name: string): bigint {
    const row = this.db
      .prepare("INSERT INTO counters VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value")
      .get(name) as { value: number };
    return BigInt(row.value - 1);
  }

  feedbackRecord(key: string) {
    return this.db.prepare("SELECT status, tx_hash FROM feedback WHERE outcome_key = ?").get(key) as { status: string; tx_hash: string | null } | undefined;
  }

  setFeedback(key: string, status: "submitting" | "done", txHash?: string) {
    this.db.prepare("INSERT INTO feedback VALUES (?, ?, ?) ON CONFLICT(outcome_key) DO UPDATE SET status = excluded.status, tx_hash = excluded.tx_hash").run(key, status, txHash ?? null);
  }

  clearFeedback(key: string) {
    this.db.prepare("DELETE FROM feedback WHERE outcome_key = ?").run(key);
  }

  countFeedback(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'done'").get() as { n: number }).n;
  }

  setWebhook(merchant: string, url: string, secret: string) {
    this.db.prepare("INSERT INTO webhooks VALUES (?, ?, ?) ON CONFLICT(merchant) DO UPDATE SET url = excluded.url, secret = excluded.secret").run(merchant.toLowerCase(), url, secret);
  }

  webhookOf(merchant: string) {
    return this.db.prepare("SELECT url, secret FROM webhooks WHERE merchant = ?").get(merchant.toLowerCase()) as { url: string; secret: string } | undefined;
  }

  addDelivery(eventId: string, merchant: string, type: string): number {
    const row = this.db.prepare("INSERT INTO deliveries (event_id, merchant, type, attempts, status) VALUES (?, ?, ?, 0, 'pending') RETURNING id").get(eventId, merchant.toLowerCase(), type) as { id: number };
    return row.id;
  }

  updateDelivery(id: number, attempts: number, status: string, lastError: string | null) {
    this.db.prepare("UPDATE deliveries SET attempts = ?, status = ?, last_error = ? WHERE id = ?").run(attempts, status, lastError, id);
  }

  deliveriesFor(merchant: string): DeliveryRow[] {
    return this.db.prepare("SELECT * FROM deliveries WHERE merchant = ? ORDER BY id DESC LIMIT 100").all(merchant.toLowerCase()) as unknown as DeliveryRow[];
  }

  idempotent(key: string) {
    return this.db.prepare("SELECT body_hash, status, response FROM idempotency WHERE key = ?").get(key) as { body_hash: string; status: number; response: string } | undefined;
  }

  saveIdempotent(key: string, bodyHash: string, status: number, response: string) {
    this.db.prepare("INSERT OR REPLACE INTO idempotency VALUES (?, ?, ?, ?)").run(key, bodyHash, status, response);
  }
}
