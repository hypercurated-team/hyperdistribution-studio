import { useEffect, useState } from "react";
import { folder } from "../../shim/folder";
import { phone } from "../../shim/phone";
import { clouds, CLOUDS, type CloudId } from "../../shim/clouds";
import CloudFolders from "./CloudFolders";
import { db, docsOf } from "../../shim/db";
import { saveFile } from "../../shim/native";
import { isMobile } from "../../shim/platform";
import { auth } from "../../shim/auth";
import { claudeStatus, settingsStore } from "../../shim/services";
import { go, type ScreenProps } from "../App";
import { errText, Icon, Sheet, toast } from "../ui";
import { PLATFORMS } from "../platforms";

const KEYS = { claude: "hds:anthropic-key", license: "hds:remotion-license", heygen: "hm:heygen-key" } as const;
const store = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };

function useFolder() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    addEventListener("hds:folder", on);
    return () => removeEventListener("hds:folder", on);
  }, []);
  return folder.state;
}

const COLS = ["brands", "posts", "renders"];

export default function Connect({ brands }: ScreenProps) {
  const [folders, setFolders] = useState<CloudId | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const p = (e as CustomEvent).detail as CloudId; toast(`${CLOUDS.find((c) => c.id === p)?.name} connected. Choose folders.`); setFolders(p); };
    addEventListener("hm:cloud-connected", on);
    return () => removeEventListener("hm:cloud-connected", on);
  }, []);
  const [sheet, setSheet] = useState<"" | "claude" | "license" | "heygen">("");
  const [, refresh] = useState(0);
  const f = useFolder();
  const ownKey = !!settingsStore.apiKey();
  const builtIn = claudeStatus.builtIn();
  const claude = ownKey || builtIn;
  const license = settingsStore.license();
  const ps = phone.state;
  const media = f.items.length + ps.items.length + ps.files.length;
  const heygen = !!settingsStore.heygen();
  const done = [claude, media > 0, !!license].filter(Boolean).length;

  const pickFolder = async () => {
    try { await folder.connect(); } catch (e) { if ((e as Error).name !== "AbortError") toast("Couldn't open that folder"); }
  };
  const exportAll = async () => {
    const out: Record<string, unknown[]> = {};
    for (const c of COLS) out[c] = await docsOf(c);
    const blob = new Blob([JSON.stringify({ app: "hypermixer", version: 2, ...out }, null, 2)], { type: "application/json" });
    await saveFile(blob, `hypermixer-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const importAll = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "hypermixer" && data.app !== "hyperdistribution-studio") throw new Error();
      let n = 0;
      for (const c of [...COLS, "dumps"]) for (const d of data[c] ?? []) { const { id, ...rest } = d; await db.collection(c).doc(id).set(rest); n++; }
      toast(`Imported ${n} items`);
    } catch { toast("That file isn't a HyperMixer backup"); }
  };

  const rows = [
    { key: "claude", g: "Cl", c: "#B4532A", label: "Claude", sub: builtIn && !ownKey ? `Built in. ${claudeStatus.dailyLimit() || 20} free AI actions a day` : ownKey ? "Using your own Claude key" : "Your API key powers brains and drafts", on: claude, act: () => setSheet("claude") },
    ...(phone.available ? [] : [{ key: "media", g: "Me", c: "#5C6176", label: isMobile ? "Photos and clips" : "Media folder", sub: media ? `${f.name || "Picked"} · ${media} files, read on this device` : "Clips, photos and music for edits. Never uploaded.", on: media > 0, act: pickFolder }]),
    { key: "license", g: "Rv", c: "#3846F0", label: "Video rendering", sub: license ? "Remotion renders edits on this device" : "Turn on to render videos on this device", on: !!license, act: () => setSheet("license") },
  ];
  const extras = [
    { key: "heygen", g: "Hg", c: "#7B3FE4", label: "HeyGen", sub: heygen ? "Avatar videos with your HeyGen key" : "Optional: avatar videos read to camera", on: heygen, act: () => setSheet("heygen") },
  ];

  const acct = auth.state.session;
  return (
    <main className="screen">
      <header className="head">
        <div>
          <div className="eyebrow">{done} of 3 connected</div>
          <h1>Connect</h1>
          <p>Plug in what makes posts, and where they go.</p>
        </div>
      </header>

      {auth.state.enabled && (
        <section className="stack" aria-labelledby="c-acct">
          <div className="eyebrow" id="c-acct">Account</div>
          <div className="card list">
            <div className="item">
              <span className="mono" style={{ background: "#3846F0", width: 36, height: 36, fontSize: 13, borderRadius: 10 }} aria-hidden="true">
                {(acct?.name || acct?.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                <strong className="ellipsis">{acct ? acct.name || acct.email || "Signed in" : "Not signed in"}</strong>
                <span className="small muted ellipsis">{acct ? (acct.name && acct.email ? acct.email : "Your free AI actions follow you to any device") : "Sign in to keep your free AI actions on any device"}</span>
              </div>
              {acct
                ? <button type="button" className="btn pill" onClick={() => { auth.signOut(); toast("Signed out"); }}>Sign out</button>
                : <button type="button" className="btn pill primary" onClick={() => dispatchEvent(new Event("hm:need-signin"))}>Sign in</button>}
            </div>
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="c-make">
        <div className="eyebrow" id="c-make">Make</div>
        <div className="card list">
          {rows.map((r) => (
            <div className="item" key={r.key}>
              <span className="mono" style={{ background: r.c, width: 36, height: 36, fontSize: 13, borderRadius: 10 }} aria-hidden="true">{r.g}</span>
              <div className="grow stack" style={{ gap: 0 }}>
                <strong>{r.label}</strong>
                <span className="small muted">{r.sub}</span>
              </div>
              {r.on
                ? <button type="button" className="btn pill" onClick={r.act} aria-label={`Change ${r.label}`} style={{ color: "var(--ok)" }}><Icon name="check" size={16} stroke={2.6} />On</button>
                : <button type="button" className="btn pill primary" onClick={r.act}>Connect</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="c-src">
          <div className="eyebrow" id="c-src">Media sources</div>
          <div className="card list">
            {phone.available && <div className="item">
              <span className="mono" style={{ background: "#E8367A", width: 36, height: 36, fontSize: 13, borderRadius: 10 }} aria-hidden="true">Ph</span>
              <div className="grow stack" style={{ gap: 0 }}>
                <strong>Phone photos</strong>
                <span className="small muted">{
                  ps.scanning ? `Scanning… ${ps.items.length.toLocaleString()} so far`
                  : ps.access === "none" ? "Not allowed. Turn it on in Settings › HyperMixer › Photos."
                  : ps.access === "all" || ps.access === "limited" ? `${ps.items.length.toLocaleString()} ${ps.access === "limited" ? "you allowed" : "photos and videos"} · read on this phone`
                  : "The photos and videos you allow. Never uploaded."
                }</span>
                {ps.vision.total > 0 && ps.vision.available && ps.vision.done < ps.vision.total && (
                  <span className="small muted row" style={{ gap: 8 }}>
                    {ps.vision.running ? "Understanding your photos" : "Paused"}: {ps.vision.done.toLocaleString()} of {ps.vision.total.toLocaleString()}
                    <button type="button" className="btn pill" style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }} onClick={() => (ps.vision.running ? phone.pauseIndex() : phone.index())}>{ps.vision.running ? "Pause" : "Resume"}</button>
                  </span>
                )}
              </div>
              {ps.access === "limited" && !ps.scanning
                ? <button type="button" className="btn pill" onClick={() => phone.changeSelection()}>Change</button>
                : ps.access === "all" ? <button type="button" className="btn pill" disabled={ps.scanning} onClick={() => phone.scan()} style={{ color: "var(--ok)" }}><Icon name="check" size={16} stroke={2.6} />On</button>
                : <button type="button" className="btn pill primary" disabled={ps.scanning} onClick={() => phone.scan()}>Scan</button>}
            </div>}
            {CLOUDS.map((cl) => {
              const st = clouds.state[cl.id];
              const on = clouds.connected(cl.id);
              const sub = !st.configured ? "Not set up on this site yet"
                : !on ? "Sign in, then choose folders"
                : st.error ? st.error
                : st.indexing ? `${st.account} · reading folders…`
                : st.folders.length ? `${st.account} · ${st.folders.length} folder${st.folders.length > 1 ? "s" : ""} · ${st.items.length.toLocaleString()} photos and videos`
                : `${st.account} · choose folders`;
              return (
                <div className="item" key={cl.id}>
                  <span className="mono" style={{ background: cl.c, width: 36, height: 36, fontSize: 13, borderRadius: 10 }} aria-hidden="true">{cl.g}</span>
                  <div className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                    <strong>{cl.name}</strong>
                    <span className="small muted ellipsis">{sub}</span>
                  </div>
                  {on ? (
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn pill" onClick={() => setFolders(cl.id)}>Folders</button>
                      <button type="button" className="btn pill icon" aria-label={`Disconnect ${cl.name}`} onClick={() => clouds.disconnect(cl.id).then(() => toast(`${cl.name} disconnected`))}><Icon name="x" size={16} /></button>
                    </div>
                  ) : (
                    <button type="button" className="btn pill primary" disabled={!st.configured} onClick={() => clouds.connect(cl.id).catch((e) => toast(errText(e)))}>Connect</button>
                  )}
                </div>
              );
            })}
          </div>
          {phone.available && (
            <button type="button" className="btn pill" style={{ alignSelf: "flex-start" }} onClick={() => phone.pickFiles()}>
              {ps.files.length ? `Files on this phone · ${ps.files.length}` : "Add files on this phone"}
            </button>
          )}
        </section>
      {folders && <CloudFolders provider={folders} onClose={() => setFolders(null)} />}

      <section className="stack" aria-labelledby="c-more">
        <div className="eyebrow" id="c-more">Optional</div>
        <div className="card list">
          {extras.map((r) => (
            <div className="item" key={r.key}>
              <span className="mono" style={{ background: r.c, width: 36, height: 36, fontSize: 13, borderRadius: 10 }} aria-hidden="true">{r.g}</span>
              <div className="grow stack" style={{ gap: 0 }}>
                <strong>{r.label}</strong>
                <span className="small muted">{r.sub}</span>
              </div>
              {r.on
                ? <button type="button" className="btn pill" onClick={r.act} aria-label={`Change ${r.label}`} style={{ color: "var(--ok)" }}><Icon name="check" size={16} stroke={2.6} />On</button>
                : <button type="button" className="btn pill" onClick={r.act}>Connect</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="c-pub">
        <div className="eyebrow" id="c-pub">Publish to</div>
        <div className="card" style={{ padding: 14 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            {Object.entries(PLATFORMS).map(([k, p]) => (
              <span key={k} className="row" style={{ gap: 6, fontSize: 13, border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px 3px 3px" }}>
                <span className="glyph" style={{ background: p.c }} aria-hidden="true">{p.g}</span>{p.label}
              </span>
            ))}
          </div>
          <p className="small muted" style={{ margin: "12px 0 0" }}>
            Add each brand's handles on its card. Publish hands the finished video and caption to your phone's share sheet, so you post from the real app. Direct posting comes next.
          </p>
        </div>
      </section>

      <section className="stack" aria-labelledby="c-data">
        <div className="eyebrow" id="c-data">Your data</div>
        <div className="card" style={{ padding: 14 }}>
          <p className="small muted" style={{ margin: "0 0 10px" }}>Brands and posts are saved on this device only. Back up to move them.</p>
          <div className="row wrap">
            <button type="button" className="btn pill" onClick={exportAll}>Export backup</button>
            <label className="btn pill">Import backup<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} /></label>
            <a className="btn pill" href="/board">Classic board</a>
          </div>
        </div>
      </section>

      <button type="button" className="btn block primary" onClick={() => go(brands.length ? "dashboard" : "brands")}>
        {brands.length ? "Done" : "Continue to brands"}
      </button>

      {sheet === "claude" && (
        <KeySheet title="Claude" label={builtIn ? "Your own Claude key (optional)" : "Claude API key"} placeholder="sk-ant-…" initial={settingsStore.apiKey()}
          hint={<>{builtIn ? "Claude is already built in, so you don't need this. Add a key only to go past the daily free limit, billed to your own Anthropic account. " : ""}Get one at <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a>. It stays on this device and is sent only with each request, never stored on our server.</>}
          onSave={(v) => { store(KEYS.claude, v); refresh((n) => n + 1); setSheet(""); toast(v ? "Claude connected" : "Claude disconnected"); }}
          onClose={() => setSheet("")} />
      )}
      {sheet === "heygen" && (
        <KeySheet title="HeyGen" label="HeyGen API key" placeholder="Paste your HeyGen API key" initial={settingsStore.heygen()}
          hint={<>For avatar videos read to camera. Find it in HeyGen under Settings, API. It stays on this device, is sent only with each request, and uses your HeyGen credits.</>}
          onSave={(v) => { store(KEYS.heygen, v); refresh((n) => n + 1); setSheet(""); toast(v ? "HeyGen connected" : "HeyGen disconnected"); }}
          onClose={() => setSheet("")} />
      )}
      {phone.available && ps.shell.version && (
        <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
          App {ps.shell.version} · {ps.shell.update ? `update ${ps.shell.update.slice(0, 8)}` : "no updates yet"}
        </p>
      )}
      {sheet === "license" && (
        <KeySheet title="Video rendering" label="Remotion license" placeholder="free-license" initial={license || "free-license"}
          hint={<>Videos render on this device with <a href="https://www.remotion.dev" target="_blank" rel="noopener">Remotion</a>. Free for individuals and companies of up to 3 people: keep <code>free-license</code>. Larger companies need a <a href="https://www.remotion.dev/license" target="_blank" rel="noopener">company license</a> key.</>}
          onSave={(v) => { store(KEYS.license, v); refresh((n) => n + 1); setSheet(""); toast(v ? "Video rendering on" : "Video rendering off"); }}
          onClose={() => setSheet("")} />
      )}
    </main>
  );
}

function KeySheet(p: { title: string; label: string; placeholder: string; initial: string; hint: React.ReactNode; onSave: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(p.initial);
  const [err, setErr] = useState("");
  return (
    <Sheet title={p.title} onClose={p.onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); try { p.onSave(v.trim()); } catch (x) { setErr(errText(x)); } }}>
        <div className="field">
          <label htmlFor="k">{p.label}</label>
          <input id="k" type={p.title === "Video rendering" ? "text" : "password"} autoComplete="off" placeholder={p.placeholder} value={v} onChange={(e) => setV(e.target.value)} />
          <span className="hint">{p.hint}</span>
        </div>
        {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
        <div className="row">
          {p.initial && <button type="button" className="btn" onClick={() => p.onSave("")}>Disconnect</button>}
          <button type="submit" className="btn primary grow">Save</button>
        </div>
      </form>
    </Sheet>
  );
}
