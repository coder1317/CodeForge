class RateLimitTracker {
  private requests: Map<string, number[]> = new Map();
  private cooldowns: Map<string, number> = new Map();

  /**
   * Record a new request timestamp for a provider.
   */
  trackRequest(providerId: string): void {
    const now = Date.now();
    const timestamps = this.getValidTimestamps(providerId, now);
    timestamps.push(now);
    this.requests.set(providerId, timestamps);
  }

  /**
   * Remember that a provider asked us to back off (e.g. HTTP 429 with a
   * retry-after). The selector will skip it until the cooldown expires.
   */
  setCooldown(providerId: string, ms: number): void {
    this.cooldowns.set(providerId, Date.now() + ms);
  }

  /**
   * Check if a provider has exceeded its maximum RPM limit or is cooling down.
   */
  isRateLimited(providerId: string, maxRPM: number): boolean {
    const until = this.cooldowns.get(providerId);
    if (until && Date.now() < until) return true;
    const count = this.getRPM(providerId);
    return count >= maxRPM;
  }

  /**
   * Get current request count in the sliding 60-second window.
   */
  getRPM(providerId: string): number {
    const now = Date.now();
    const timestamps = this.getValidTimestamps(providerId, now);
    return timestamps.length;
  }

  /**
   * Reset request history and cooldowns for a provider.
   */
  resetRPM(providerId: string): void {
    this.requests.delete(providerId);
    this.cooldowns.delete(providerId);
  }

  private getValidTimestamps(providerId: string, now: number): number[] {
    const timestamps = this.requests.get(providerId) || [];
    const windowStart = now - 60000; // 60 seconds ago
    return timestamps.filter(t => t > windowStart);
  }
}

export const rateLimitTracker = new RateLimitTracker();
