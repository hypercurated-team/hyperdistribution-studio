import Anthropic from "@anthropic-ai/sdk";
import { dailyLimit, refund, spend } from "./_lib/allowance.js";

export const config = { maxDuration: 300 };

const MODEL = process.env.HDS_MODEL || "claude-opus-5-5";

type Img = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const IMG_TYPES: string[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SYSTEM =
  "You are the planning and writing engine of a content studio. The user message describes the task and the exact JSON shape to return. Reply with only that JSON: no prose before or after, no code fences.";

const builtIn = () => process.env.HDS_SHARED_KEY === "true" && !!process.env.ANTHROPIC_API_KEY;

/** The person's own key if they added one; otherwise HyperMixer's built-in key (ANTHROPIC_API_KEY + HDS_SHARED_KEY=true). */
function keyFor(req: Request): { key: string; shared: boolean } | null {
  const user = req.headers.get("x-anthropic-key")?.trim();
  if (user) return { key: user, shared: false };
  if (builtIn()) return { key: process.env.ANTHROPIC_API_KEY!, shared: true };
  return null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Pulls the JSON value out of a reply, tolerating stray prose or code fences. */
function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new SyntaxError("no JSON");
}

/** Tells the app whether Claude is built in, so it can skip the key step. */
export async function GET() {
  return json({ builtIn: builtIn(), dailyLimit: builtIn() ? dailyLimit : 0 });
}

/** One generic endpoint: the page sends a prompt (plus optional images) and gets JSON back. */
export async function POST(req: Request) {
  const auth = keyFor(req);
  if (!auth) return json({ error: "Claude isn't switched on for HyperMixer yet.", code: "no_key" }, 401);
  const apiKey = auth.key;

  let body: { prompt?: unknown; images?: { media_type: Img; data: string }[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 200_000) : "";
  if (!prompt) return json({ error: "Empty prompt" }, 400);
  const images = (Array.isArray(body.images) ? body.images : [])
    .slice(0, 5)
    .filter((i) => !!i && IMG_TYPES.includes(i.media_type) && typeof i.data === "string");

  if (auth.shared && (await spend(req)) < 0) {
    return json({ error: `You've used today's ${dailyLimit} free AI actions. They refill tomorrow.`, code: "daily_limit" }, 429);
  }

  const ask = async (): Promise<Record<string, unknown>> => {
    const client = new Anthropic({ apiKey });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.media_type, data: i.data } })),
              { type: "text" as const, text: prompt },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal") return { error: "Claude declined this request. Try rewording it.", code: "refused" };
      if (response.stop_reason === "max_tokens") return { error: "The answer was too long. Try a smaller request.", code: "too_long" };
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { result: parseJson(text) };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return auth.shared ? { error: "Claude is unavailable right now. Try again later.", code: "unavailable" } : { error: "That API key was rejected. Check it in Connect.", code: "bad_key" };
      if (err instanceof Anthropic.RateLimitError) return { error: "Claude is busy. Try again in a minute.", code: "rate_limited" };
      if (err instanceof Anthropic.APIError) return { error: auth.shared ? "Claude is unavailable right now. Try again later." : `Claude API error ${err.status ?? ""}: ${err.message}`, code: "unavailable" };
      if (err instanceof SyntaxError) return { error: "Claude returned something unreadable. Try again.", code: "unreadable" };
      return { error: "Something went wrong talking to Claude.", code: "error" };
    }
  };

  // Phones drop a request that stays silent for about a minute ("Load failed" on iOS).
  // Claude can take longer than that, so send a space every few seconds while it writes;
  // JSON ignores leading whitespace, and errors arrive in the body as {error, code}.
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ping = setInterval(() => { try { controller.enqueue(enc.encode(" ")); } catch { /* closed */ } }, 5000);
      controller.enqueue(enc.encode(" "));
      const out = await ask();
      clearInterval(ping);
      if ("error" in out && auth.shared) await refund(req);
      controller.enqueue(enc.encode(JSON.stringify(out)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
