/**
 * Daily free allowance for built-in Claude (when HyperMixer pays).
 * Counts per device and per network address for the current UTC day.
 * Uses Vercel KV / Upstash Redis when KV_REST_API_URL and KV_REST_API_TOKEN are set,
 * so counts hold across servers; without them it counts in memory per server instance.
 */
const LIMIT = Math.max(1, Number(process.env.HDS_DAILY_LIMIT) || 20);
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const mem = new Map<string, number>();

const day = () => new Date().toISOString().slice(0, 10);

async function incr(key: string): Promise<number> {
  if (URL_ && TOKEN) {
    const res = await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, "172800"]]),
    });
    const out = (await res.json().catch(() => [])) as { result?: number }[];
    const n = Number(out?.[0]?.result);
    if (Number.isFinite(n)) return n;
  }
  const n = (mem.get(key) ?? 0) + 1;
  if (mem.size > 50_000) mem.clear();
  mem.set(key, n);
  return n;
}

const clean = (s: string) => s.replace(/[^\w.:-]/g, "").slice(0, 64);

export const dailyLimit = LIMIT;

/** Spends one action. Returns how many are left today, or -1 if the allowance is used up. */
export async function spend(req: Request): Promise<number> {
  const device = clean(req.headers.get("x-hm-device") || "") || "none";
  const ip = clean((req.headers.get("x-forwarded-for") || "").split(",")[0].trim()) || "none";
  const d = day();
  const [byDevice, byIp] = await Promise.all([incr(`hm:a:${d}:d:${device}`), incr(`hm:a:${d}:i:${ip}`)]);
  // A shared office network gets room for a few people; one device gets the daily limit.
  if (byDevice > LIMIT || byIp > LIMIT * 5) return -1;
  return LIMIT - byDevice;
}
