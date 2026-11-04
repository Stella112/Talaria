const HOUR = 3_600_000;
const positive = (value: string | undefined, fallback: number) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

/** Hourly limits per address. Visitors coming through the website share one address, so hosts can raise these. */
export const limitsFromEnv = (env: Record<string, string | undefined>) => ({
  parse: new RateLimiter(positive(env.AGENT_PARSE_PER_HOUR, 60), HOUR),
  execute: new RateLimiter(positive(env.AGENT_EXECUTE_PER_HOUR, 10), HOUR),
});

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
