import { configured, isProvider, open, pkce, PROVIDERS, redirectUri, seal, tokenRequest, type Grant, type ProviderId, type State } from "./_lib/cloud.js";

export const config = { maxDuration: 30 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * GET  /api/oauth                       which providers are set up on this site
 * GET  /api/oauth?provider=x&ret=app|web&nonce=n   the provider's sign-in URL (JSON)
 * POST /api/oauth {grant}               a short-lived access token for a saved grant
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("provider");
  if (!p) return json({ providers: Object.fromEntries((Object.keys(PROVIDERS) as ProviderId[]).map((k) => [k, configured(k)])) });
  if (!isProvider(p) || !configured(p)) return json({ error: "That sign-in isn't set up on this site yet." }, 400);
  const ret = url.searchParams.get("ret") === "app" ? "app" : "web";
  const nonce = (url.searchParams.get("nonce") || "").slice(0, 64);
  const { verifier, challenge } = pkce();
  const state: State = { p, v: verifier, ret, o: url.origin, n: nonce, t: Date.now() };
  const P = PROVIDERS[p];
  const q = new URLSearchParams({
    client_id: P.id(), redirect_uri: redirectUri(url.origin), response_type: "code", scope: P.scope,
    state: seal(state), code_challenge: challenge, code_challenge_method: "S256", ...P.extra,
  });
  return json({ url: `${P.authorize}?${q}` });
}

export async function POST(req: Request) {
  let body: { grant?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const g = open<Grant>(String(body.grant || ""));
  if (!g || !isProvider(g.p) || !configured(g.p)) return json({ error: "Sign in again.", code: "reauth" }, 401);
  try {
    const t = await tokenRequest(g.p, { grant_type: "refresh_token", refresh_token: g.r });
    // Some providers rotate refresh tokens: hand back a new grant when they do.
    return json({ accessToken: t.access_token, expiresIn: t.expires_in ?? 3600, ...(t.refresh_token && t.refresh_token !== g.r ? { grant: seal({ p: g.p, r: t.refresh_token }) } : {}) });
  } catch {
    return json({ error: "Sign in again.", code: "reauth" }, 401);
  }
}
