const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window limiter: at most `maxRequests` calls to acquire() resolve
 * within any trailing `windowMs`. Callers over the limit are queued (they
 * await, not reject) so tool calls are paced rather than failing.
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      const waitMs = this.timestamps[0] + this.windowMs - now;
      await sleep(Math.max(waitMs, 0) + 25); // small buffer past the window edge
    }
  }
}
