import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Sign-in with Google Drive, OneDrive and Dropbox (OAuth 2 with PKCE).
 *
 * Nothing is stored on the server. The PKCE verifier travels inside the
 * encrypted `state`; the refresh token goes back to the person's device
 * encrypted (a "grant") and is only ever decrypted here to mint a short-lived
 * access token. Media itself is fetched by the device straight from the
 * provider, never through this server.
 *
 * Env (set in Vercel, never in code):
 *   HM_TOKEN_KEY          32 random bytes, base64 (encrypts state and grants)
 *   GOOGLE_CLIENT_ID      GOOGLE_CLIENT_SECRET
 *   MICROSOFT_CLIENT_ID   MICROSOFT_CLIENT_SECRET
 *   DROPBOX_APP_KEY       DROPBOX_APP_SECRET
 */
export type ProviderId = "google" | "microsoft" | "dropbox";

type Provider = {
  name: string;
  id: () => string;
  secret: () => string;
  authorize: string;
  token: string;
  scope: string;
  extra: Record<string, string>;
  /** Who signed in, for the Connect row. */
  account: (accessToken: string) => Promise<string>;
};

const env = (k: string) => process.env[k] || "";

export const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    name: "Google Drive",
    id: () => env("GOOGLE_CLIENT_ID"),
    secret: () => env("GOOGLE_CLIENT_SECRET"),
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/drive.readonly openid email",
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    account: async (t) => {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${t}` } });
      return ((await r.json().catch(() => ({}))) as { email?: string }).email ?? "";
    },
  },
  microsoft: {
    name: "OneDrive",
    id: () => env("MICROSOFT_CLIENT_ID"),
    secret: () => env("MICROSOFT_CLIENT_SECRET"),
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "Files.Read offline_access User.Read",
    extra: { prompt: "select_account" },
    account: async (t) => {
      const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { authorization: `Bearer ${t}` } });
      const j = (await r.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
      return j.mail || j.userPrincipalName || "";
    },
  },
  dropbox: {
    name: "Dropbox",
    id: () => env("DROPBOX_APP_KEY"),
    secret: () => env("DROPBOX_APP_SECRET"),
    authorize: "https://www.dropbox.com/oauth2/authorize",
    token: "https://api.dropboxapi.com/oauth2/token",
    scope: "account_info.read files.metadata.read files.content.read",
    extra: { token_access_type: "offline" },
    account: async (t) => {
      const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { authorization: `Bearer ${t}` } });
      return ((await r.json().catch(() => ({}))) as { email?: string }).email ?? "";
    },
  },
};

export const isProvider = (p: unknown): p is ProviderId => p === "google" || p === "microsoft" || p === "dropbox";
export const configured = (p: ProviderId) => !!(key() && PROVIDERS[p].id() && PROVIDERS[p].secret());

function key(): Buffer | null {
  const k = env("HM_TOKEN_KEY");
  if (!k) return null;
  const b = Buffer.from(k, "base64");
  return b.length === 32 ? b : createHash("sha256").update(k).digest();
}

const b64url = (b: Buffer) => b.toString("base64url");

/** AES-256-GCM, base64url(iv | tag | ciphertext). */
export function seal(data: unknown): string {
  const k = key();
  if (!k) throw new Error("not configured");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return b64url(Buffer.concat([iv, c.getAuthTag(), body]));
}

export function open<T>(sealed: string): T | null {
  const k = key();
  if (!k || !sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}

export const pkce = () => {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
};

export const redirectUri = (origin: string) => `${origin}/api/oauth-callback`;

/** Exchanges a code or a refresh token at the provider's token endpoint. */
export async function tokenRequest(p: ProviderId, params: Record<string, string>) {
  const P = PROVIDERS[p];
  const body = new URLSearchParams({ client_id: P.id(), client_secret: P.secret(), ...params });
  const r = await fetch(P.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new Error(j.error || `token ${r.status}`);
  return j;
}

export type State = { p: ProviderId; v: string; ret: "app" | "web"; o: string; n: string; t: number };
export type Grant = { p: ProviderId; r: string };
