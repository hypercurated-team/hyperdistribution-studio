import React, { useEffect, useState } from "react";
import { auth, sealForApp, type Provider } from "../../shim/auth";
import { isNative, platform } from "../../shim/platform";
import { errText, toast } from "../ui";

const APPLE = <svg width="18" height="18" viewBox="0 0 814 1000" aria-hidden="true"><path fill="currentColor" d="M788 341c-6 4-108 61-108 189 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-57-156-128C44 788 0 667 0 553c0-184 120-282 238-282 63 0 115 41 155 41 38 0 97-44 168-44 27 0 124 3 189 73zM561 166c30-35 51-84 51-133 0-7-1-14-2-19-48 2-106 32-140 72-27 31-53 80-53 130 0 8 1 15 2 18 3 1 9 1 14 1 43 0 98-29 128-69z"/></svg>;
const GOOGLE = <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>;
const MICROSOFT = <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><path fill="#F25022" d="M0 0h10v10H0z"/><path fill="#7FBA00" d="M11 0h10v10H11z"/><path fill="#00A4EF" d="M0 11h10v10H0z"/><path fill="#FFB900" d="M11 11h10v10H11z"/></svg>;

const PROVIDERS: { id: Provider; label: string; glyph: React.ReactElement }[] = [
  { id: "apple", label: "Continue with Apple", glyph: APPLE },
  { id: "google", label: "Continue with Google", glyph: GOOGLE },
  { id: "microsoft", label: "Continue with Microsoft", glyph: MICROSOFT },
];

/** First-run sign-in: Apple, Google, Microsoft or email. "Not now" keeps the app usable without an account. */
export default function SignIn({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState<string>("");
  const [mode, setMode] = useState<"" | "in" | "up">("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  // In a browser the providers' sign-in window must open straight from the tap: load it now.
  useEffect(() => { if (!isNative) auth.prepare().catch(() => {}); }, []);
  useEffect(() => {
    const ok = () => { setBusy(""); onDone?.(); };
    const bad = (e: Event) => { setBusy(""); setErr(String((e as CustomEvent).detail)); };
    addEventListener("hm:signed-in", ok);
    addEventListener("hm:auth-error", bad);
    // Back from the phone's browser without finishing: stop the spinner.
    const back = () => { if (document.visibilityState === "visible") setTimeout(() => setBusy((b) => (auth.state.session ? b : "")), 1500); };
    document.addEventListener("visibilitychange", back);
    return () => { removeEventListener("hm:signed-in", ok); removeEventListener("hm:auth-error", bad); document.removeEventListener("visibilitychange", back); };
  }, [onDone]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setErr(""); setBusy(key);
    try { await fn(); if (auth.state.session) { setBusy(""); onDone?.(); } }
    catch (e) { setBusy(""); setErr(errText(e)); }
  };

  return (
    <main className="screen" style={{ justifyContent: "center", maxWidth: 420, margin: "0 auto", width: "100%", paddingBottom: 40 }}>
      <div className="stack" style={{ gap: 6, textAlign: "center", marginBottom: 12 }}>
        <span className="hc-mark" aria-hidden="true" style={{ width: 64, alignSelf: "center", marginBottom: 6 }} />
        <span className="hc-word muted" style={{ alignSelf: "center" }}>Hypercurated</span>
        <h1 style={{ margin: "6px 0 0", fontSize: 34 }}>HyperMixer</h1>
        <p className="muted" style={{ margin: 0 }}>Sign in to keep your brands and free AI actions with you.</p>
      </div>

      {!mode && (
        <div className="stack" style={{ gap: 10 }}>
          {PROVIDERS.filter((p) => auth.state.providers[p.id]).map((p) => (
            <button key={p.id} type="button" className={`btn block ${p.id === "apple" ? "apple" : ""}`} disabled={!!busy}
              onClick={() => run(p.id, () => auth.provider(p.id))} style={{ gap: 10, justifyContent: "center" }}>
              {p.glyph}{busy === p.id ? "Waiting for sign-in…" : p.label}
            </button>
          ))}
          <button type="button" className="btn block" disabled={!!busy} onClick={() => setMode("in")}>Continue with email</button>
        </div>
      )}

      {mode && (
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); run("email", () => auth.email(mode, email, pw)); }}>
          <div className="field">
            <label htmlFor="em">Email</label>
            <input id="em" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <button type="submit" className="btn block primary" disabled={!!busy}>{busy ? "One moment…" : mode === "up" ? "Create account" : "Sign in"}</button>
          <div className="row small" style={{ justifyContent: "space-between" }}>
            <button type="button" className="btn pill" onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(""); }}>{mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}</button>
            {mode === "in" && (
              <button type="button" className="btn pill" onClick={() => (email ? auth.resetPassword(email).then(() => toast("Check your email for a reset link")).catch((e) => setErr(errText(e))) : setErr("Enter your email first."))}>Forgot password?</button>
            )}
          </div>
          <button type="button" className="btn pill" style={{ alignSelf: "center" }} onClick={() => { setMode(""); setErr(""); }}>Other ways to sign in</button>
        </form>
      )}

      {err && <p role="alert" className="small" style={{ color: "var(--bad)", textAlign: "center", margin: 0 }}>{err}</p>}

      {!auth.state.required && (
        <button type="button" className="btn pill" style={{ alignSelf: "center", border: 0, background: "none" }} onClick={() => { auth.skip(); onDone?.(); }}>Not now</button>
      )}
    </main>
  );
}

/**
 * Runs in the phone's browser (?signin=google#k=…&n=…), opened by the app.
 * Signs in with Firebase's popup, then hands the session back to the app,
 * encrypted with the key from the link's #fragment.
 */
export function SignInRelay() {
  const p = new URLSearchParams(location.search).get("signin") as Provider;
  const h = new URLSearchParams(location.hash.slice(1));
  const [k, n] = [h.get("k") || "", h.get("n") || ""];
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { auth.setup().then(() => auth.prepare()).then(() => setReady(true), (e) => setErr(errText(e))); }, []);
  const label = PROVIDERS.find((x) => x.id === p);
  if (!label || !k || !n) return <main className="screen" style={{ justifyContent: "center", textAlign: "center" }}><p>Open HyperMixer and start sign-in from there.</p></main>;

  const go = async () => {
    setErr(""); setBusy(true);
    try {
      const s = await auth.popup(p); // first thing in the tap, so Safari opens the window
      const url = `hypermixer://auth?c=${await sealForApp(s, k)}&n=${n}`;
      setLink(url);
      location.href = url;
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };

  return (
    <main className="screen" style={{ justifyContent: "center", maxWidth: 420, margin: "0 auto", width: "100%", textAlign: "center" }}>
      <span className="hc-mark" aria-hidden="true" style={{ width: 56, alignSelf: "center" }} />
      <h1 style={{ margin: 0, fontSize: 28 }}>HyperMixer</h1>
      {!link ? (
        <>
          <p className="muted" style={{ margin: 0 }}>Sign in, then you'll go straight back to the app.</p>
          <button type="button" className={`btn block ${p === "apple" ? "apple" : ""}`} disabled={busy || !ready} onClick={go} style={{ gap: 10, justifyContent: "center" }}>
            {label.glyph}{busy ? "Waiting for sign-in…" : label.label}
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>You're signed in.</p>
          <a className="btn block primary" href={link} style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>Open HyperMixer</a>
        </>
      )}
      {err && <p role="alert" className="small" style={{ color: "var(--bad)", margin: 0 }}>{err}</p>}
      {platform === "web" && <p className="small muted" style={{ margin: 0 }}>You can close this page afterwards.</p>}
    </main>
  );
}
