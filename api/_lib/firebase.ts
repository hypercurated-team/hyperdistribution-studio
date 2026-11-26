import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

/**
 * HyperMixer accounts run on Firebase Authentication.
 *
 * The web config is public by design (Firebase protects accounts with
 * authorized domains, not by hiding the API key). ID tokens are checked here
 * against Google's published signing keys, so no service account or secret is
 * needed on this server.
 *
 * Accounts live in the Hypercurated Firebase project, shared with the
 * Hypercurated app (its public web config, below). Env vars override it:
 *   FIREBASE_PROJECT_ID  FIREBASE_API_KEY  FIREBASE_APP_ID  FIREBASE_AUTH_DOMAIN
 * Set HM_SIGNIN=off to hide sign-in.
 */
const env = (k: string) => process.env[k] || "";

// Public client config (the same values ship inside the Hypercurated apps).
const DEFAULT = {
  projectId: "hypercurated-app-99068",
  apiKey: "AIzaSyCK-TzfSloJ0owjLX4B-Gvw99P2alIbRh0",
  appId: "1:912782859887:web:04b291c3e9ed9d5807f79a",
  authDomain: "hypercurated-app-99068.firebaseapp.com",
};

export const firebaseConfig = () => {
  if (env("HM_SIGNIN") === "off") return null;
  const projectId = env("FIREBASE_PROJECT_ID") || DEFAULT.projectId;
  const apiKey = env("FIREBASE_API_KEY") || (projectId === DEFAULT.projectId ? DEFAULT.apiKey : "");
  if (!projectId || !apiKey) return null;
  const same = projectId === DEFAULT.projectId;
  return {
    apiKey, projectId,
    authDomain: env("FIREBASE_AUTH_DOMAIN") || (same ? DEFAULT.authDomain : `${projectId}.firebaseapp.com`),
    appId: env("FIREBASE_APP_ID") || (same ? DEFAULT.appId : ""),
  };
};

/** Which of Apple / Google / Microsoft are switched on in Firebase (checked every 10 minutes). */
let providers: { at: number; on: Record<string, boolean> } | null = null;
export async function enabledProviders(): Promise<Record<string, boolean>> {
  const cfg = firebaseConfig();
  if (!cfg) return {};
  if (providers && Date.now() - providers.at < 600_000) return providers.on;
  const ids = { apple: "apple.com", google: "google.com", microsoft: "microsoft.com" };
  const on: Record<string, boolean> = {};
  await Promise.all(Object.entries(ids).map(async ([k, providerId]) => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${cfg.apiKey}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId, continueUri: `https://${cfg.authDomain}/__/auth/handler` }),
    }).catch(() => null);
    on[k] = !!r?.ok;
  }));
  providers = { at: Date.now(), on };
  return on;
}

const JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let keys: { at: number; ttl: number; byKid: Map<string, JsonWebKey> } | null = null;

async function signingKey(kid: string): Promise<JsonWebKey | undefined> {
  if (!keys || Date.now() - keys.at > keys.ttl || !keys.byKid.has(kid)) {
    const r = await fetch(JWKS);
    if (!r.ok) throw new Error(`keys ${r.status}`);
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") || "")?.[1]) || 3600;
    const j = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
    keys = { at: Date.now(), ttl: Math.min(maxAge, 6 * 3600) * 1000, byKid: new Map(j.keys.map((k) => [k.kid, k])) };
  }
  return keys.byKid.get(kid);
}

export type Person = { uid: string; email: string };

/** Checks a Firebase ID token. Returns who it belongs to, or null if it isn't valid. */
export async function verifyIdToken(token: string): Promise<Person | null> {
  const projectId = firebaseConfig()?.projectId;
  const parts = token.split(".");
  if (!projectId || parts.length !== 3) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as { alg?: string; kid?: string };
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
      aud?: string; iss?: string; sub?: string; exp?: number; iat?: number; auth_time?: number; email?: string;
    };
    if (head.alg !== "RS256" || !head.kid) return null;
    const now = Date.now() / 1000;
    if (body.aud !== projectId || body.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!body.sub || body.sub.length > 128 || !body.exp || body.exp < now - 30 || (body.iat ?? 0) > now + 300 || (body.auth_time ?? 0) > now + 300) return null;
    // A failure to fetch Google's keys is thrown (not "invalid"), so nobody is signed out by an outage.
    let jwk: JsonWebKey | undefined;
    try { jwk = await signingKey(head.kid); } catch (e) { throw Object.assign(new Error("keys unavailable"), { cause: e, keysDown: true }); }
    if (!jwk) return null;
    const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    return ok ? { uid: body.sub, email: body.email ?? "" } : null;
  } catch (e) {
    if ((e as { keysDown?: boolean }).keysDown) throw e;
    return null;
  }
}

/** The signed-in person behind a request (Authorization: Bearer <ID token>), null if signed out, "bad" if the token is wrong. */
export async function personFrom(req: Request): Promise<Person | null | "bad"> {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return (await verifyIdToken(h.slice(7).trim())) ?? "bad"; }
  catch { return null; } // couldn't check right now: count it as signed out, not as a bad sign-in
}
