import { apiUrl, isNative, postToApp } from "./platform";

/**
 * HyperMixer accounts (Firebase Authentication).
 *
 * One session model everywhere: a Firebase refresh token kept on this device,
 * exchanged for short-lived ID tokens through Firebase's REST endpoints. The
 * server checks those ID tokens (api/_lib/firebase.ts), so the daily AI
 * allowance follows the person, not the device.
 *
 * Email and password go straight to Firebase's REST API. Apple, Google and
 * Microsoft use Firebase's own sign-in popup, loaded only when needed. Inside
 * the iOS / Android app that popup can't run (Google refuses embedded web
 * views), so the app opens this site in the phone's browser (?signin=…), the
 * person signs in there, and the browser hands the session back through
 * hypermixer://auth, encrypted with a key that never left the app.
 */
export type Provider = "apple" | "google" | "microsoft";
type Config = { apiKey: string; authDomain: string; projectId: string; appId: string };
export type Session = { uid: string; email: string; name: string; provider: string; refresh: string; id: string; exp: number };

const KEY = "hm:auth";
const SKIP = "hm:auth-skip";
const HANDOFF = "hm:auth-handoff";

const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || "null") as T; } catch { return null; } };
const write = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const state = {
  /** Sign-in is set up on this site. */
  enabled: false,
  /** Built-in AI needs an account (HM_REQUIRE_SIGNIN). */
  required: false,
  session: read<Session>(KEY),
  skipped: !!read<boolean>(SKIP),
  /** Which of Apple / Google / Microsoft are switched on. */
  providers: {} as Partial<Record<Provider, boolean>>,
  /** The app shell can open a page in the phone's browser (added in an over-the-air update). */
  shellCanOpen: false,
};
let cfg: Config | null = null;

const changed = () => window.dispatchEvent(new Event("hm:auth"));
const save = (s: Session | null) => { state.session = s; write(KEY, s); changed(); };

const fail = (m: string) => Object.assign(new Error(m), { code: "auth" });

/** Firebase REST error codes, in plain words. */
function words(code = ""): string {
  const c = code.split(" ")[0].split(":")[0];
  return ({
    EMAIL_EXISTS: "That email already has an account. Sign in instead.",
    INVALID_LOGIN_CREDENTIALS: "That email and password don't match.",
    INVALID_PASSWORD: "That email and password don't match.",
    EMAIL_NOT_FOUND: "That email and password don't match.",
    INVALID_EMAIL: "That doesn't look like an email address.",
    MISSING_PASSWORD: "Enter a password.",
    WEAK_PASSWORD: "Use at least 6 characters for the password.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries. Wait a few minutes and try again.",
    USER_DISABLED: "This account has been turned off.",
    OPERATION_NOT_ALLOWED: "Email sign-in isn't switched on yet.",
    CREDENTIAL_TOO_OLD_LOGIN_AGAIN: "For your safety, sign out, sign back in, then try again.",
  } as Record<string, string>)[c] ?? "Sign-in didn't work. Try again.";
}

async function rest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!cfg) throw fail("Sign-in isn't set up on this site yet.");
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) throw fail("No connection. Try again.");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(words(j?.error?.message));
  return j as T;
}

type Rest = { localId: string; email?: string; displayName?: string; idToken: string; refreshToken: string; expiresIn: string };
const fromRest = (j: Rest, provider: string): Session => ({
  uid: j.localId, email: j.email ?? "", name: j.displayName ?? "", provider,
  refresh: j.refreshToken, id: j.idToken, exp: Date.now() + Number(j.expiresIn || 3600) * 1000,
});

// ---- Apple / Google / Microsoft through Firebase's popup -------------------------------------------

type Firebase = { A: typeof import("firebase/auth"); auth: import("firebase/auth").Auth };
let fb: Firebase | null = null;
let loading: Promise<void> | null = null;

/** Loads Firebase's sign-in code ahead of the tap: Safari only allows the sign-in window straight from a tap. */
function prepare(): Promise<void> {
  if (fb || !cfg) return Promise.resolve();
  loading ??= (async () => {
    const [{ initializeApp, getApps }, A] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps().find((a) => a.name === "hm") ?? initializeApp(cfg!, "hm");
    fb = { A, auth: A.initializeAuth(app, { persistence: A.inMemoryPersistence, popupRedirectResolver: A.browserPopupRedirectResolver }) };
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

function popup(p: Provider): Promise<Session> {
  if (!cfg) return Promise.reject(fail("Sign-in isn't set up on this site yet."));
  if (!fb) return prepare().then(() => popup(p)); // not preloaded: may be blocked as a pop-up, the error says so
  const { A, auth: fa } = fb;
  let provider: InstanceType<typeof A.GoogleAuthProvider> | InstanceType<typeof A.OAuthProvider>;
  if (p === "google") { provider = new A.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" }); }
  else if (p === "apple") { provider = new A.OAuthProvider("apple.com"); provider.addScope("email"); provider.addScope("name"); }
  else { provider = new A.OAuthProvider("microsoft.com"); provider.setCustomParameters({ prompt: "select_account" }); }
  // Called in the same tick as the tap, so the browser lets the window open.
  return A.signInWithPopup(fa, provider).then(async ({ user }) => {
    const t = await user.getIdTokenResult();
    return {
      uid: user.uid, email: user.email ?? "", name: user.displayName ?? "", provider: p,
      refresh: user.refreshToken, id: t.token, exp: Date.parse(t.expirationTime) || Date.now() + 3600_000,
    };
  }, (e) => {
    const code = (e as { code?: string }).code ?? "";
    if (/popup-closed|cancelled-popup|user-cancelled/.test(code)) throw fail("Sign-in was cancelled.");
    if (/popup-blocked/.test(code)) throw fail("Your browser blocked the sign-in window. Allow pop-ups and try again.");
    if (/account-exists-with-different-credential/.test(code)) throw fail("That email already signs in another way. Use the button you used before.");
    if (/operation-not-allowed|configuration-not-found|invalid-oauth-client/.test(code)) throw fail("This sign-in option isn't switched on yet.");
    if (/unauthorized-domain/.test(code)) throw fail("This site isn't allowed to sign in yet.");
    throw fail("Sign-in didn't work. Try again.");
  });
}

// ---- Hand-off from the phone's browser back to the app ---------------------------------------------

const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const aes = (raw: Uint8Array, use: KeyUsage) => crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [use]);

/** In the phone's browser: seals the session for the app with the key the app put in the link. */
export async function sealForApp(s: Session, k: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(unb64u(k), "encrypt"), new TextEncoder().encode(JSON.stringify(s)));
  return b64u(new Uint8Array([...iv, ...new Uint8Array(ct)]));
}

async function openForApp(c: string, n: string): Promise<Session | null> {
  const h = read<{ k: string; n: string; t: number }>(HANDOFF);
  if (!h || h.n !== n || Date.now() - h.t > 30 * 60_000) return null;
  try {
    const raw = unb64u(c);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aes(unb64u(h.k), "decrypt"), raw.slice(12));
    write(HANDOFF, null);
    return JSON.parse(new TextDecoder().decode(pt)) as Session;
  } catch { return null; }
}

// ---- Public API ------------------------------------------------------------------------------------

export const auth = {
  state,
  /** Loads the sign-in config and listens for a hand-off from the phone's browser. */
  async setup() {
    window.addEventListener("hm:app", (e) => {
      const m = (e as CustomEvent).detail as { type?: string; c?: string; n?: string; caps?: string[] };
      if (m?.type === "shell-info") state.shellCanOpen = !!m.caps?.includes("open-external");
      if (m?.type === "auth-result" && m.c && m.n) {
        openForApp(m.c, m.n).then((s) => {
          if (s) { save(s); window.dispatchEvent(new CustomEvent("hm:signed-in", { detail: s })); }
          else window.dispatchEvent(new CustomEvent("hm:auth-error", { detail: "That sign-in expired. Try again." }));
        });
      }
    });
    const j = await fetch(apiUrl("/api/auth")).then((r) => r.json()).catch(() => ({}));
    cfg = j.enabled ? j.config : null;
    state.enabled = !!cfg;
    state.required = !!j.requireSignIn;
    state.providers = j.providers ?? {};
    changed();
  },
  config: () => cfg,
  /** A fresh ID token for API calls, or null when signed out. */
  async idToken(): Promise<string | null> {
    const s = state.session;
    if (!s || !cfg) return null;
    if (s.exp - 60_000 > Date.now()) return s.id;
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh }),
    }).catch(() => null);
    if (!r) return s.id; // offline: let the server decide
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) {
      // The account was removed, disabled, or its sign-in revoked.
      if (/TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN|INVALID_GRANT_TYPE/.test(j?.error?.message ?? "")) save(null);
      return null;
    }
    save({ ...s, id: j.id_token, refresh: j.refresh_token || s.refresh, exp: Date.now() + Number(j.expires_in || 3600) * 1000 });
    return j.id_token;
  },
  async email(mode: "in" | "up", email: string, password: string) {
    const j = await rest<Rest>(mode === "up" ? "accounts:signUp" : "accounts:signInWithPassword", { email: email.trim(), password, returnSecureToken: true });
    save(fromRest(j, "email"));
  },
  async resetPassword(email: string) {
    await rest("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email: email.trim() });
  },
  /** Apple, Google or Microsoft. In the app this continues in the phone's browser and comes back by itself. */
  async provider(p: Provider) {
    if (!isNative) { save(await popup(p)); return; } // preloaded by the sign-in screen
    if (!state.shellCanOpen) throw fail("Close and reopen HyperMixer to finish updating, then try again.");
    const k = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const n = b64u(crypto.getRandomValues(new Uint8Array(12)));
    write(HANDOFF, { k, n, t: Date.now() });
    // The key travels in the #fragment, which browsers never send to a server.
    postToApp({ type: "open-external", url: `${location.origin}/?signin=${p}#k=${k}&n=${n}` });
  },
  /** For the page that runs in the phone's browser. */
  popup,
  prepare,
  signOut() { save(null); write(SKIP, null); state.skipped = false; changed(); },
  skip() { state.skipped = true; write(SKIP, true); changed(); },
};
