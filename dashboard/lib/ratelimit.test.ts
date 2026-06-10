import { describe, it, expect } from "vitest";
import { makeRateLimiter } from "./ratelimit";

describe("rate limiter (demo-friendly defaults: 5/min, 30/hr per IP, 300/hr global)", () => {
  it("allows a quick burst (demo: normal then attack), blocks the 6th within a minute", () => {
    const check = makeRateLimiter();
    let t = 0;
    for (let i = 0; i < 5; i++) { expect(check("1.1.1.1", t).ok).toBe(true); t += 1000; } // 5 within ~5s OK
    expect(check("1.1.1.1", t).ok).toBe(false);            // 6th within the minute -> blocked
    expect(check("1.1.1.1", t + 61_000).ok).toBe(true);    // after the minute -> OK
  });
  it("blocks after 30/hour per IP", () => {
    const check = makeRateLimiter();
    let t = 0;
    for (let i = 0; i < 30; i++) { expect(check("2.2.2.2", t).ok).toBe(true); t += 61_000; } // space out past the burst window
    expect(check("2.2.2.2", t).ok).toBe(false);            // 31st within the hour
  });
  it("isolates different IPs", () => {
    const check = makeRateLimiter();
    expect(check("a", 0).ok).toBe(true);
    expect(check("b", 0).ok).toBe(true);
  });
  it("enforces a global hourly cap", () => {
    const check = makeRateLimiter({ globalPerHour: 2 });
    expect(check("x", 0).ok).toBe(true);
    expect(check("y", 1).ok).toBe(true);
    expect(check("z", 2).ok).toBe(false);
  });
});
