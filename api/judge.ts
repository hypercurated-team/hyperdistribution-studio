import Anthropic from "@anthropic-ai/sdk";
import { personFrom } from "./_lib/firebase.js";

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
 *   the guess snaps to the nearest step of a 13-step list (1K, 2K, 5K … 5M, 10M+).
 *   Same step as the real count = 3, the step next to it = 1, else 0.
 *
 * Reply: { line, band, points, followers, handle, total, streak }. `line` is the
 * short text the shortcut shows as a notification. Problems also answer 200 with
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
    if (op === "ZREVRANK" || op === "ZSCORE") {
      const board = JSON.parse(live || "{}") as Record<string, number>;
      if (!(args[0] in board)) return null;
      return op === "ZSCORE" ? String(board[args[0]]) : Object.entries(board).sort((a, b) => b[1] - a[1]).findIndex(([m]) => m === args[0]);
    }
    if (op === "HSET" || op === "HMGET") {
      const h = JSON.parse(live || "{}") as Record<string, string>;
      if (op === "HMGET") return args.map((f) => h[f] ?? null);
      h[args[0]] = args[1];
      mem.set(key, { v: JSON.stringify(h), exp: Infinity });
      return 1;
    }
    return null;
  });
}

/* ---------- scoring ---------- */
/** The scrollable guess list: about two steps per 10x, so one flick covers 1K to 10M+. */
export const STEPS = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7];
export const RANGES = STEPS.map((v, i) => ({ label: short(v) + (i === STEPS.length - 1 ? "+" : ""), value: v }));
const BANDS = { nailed: { name: "Nailed it", points: 3 }, close: { name: "Close", points: 1 }, miss: { name: "Miss", points: 0 } };

/** "10K", "1.5M", "42000", "10M+" → a number of followers. */
export function readGuess(raw: unknown): { value: number } | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[,\s]/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)([KMB]?)\+?$/);
  if (!m) return null;
  const value = Number(m[1]) * (({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[m[2]] ?? 1);
  return value > 0 ? { value } : null;
}

/** Which list step a number is closest to (on a log scale). */
export function step(n: number) {
  let best = 0;
  for (let i = 1; i < STEPS.length; i++) if (Math.abs(Math.log(n / STEPS[i])) < Math.abs(Math.log(n / STEPS[best]))) best = i;
  return best;
}

/** Same step as the real count = 3, the step next to it = 1, anything else = 0. */
export function score(guess: { value: number }, actual: number) {
  const d = Math.abs(step(guess.value) - step(Math.max(actual, 1)));
  return d === 0 ? BANDS.nailed : d === 1 ? BANDS.close : BANDS.miss;
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

const NOT_HANDLES = new Set(["follow", "following", "reels", "reel", "sponsored", "original", "audio", "liked", "share", "more", "verified"]);
const asHandle = (line: string) => {
  // A username, optionally followed by a short badge glyph that OCR reads as ©, ⊙, ✓, O …
  const m = line.trim().match(/^@?([A-Za-z0-9._]{2,30})(?:\s+\S{1,2})?$/u);
  if (!m) return null;
  const h = m[1].toLowerCase();
  // Like/share counts ("11.5K", "1,851") look like usernames to a regex; they aren't.
  if (/^[\d.,]+[kmb]?$/i.test(h) || NOT_HANDLES.has(h) || !/[a-z]/i.test(h)) return null;
  return h;
};

/**
 * The reel's creator from the screenshot text, without guessing: Instagram puts the
 * username right before its "Follow" button (sometimes with a label like "AI content"
 * or "Sponsored" in between). Returns null when the layout doesn't show that.
 */
export function handleFromText(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const same = lines[i].match(/^@?([A-Za-z0-9._]{2,30})\s*[•·]?\s*(?:Follow|Following)$/i);
    if (same && asHandle(same[1])) return asHandle(same[1]);
    if (!/^(?:Follow|Following)$/i.test(lines[i])) continue;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      // Collab reels show "creator and partner" (or "and 2 others"): the first name posted it.
      const collab = lines[j].match(/^@?([A-Za-z0-9._]{2,30})(?:\s+\S{1,2})?\s+and\s+\S+/i);
      const h = asHandle(collab ? collab[1] : lines[j]);
      if (h) return h;
    }
    // Some OCR orders put the name just after the button, but never a count or the caption.
    const next = lines[i + 1] && asHandle(lines[i + 1]);
    if (next) return next;
  }
  return null;
}

/**
 * Instagram's official count: Graph API Business Discovery, through one of our own
 * Instagram professional accounts. Works for creator and business profiles (most reel
 * creators); returns null for personal accounts or when it isn't set up.
 *   IG_USER_ID       the Instagram professional account id that asks (instagram_business_account)
 *   IG_ACCESS_TOKEN  a long-lived token with instagram_basic + pages_show_list (+ business_management)
 *   IG_GRAPH_VERSION optional, e.g. v23.0
 */
export async function businessDiscovery(handle: string): Promise<number | null> {
  const id = process.env.IG_USER_ID;
  const token = process.env.IG_ACCESS_TOKEN;
  if (!id || !token) return null;
  const v = process.env.IG_GRAPH_VERSION || "v23.0";
  const fields = `business_discovery.username(${handle}){followers_count,username}`;
  const url = `https://graph.facebook.com/${v}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { business_discovery?: { followers_count?: number } } | null;
  const n = j?.business_discovery?.followers_count;
  return typeof n === "number" && n >= 0 ? n : null;
}

/**
 * MVP count: the follower line in the public profile page's description
 * ("12.3K Followers, 210 Following, 85 Posts"). Instagram may show a login page to
 * servers instead, in which case this returns null and Claude's search takes over.
 */
export function countFromProfileHtml(html: string): number | null {
  const tag = (html.match(/<meta[^>]*>/gi) ?? []).find((t) => /(?:property|name)="(?:og:description|description)"/i.test(t)) ?? "";
  const desc = tag.match(/content="([^"]+)"/i)?.[1] ?? "";
  const m = desc.replace(/&#\d+;|&\w+;/g, " ").match(/([\d.,]+)\s*([KMB])?\s+Followers/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[(m[2] || "").toUpperCase()] || Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function publicCount(handle: string): Promise<number | null> {
  const res = await fetch(`https://www.instagram.com/${encodeURIComponent(handle)}/`, {
    headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (compatible; HyperJudge/1.0; +https://hyperdistribution-studio.vercel.app)" },
    redirect: "follow",
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return countFromProfileHtml(await res.text().catch(() => ""));
}

const remember = async (found: Found) => {
  if (found.handle && found.followers !== null) await kv([["SET", `hj:f2:${found.handle}`, String(found.followers), "EX", String(DAY)]]);
  return found;
};

async function lookUp(text: string, handle: string | null): Promise<Found | { error: string }> {
  if (handle) {
    const cached = (await kv([["GET", `hj:f2:${handle}`]]))[0];
    if (cached) return { handle, followers: Number(cached) };
    const direct = (await businessDiscovery(handle)) ?? (await publicCount(handle));
    if (direct !== null) return remember({ handle, followers: direct });
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
    // Claude found the handle but no count: ask Instagram's API for the handle it found.
    if (found.handle && found.followers === null && found.handle !== handle) found.followers = (await businessDiscovery(found.handle)) ?? (await publicCount(found.handle));
    return remember(found);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { error: "HyperJudge is busy. Try again in a minute." };
    return { error: "Couldn't reach the lookup right now. Try again." };
  }
}

/* ---------- handlers ---------- */
const playerId = (raw: unknown) => String(raw ?? "").trim().replace(/[^\p{L}\p{N} ._'-]/gu, "").slice(0, 40) || "Player";
const today = () => new Date().toISOString().slice(0, 10);

/** Board member for a player: the account id when signed in, else "~name" (old shortcut, no account). */
async function whoPlays(req: Request, raw: unknown, code?: unknown): Promise<{ member: string; name: string; uid: string | null }> {
  const typed = String(raw ?? "").trim() ? playerId(raw) : "";
  const who = await personFrom(req).catch(() => null);
  if (who && who !== "bad") {
    const name = typed && typed !== "iPhone" ? typed : who.email.split("@")[0] || "Player";
    return { member: who.uid, name, uid: who.uid };
  }
  // The shortcut can't sign in, so it carries the player's leaderboard code instead.
  const c = cleanCode(code);
  if (c) {
    const uid = (await kv([["GET", `hj:code:${c}`]]))[0] as string | null;
    if (uid) {
      const name = (((await kv([["HMGET", "hj:n", uid]]))[0] as (string | null)[] | null) ?? [])[0] || "Player";
      return { member: uid, name, uid };
    }
  }
  const name = typed || "Player";
  return { member: `~${name}`, name, uid: null };
}

/** "hj-7k2m9q", " HJ7K2M9Q " → "HJ-7K2M9Q", anything else → null. */
export function cleanCode(raw: unknown): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^HJ/, "");
  return s.length === 6 ? `HJ-${s}` : null;
}

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "HJ-" + Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/**
 * GET /api/judge?code=1 (signed in): your personal leaderboard code, made once and kept.
 * The shortcut sends it with each round so its points land on your name.
 */
async function myCode(req: Request) {
  const who = await personFrom(req).catch(() => null);
  if (!who || who === "bad") return json({ error: "Sign in to get your code." }, 401);
  const [have, nameRaw] = await kv([["GET", `hj:ucode:${who.uid}`], ["HMGET", "hj:n", who.uid]]);
  const name = ((nameRaw as (string | null)[] | null) ?? [])[0];
  if (!name) await kv([["HSET", "hj:n", who.uid, who.email.split("@")[0] || "Player"]]);
  if (typeof have === "string" && have) return json({ code: have });
  const code = newCode();
  await kv([["SET", `hj:code:${code}`, who.uid], ["SET", `hj:ucode:${who.uid}`, code]]);
  return json({ code });
}

/**
 * GET /api/judge?board=1[&period=all]  the top 50 for today (default) or all time, with names.
 * With a signed-in Bearer token it also returns your own rank as `me`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.has("code")) return myCode(req);
  if (!url.searchParams.has("board")) return json({ ok: true, ranges: RANGES.map((r) => r.label) });
  const all = url.searchParams.get("period") === "all";
  const zkey = all ? "hj:b:all" : `hj:b:${today()}`;
  const who = await personFrom(req).catch(() => null);
  const uid = who && who !== "bad" ? who.uid : null;
  const [flatRaw, myRank, myScore] = await kv([
    ["ZREVRANGE", zkey, "0", "49", "WITHSCORES"],
    ...(uid ? [["ZREVRANK", zkey, uid], ["ZSCORE", zkey, uid]] : []),
  ]);
  const flat = (flatRaw as string[] | null) ?? [];
  const members: string[] = [];
  const points: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) { members.push(flat[i]); points.push(Number(flat[i + 1])); }
  const ids = members.filter((m) => !m.startsWith("~"));
  const names = ids.length ? (((await kv([["HMGET", "hj:n", ...ids]]))[0] as (string | null)[] | null) ?? []) : [];
  const nameOf = new Map(ids.map((m, i) => [m, names[i] || "Player"]));
  const board = members.map((m, i) => ({
    rank: i + 1,
    name: m.startsWith("~") ? m.slice(1) : nameOf.get(m) ?? "Player",
    points: points[i],
    me: !!uid && m === uid,
  }));
  const me = uid && myRank !== null && myRank !== undefined ? { rank: Number(myRank) + 1, points: Number(myScore || 0) } : null;
  return json({ period: all ? "all" : "today", day: today(), board, me });
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
  if (!guess) return { line: "Pick a guess first, e.g. 10K or 2M.", error: "no_guess" };
  const handle = cleanHandle(body.handle);
  const text = typeof body.text === "string" ? body.text : "";
  if (!handle && text.trim().length < 2) return { line: "Couldn't read this screen. Open a reel and try again.", error: "no_text" };

  const found = await lookUp(text, handle ?? handleFromText(text));
  if ("error" in found) return { line: found.error, error: "lookup" };
  if (!found.handle) return { line: "Couldn't spot the creator on this screen. Try when their name is showing.", error: "no_handle" };
  if (found.followers === null) return { line: `Couldn't find @${found.handle}'s follower count. No points this time.`, handle: found.handle, error: "no_count" };

  const band = score(guess, found.followers);
  const player = await whoPlays(req, body.player, body.code);
  const key = `hj:p:${player.member}`;
  const prev = JSON.parse(String((await kv([["GET", key]]))[0] || "{}")) as { total?: number; streak?: number };
  const streak = band.points > 0 ? (prev.streak || 0) + 1 : 0;
  const total = (prev.total || 0) + band.points;
  await kv([
    ["SET", key, JSON.stringify({ total, streak }), "EX", String(90 * DAY)],
    ["ZINCRBY", `hj:b:${today()}`, String(band.points), player.member],
    ["EXPIRE", `hj:b:${today()}`, String(3 * DAY)],
    ["ZINCRBY", "hj:b:all", String(band.points), player.member],
    ...(player.uid ? [["HSET", "hj:n", player.uid, player.name]] : []),
  ]);

  // Three short lines: the verdict, the real answer, your running score.
  const head = band.points === 3 ? "🎯 Nailed it! +3" : band.points === 1 ? "👍 Close! +1" : "❌ Miss";
  const said = String(body.guess).trim().toUpperCase();
  const line = `${head}\n@${found.handle} has ${short(found.followers)} · you said ${said}\nYour score: ${total}${streak > 1 ? ` · 🔥 ${streak} in a row` : ""}`;
  return { line, band: band.name, points: band.points, followers: found.followers, handle: found.handle, total, streak, signedIn: !!player.uid };
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
