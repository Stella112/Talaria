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
      CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, body_hash TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL);
    `);
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
