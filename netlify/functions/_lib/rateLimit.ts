// Best-effort in-memory sliding-window rate limiter.
// Netlify may run several function instances, so this is a per-instance
// backstop; Netlify's native `config.rateLimit` is the primary limit where set.

const MAX_KEYS = 10_000;

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records a hit for `key`; returns false if the key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    let list = this.hits.get(key);
    if (list) {
      while (list.length && list[0]! <= cutoff) list.shift();
    } else {
      if (this.hits.size >= MAX_KEYS) this.prune(now);
      list = [];
      this.hits.set(key, list);
    }
    if (list.length >= this.limit) return false;
    list.push(now);
    return true;
  }

  /** Seconds until the oldest hit for `key` leaves the window. */
  retryAfter(key: string, now = Date.now()): number {
    const list = this.hits.get(key);
    if (!list?.length) return 0;
    return Math.max(1, Math.ceil((list[0]! + this.windowMs - now) / 1000));
  }

  reset(): void {
    this.hits.clear();
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [k, list] of this.hits) {
      if (!list.length || list[list.length - 1]! <= cutoff) this.hits.delete(k);
    }
    // Still full (sustained flood from many IPs): drop the oldest half.
    if (this.hits.size >= MAX_KEYS) {
      let n = Math.floor(this.hits.size / 2);
      for (const k of this.hits.keys()) {
        if (n-- <= 0) break;
        this.hits.delete(k);
      }
    }
  }
}
