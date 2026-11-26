import { ExtensionStorage } from "@bacons/apple-targets";
import * as WebBrowser from "expo-web-browser";

/**
 * HyperJudge accounts = HyperMixer / Hypercurated accounts (the same Firebase project).
 *
 * Email and password go straight to Firebase's REST API. Apple, Google and Microsoft open
 * HyperMixer's sign-in page in a sign-in sheet (?signin=…&app=hyperjudge), which hands the
 * refresh token back to hyperjudge://auth. The session lives in the App Group so the
 * Dynamic Island round (Swift, HJShared.swift) can send the same account to /api/judge.
 */
export const WEB = "https://hyperdistribution-studio.vercel.app";
export type Provider = "apple" | "google" | "microsoft";
export type Account = { uid: string; email: string; name: string };

const store = (() => {
  try {
    return new ExtensionStorage("group.com.kraftxworks.hyperjudge");
  } catch {
    return null;
  }
})();
export const get = (k: string) => {
  try {
    return store?.get(k) ?? null;
  } catch {
    return null;
  }
};
export const set = (k: string, v: string | null) => {
  try {
    if (v === null) store?.remove(k);
    else store?.set(k, v);
  } catch {}
};

let cfg: { apiKey: string } | null = null;
let providers: Partial<Record<Provider, boolean>> = {};

const fail = (m: string) => new Error(m);
const words = (code = "") =>
  ({
    EMAIL_EXISTS: "That email already has an account. Sign in instead.",
    INVALID_LOGIN_CREDENTIALS: "That email and password don't match.",
    INVALID_PASSWORD: "That email and password don't match.",
    EMAIL_NOT_FOUND: "That email and password don't match.",
    INVALID_EMAIL: "That doesn't look like an email address.",
    MISSING_PASSWORD: "Enter a password.",
    WEAK_PASSWORD: "Use at least 6 characters for the password.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries. Wait a few minutes and try again.",
    USER_DISABLED: "This account has been turned off.",
  })[code.split(" ")[0].split(":")[0]] ?? "Sign-in didn't work. Try again.";

/** Loads the public Firebase config from HyperMixer. */
export async function setup() {
  const j = await fetch(`${WEB}/api/auth`).then((r) => r.json()).catch(() => ({}));
  cfg = j?.enabled ? { apiKey: j.config.apiKey } : null;
  providers = j?.providers ?? {};
  if (cfg) set("apiKey", cfg.apiKey);
  return { enabled: !!cfg, providers };
}

export function account(): Account | null {
  const uid = get("uid");
  return uid ? { uid, email: get("email") ?? "", name: get("name") ?? "" } : null;
}

async function rest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = cfg?.apiKey ?? get("apiKey");
  if (!key) throw fail("Sign-in isn't available right now. Check your connection.");
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) throw fail("No connection. Try again.");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(words(j?.error?.message));
  return j as T;
}

function save(uid: string, email: string, name: string, refresh: string, id: string, expiresIn: string | number) {
  set("uid", uid);
  set("email", email);
  set("name", name);
  set("refresh", refresh);
  set("idToken", id);
  set("idTokenExp", String(Date.now() / 1000 + Number(expiresIn || 3600)));
}

export async function email(mode: "in" | "up", address: string, password: string) {
  type R = { localId: string; email?: string; displayName?: string; idToken: string; refreshToken: string; expiresIn: string };
  const j = await rest<R>(mode === "up" ? "accounts:signUp" : "accounts:signInWithPassword", {
    email: address.trim(),
    password,
    returnSecureToken: true,
  });
  save(j.localId, j.email ?? "", j.displayName ?? "", j.refreshToken, j.idToken, j.expiresIn);
}

export async function resetPassword(address: string) {
  await rest("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email: address.trim() });
}

const rand = () => Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

/** Apple, Google or Microsoft, through HyperMixer's sign-in page. Returns false if cancelled. */
export async function provider(p: Provider): Promise<boolean> {
  const n = rand();
  const res = await WebBrowser.openAuthSessionAsync(`${WEB}/?signin=${p}&app=hyperjudge#k=${rand()}&n=${n}`, "hyperjudge://auth");
  if (res.type !== "success") return false;
  const q = new URLSearchParams(res.url.split("?")[1] ?? "");
  const refresh = q.get("r");
  if (!refresh || q.get("n") !== n) throw fail("That sign-in didn't come back right. Try again.");
  set("refresh", refresh);
  const id = await idToken(true);
  if (!id) throw fail("Sign-in didn't work. Try again.");
  type L = { users?: { localId: string; email?: string; displayName?: string }[] };
  const u = (await rest<L>("accounts:lookup", { idToken: id })).users?.[0];
  if (!u) throw fail("Sign-in didn't work. Try again.");
  set("uid", u.localId);
  set("email", u.email ?? "");
  set("name", u.displayName ?? "");
  return true;
}

/** A fresh ID token for /api/judge, or null when signed out. */
export async function idToken(force = false): Promise<string | null> {
  const refresh = get("refresh");
  const key = cfg?.apiKey ?? get("apiKey");
  if (!refresh || !key) return null;
  const cached = get("idToken");
  if (!force && cached && Number(get("idTokenExp") ?? 0) - 60 > Date.now() / 1000) return cached;
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`,
  }).catch(() => null);
  if (!r) return cached;
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) {
    if (/TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN/.test(j?.error?.message ?? "")) signOut();
    return null;
  }
  set("idToken", j.id_token);
  set("idTokenExp", String(Date.now() / 1000 + Number(j.expires_in || 3600)));
  if (j.refresh_token) set("refresh", j.refresh_token);
  return j.id_token;
}

export function signOut() {
  for (const k of ["uid", "email", "name", "refresh", "idToken", "idTokenExp"]) set(k, null);
}

export const enabledProviders = () => providers;
