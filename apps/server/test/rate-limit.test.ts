import { afterEach, describe, expect, it, vi } from "vitest";

import { SlidingWindowRateLimiter, normalizeIp } from "../src/util/rate-limit.js";

const MINUTE_MS = 60_000;

const LIMIT_CASES = [
  { action: "create_room", limit: 10 },
  { action: "join_room", limit: 30 },
  { action: "upload_item", limit: 120 },
  { action: "finish_pool", limit: 60 },
  { action: "connect", limit: 50 },
] as const;

describe("SlidingWindowRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("permite una solicitud por debajo del límite", () => {
    const limiter = new SlidingWindowRateLimiter();

    expect(limiter.allow("join_room", "1.2.3.4")).toBe(true);
  });

  it.each(LIMIT_CASES)("bloquea $action al superar su límite", ({ action, limit }) => {
    const limiter = new SlidingWindowRateLimiter();

    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect(limiter.allow(action, "1.2.3.4")).toBe(true);
    }
    expect(limiter.allow(action, "1.2.3.4")).toBe(false);
  });

  it("permite de nuevo cuando termina la ventana", () => {
    vi.useFakeTimers();
    const limiter = new SlidingWindowRateLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.allow("create_room", "1.2.3.4")).toBe(true);
    }

    vi.advanceTimersByTime(MINUTE_MS + 1);

    expect(limiter.allow("create_room", "1.2.3.4")).toBe(true);
  });

  it("mantiene contadores independientes para IPs distintas", () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.allow("create_room", "1.2.3.4")).toBe(true);
    }

    expect(limiter.allow("create_room", "5.6.7.8")).toBe(true);
  });

  it("normaliza direcciones IPv4 encapsuladas en IPv6", () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.allow("create_room", "::ffff:1.2.3.4")).toBe(true);
    }

    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(limiter.allow("create_room", "1.2.3.4")).toBe(false);
  });
});
