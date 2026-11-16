import { Errors } from "./errors";

type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __plRateBuckets?: Map<string, Bucket> };
const buckets = (g.__plRateBuckets ??= new Map<string, Bucket>());

let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

/**
 * Fixed-window in-memory limiter. Good for a single instance; for multi-instance
 * deployments swap this function for a Redis/Upstash-backed implementation
 * (the call signature is the only contract).
 */
export function checkRateLimit(rule: RateLimitRule, key: string, now = Date.now()): void {
  sweep(now);
  const id = `${rule.name}:${key}`;
  const b = buckets.get(id);
  if (!b || b.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + rule.windowMs });
    return;
  }
  b.count += 1;
  if (b.count > rule.limit) {
    throw Errors.rateLimited(Math.max(1, Math.ceil((b.resetAt - now) / 1000)));
  }
}

export function resetRateLimits() {
  buckets.clear();
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}
