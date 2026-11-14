const hits = new Map<string, number[]>();

/** Best-effort per-instance limiter so a public demo can't drain free LLM quotas. */
export function allow(key: string, max = Number(process.env.RATE_LIMIT_PER_10MIN ?? 8), windowMs = 600_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
