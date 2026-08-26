import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimitTracker } from './rateLimitTracker';

describe('rateLimitTracker', () => {
  beforeEach(() => {
    rateLimitTracker.resetRPM('test-provider');
    rateLimitTracker.resetRPM('cooldown-provider');
  });

  it('counts requests in the sliding window', () => {
    rateLimitTracker.trackRequest('test-provider');
    rateLimitTracker.trackRequest('test-provider');
    expect(rateLimitTracker.getRPM('test-provider')).toBe(2);
  });

  it('flags providers that exceeded maxRPM', () => {
    for (let i = 0; i < 5; i++) rateLimitTracker.trackRequest('test-provider');
    expect(rateLimitTracker.isRateLimited('test-provider', 5)).toBe(true);
    expect(rateLimitTracker.isRateLimited('test-provider', 6)).toBe(false);
  });

  it('honors cooldowns regardless of RPM count', () => {
    rateLimitTracker.setCooldown('cooldown-provider', 60_000);
    expect(rateLimitTracker.isRateLimited('cooldown-provider', 9999)).toBe(true);
  });

  it('clears cooldown after expiry', () => {
    rateLimitTracker.setCooldown('cooldown-provider', -1); // already expired
    expect(rateLimitTracker.isRateLimited('cooldown-provider', 9999)).toBe(false);
  });

  it('resetRPM clears both history and cooldowns', () => {
    rateLimitTracker.trackRequest('test-provider');
    rateLimitTracker.setCooldown('test-provider', 60_000);
    rateLimitTracker.resetRPM('test-provider');
    expect(rateLimitTracker.getRPM('test-provider')).toBe(0);
    expect(rateLimitTracker.isRateLimited('test-provider', 9999)).toBe(false);
  });
});
