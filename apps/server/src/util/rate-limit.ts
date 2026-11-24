const WINDOW_MS = 60_000;
const IPV4_MAPPED_PREFIX = "::ffff:";

const RATE_LIMITS = {
  create_room: 10,
  join_room: 30,
  upload_item: 120,
  finish_pool: 60,
  connect: 50,
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export function normalizeIp(address: string): string {
  return address.startsWith(IPV4_MAPPED_PREFIX)
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : address;
}

export class SlidingWindowRateLimiter {
  private readonly requestsByKey = new Map<string, number[]>();

  allow(action: RateLimitAction, address: string): boolean {
    const key = `${action}:${normalizeIp(address)}`;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const recentRequests = (this.requestsByKey.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recentRequests.length >= RATE_LIMITS[action]) {
      this.requestsByKey.set(key, recentRequests);
      return false;
    }

    recentRequests.push(now);
    this.requestsByKey.set(key, recentRequests);
    return true;
  }
}

export const rateLimiter = new SlidingWindowRateLimiter();
