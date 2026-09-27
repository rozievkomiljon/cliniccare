/**
 * In-memory sliding-window rate limiter for auth-sensitive actions.
 * Deliberately simple (no Redis yet): Redis-backed distributed limiting
 * arrives with the job queue phase; per-process limiting is still a real
 * speed bump for brute force on a single-container deployment.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfterSeconds: 0 };
}
