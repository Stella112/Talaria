/** Fixed-window limit per key, in memory. Keeps visitors from draining the hosted agent. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const time = this.now();
    const entry = this.hits.get(key);
    if (!entry || time - entry.start >= this.windowMs) {
      this.hits.set(key, { start: time, count: 1 });
      return true;
    }
    if (entry.count >= this.max) return false;
    entry.count++;
    return true;
  }
}
