export interface RateLimitOpts {
  burstWindowMs?: number;
  burstLimit?: number;
  hourMs?: number;
  perIpPerHour?: number;
  globalPerHour?: number;
}

export function makeRateLimiter(opts: RateLimitOpts = {}) {
  const burstWindowMs = opts.burstWindowMs ?? 60_000;   // 1 minute
  const burstLimit = opts.burstLimit ?? 5;              // 5 per minute per IP (demo-friendly)
  const hourMs = opts.hourMs ?? 3_600_000;
  const perIpPerHour = opts.perIpPerHour ?? 30;
  const globalPerHour = opts.globalPerHour ?? 300;
  const hits = new Map<string, number[]>();

  const countWithin = (key: string, windowMs: number, now: number) =>
    (hits.get(key) ?? []).filter((t) => t > now - windowMs).length;
  const record = (key: string, now: number) => {
    const arr = (hits.get(key) ?? []).filter((t) => t > now - hourMs);
    arr.push(now);
    hits.set(key, arr);
  };

  return function check(ip: string, now: number = Date.now()): { ok: boolean; reason?: string } {
    const ipKey = `ip:${ip}`;
    if (countWithin(ipKey, burstWindowMs, now) >= burstLimit) return { ok: false, reason: "burst" };
    if (countWithin(ipKey, hourMs, now) >= perIpPerHour) return { ok: false, reason: "ip-hour" };
    if (countWithin("global", hourMs, now) >= globalPerHour) return { ok: false, reason: "global-hour" };
    record(ipKey, now);
    record("global", now);
    return { ok: true };
  };
}

/** Process-wide singleton used by the route. */
export const checkRateLimit = makeRateLimiter();
