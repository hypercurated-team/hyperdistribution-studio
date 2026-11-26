import Anthropic from "@anthropic-ai/sdk";

/**
 * HyperJudge: guess a reel creator's follower count.
 *
 * The iPhone shortcut (AssistiveTouch → HyperJudge) takes one screenshot of the
 * reel, reads its text on the device, asks for a guess and POSTs here:
 *   { text: "<text read from the screenshot>", guess: "10K", player: "<device name>" }
 * or, when the person already knows the account: { handle: "someaccount", guess: "1M" }.
 *
 * Claude picks out the creator's handle from the screenshot text and looks up
 * the follower count with web search. Counts are cached for a day.
 *
 * Scoring (kept simple on purpose):
 *   a range guess (1K / 10K / 100K / 1M / 10M+): right range = 3, next range = 1, else 0
 *   a number guess (e.g. 42000): within 25% = 3, within 2× = 1, else 0
 *
 * Reply: { line, band, points, followers, handle, total, streak }. `line` is the
 * one sentence the shortcut shows as a notification. Problems also answer 200 with
 * a `line` (and an `error` code), so the shortcut always has something to show.
 *
 * GET /api/judge?board=1 → today's top players.
 *
 * Uses HyperMixer's built-in Claude key (ANTHROPIC_API_KEY + HDS_SHARED_KEY=true).
 * Scores and the cache use Vercel KV / Upstash when KV_REST_API_URL and
 * KV_REST_API_TOKEN are set, otherwise memory (lost when the server sleeps).
 */
export const config = { maxDuration: 60 };

const MODEL = process.env.HDS_MODEL || "claude-opus-5-5";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const DAY = 86_400;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/* ---------- tiny key-value store ---------- */
const mem = new Map<string, { v: string; exp: number }>();
async function kv(cmd: string[][]): Promise<unknown[]> {
  if (KV_URL && KV_TOKEN) {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${KV_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(cmd),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { result?: unknown }[] | null;
    if (Array.isArray(out)) return out.map((o) => o?.result ?? null);
  }
  // In-memory fallback: supports the few commands used here.
  const now = Date.now();
  return cmd.map(([op, key, ...args]) => {
    const hit = mem.get(key);
    const live = hit && hit.exp > now ? hit.v : null;
    if (op === "GET") return live;
    if (op === "SET") {
      const ex = args.indexOf("EX");
      mem.set(key, { v: args[0], exp: ex >= 0 ? now + Number(args[ex + 1]) * 1000 : Infinity });
      return "OK";
    }
    if (op === "ZINCRBY") {
      const board = JSON.parse(live || "{}") as Record<string, number>;
      board[args[1]] = (board[args[1]] || 0) + Number(args[0]);
      mem.set(key, { v: JSON.stringify(board), exp: now + 2 * DAY * 1000 });
      return board[args[1]];
    }
    if (op === "ZREVRANGE") {
      const board = JSON.parse(live || "{}") as Record<string, number>;
      return Object.entries(board).sort((a, b) => b[1] - a[1]).slice(0, Number(args[1]) + 1).flat().map(String);
    }
    return null;
  });
}

/* ---------- scoring ---------- */
export const RANGES = [
  { label: "1K", lo: 0, hi: 5_000 },
  { label: "10K", lo: 5_000, hi: 50_000 },
  { label: "100K", lo: 50_000, hi: 500_000 },
  { label: "1M", lo: 500_000, hi: 5_000_000 },
  { label: "10M+", lo: 5_000_000, hi: Infinity },
];
const BANDS = { nailed: { name: "Nailed it", points: 3 }, close: { name: "Close", points: 1 }, miss: { name: "Miss", points: 0 } };

/** "10K", "1.5M", "42000", "10M+" → a number, or a range index when it names a range. */
export function readGuess(raw: unknown): { range?: number; value?: number } | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[,\s]/g, "");
  const r = RANGES.findIndex((x) => x.label === s || x.label === s + "+");
  if (r >= 0) return { range: r };
  const m = s.match(/^(\d+(?:\.\d+)?)([KMB]?)\+?$/);
  if (!m) return null;
  const value = Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[m[2]] || Number(m[1]);
  return value > 0 ? { value } : null;
}

export function score(guess: { range?: number; value?: number }, actual: number) {
  if (guess.range !== undefined) {
    const at = RANGES.findIndex((x) => actual >= x.lo && actual < x.hi);
    const d = Math.abs(at - guess.range);
    return d === 0 ? BANDS.nailed : d === 1 ? BANDS.close : BANDS.miss;
  }
  const v = guess.value!;
  const r = Math.max(v / actual, actual / v);
  return r <= 1.25 ? BANDS.nailed : r <= 2 ? BANDS.close : BANDS.miss;
}

export function short(n: number) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

/* ---------- creator lookup (Claude + web search) ---------- */
type Found = { handle: string | null; followers: number | null };

const cleanHandle = (h: unknown) => {
  const s = String(h ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
};

function parseJson(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function lookUp(text: string, handle: string | null): Promise<Found | { error: string }> {
  if (handle) {
    const cached = (await kv([["GET", `hj:f2:${handle}`]]))[0];
    if (cached) return { handle, followers: Number(cached) };
  }
  if (!(process.env.HDS_SHARED_KEY === "true" && process.env.ANTHROPIC_API_KEY)) return { error: "Claude isn't switched on for HyperMixer yet." };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const task = handle
    ? `Find the current Instagram follower count of the account @${handle}.`
    : `Below is text read from a screenshot of an Instagram reel. Work out the Instagram username of the account that posted the reel (it usually sits next to the avatar near the bottom, often beside a "Follow" button). Ignore tagged accounts, audio/song names, comments and the viewer's own UI text. Then find that account's current follower count.\n\nScreenshot text:\n"""\n${text.slice(0, 4000)}\n"""`;
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools: [
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 },
        { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      ],
      system:
        "You look up Instagram follower counts. Once you know the username, first fetch https://www.instagram.com/<username>/ (its page description usually reads like \"12.3K Followers, 210 Following, 85 Posts\"). If that page gives no count, use web search (social stats sites, recent articles, the creator's other profiles). Reply with only JSON: {\"handle\": \"username without @, or null if you can't tell\", \"followers\": the follower count as a whole number, or null}. Use null rather than guessing a count you didn't find; never answer 0 unless a page says 0.",
      messages: [{ role: "user", content: task }],
    });
    if (res.stop_reason === "refusal") return { error: "Couldn't look that account up." };
    const textOut = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const out = parseJson(textOut);
    const h = cleanHandle(out?.handle) ?? handle;
    // A missing count must stay missing: Number(null) is 0, which once scored as a real answer.
    const raw = out?.followers;
    const f = typeof raw === "number" ? Math.round(raw) : typeof raw === "string" ? (readGuess(raw)?.value ?? NaN) : NaN;
    const found: Found = { handle: h, followers: Number.isFinite(f) && f > 0 ? Math.round(f) : null };
    if (found.handle && found.followers !== null) await kv([["SET", `hj:f2:${found.handle}`, String(found.followers), "EX", String(DAY)]]);
    return found;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { error: "HyperJudge is busy. Try again in a minute." };
    return { error: "Couldn't reach the lookup right now. Try again." };
  }
}

/* ---------- handlers ---------- */
const playerId = (raw: unknown) => String(raw ?? "").trim().replace(/[^\p{L}\p{N} ._'-]/gu, "").slice(0, 40) || "Player";
const today = () => new Date().toISOString().slice(0, 10);

/** Today's leaderboard. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!url.searchParams.has("board")) return json({ ok: true, ranges: RANGES.map((r) => r.label) });
  const flat = ((await kv([["ZREVRANGE", `hj:b:${today()}`, "0", "19", "WITHSCORES"]]))[0] as string[] | null) ?? [];
  const board: { player: string; points: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) board.push({ player: flat[i], points: Number(flat[i + 1]) });
  return json({ day: today(), board });
}

/** One round: work out the creator, look up followers, score the guess. */
async function round(req: Request): Promise<Record<string, unknown> & { line: string }> {
  let body: Record<string, unknown> = {};
  try {
    const type = req.headers.get("content-type") || "";
    body = type.includes("json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return { line: "HyperJudge couldn't read that. Update the shortcut.", error: "bad_body" };
  }
  const guess = readGuess(body.guess);
  if (!guess) return { line: "Pick a guess first: 1K, 10K, 100K, 1M or 10M+.", error: "no_guess" };
  const handle = cleanHandle(body.handle);
  const text = typeof body.text === "string" ? body.text : "";
  if (!handle && text.trim().length < 2) return { line: "Couldn't read this screen. Open a reel and try again.", error: "no_text" };

  const found = await lookUp(text, handle);
  if ("error" in found) return { line: found.error, error: "lookup" };
  if (!found.handle) return { line: "Couldn't spot the creator on this screen. Try when their name is showing.", error: "no_handle" };
  if (found.followers === null) return { line: `Couldn't find @${found.handle}'s follower count. No points this time.`, handle: found.handle, error: "no_count" };

  const band = score(guess, found.followers);
  const player = playerId(body.player);
  const key = `hj:p:${player}`;
  const prev = JSON.parse(String((await kv([["GET", key]]))[0] || "{}")) as { total?: number; streak?: number };
  const streak = band.points > 0 ? (prev.streak || 0) + 1 : 0;
  const total = (prev.total || 0) + band.points;
  await kv([
    ["SET", key, JSON.stringify({ total, streak }), "EX", String(90 * DAY)],
    ["ZINCRBY", `hj:b:${today()}`, String(band.points), player],
    ["EXPIRE", `hj:b:${today()}`, String(3 * DAY)],
  ]);

  // Three short lines: the verdict, the real answer, your running score.
  const head = band.points === 3 ? "🎯 Nailed it! +3" : band.points === 1 ? "👍 Close! +1" : "❌ Miss";
  const line = `${head}\nReal answer: ${short(found.followers)} followers\nYour score: ${total}${streak > 1 ? ` · 🔥 ${streak} in a row` : ""}`;
  return { line, band: band.name, points: band.points, followers: found.followers, handle: found.handle, total, streak };
}

/**
 * One round. The shortcut calls /api/judge?format=text and shows the reply as-is,
 * so anything that goes wrong still reads as a sentence on the phone.
 */
export async function POST(req: Request) {
  const out = await round(req);
  if (new URL(req.url).searchParams.get("format") === "text") {
    return new Response(out.line, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return json(out);
}
