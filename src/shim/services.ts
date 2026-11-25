/** Claude, link reading and settings for the ported board. */
import { apiUrl } from "./platform";
import { connectDrive, disconnectDrive, driveAvailable, driveConnected, driveTool } from "./drive";

const KEY = "hds:anthropic-key";
const LICENSE = "hds:remotion-license";
const HEYGEN = "hm:heygen-key";
const get = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const put = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };

/** A random id for this device, used only to count the daily free allowance. */
const deviceId = () => {
  let id = get("hm:device");
  if (!id) { id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) ; put("hm:device", id); }
  return id;
};

/** Whether this HyperMixer server has Claude built in (no key needed). Cached so the app knows at once on next open. */
let builtIn = get("hm:builtin") === "1";
let dailyLimit = Number(get("hm:daily-limit")) || 0;
export const claudeStatus = {
  builtIn: () => builtIn,
  dailyLimit: () => dailyLimit,
  ready: () => builtIn || !!get(KEY),
  async refresh() {
    try {
      const res = await fetch(apiUrl("/api/ai"), { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      builtIn = !!d.builtIn; dailyLimit = Number(d.dailyLimit) || 0;
      put("hm:builtin", builtIn ? "1" : ""); put("hm:daily-limit", dailyLimit ? String(dailyLimit) : "");
      dispatchEvent(new Event("hm:claude"));
    } catch { /* offline: keep the cached answer */ }
  },
};

export const settingsStore = {
  apiKey: () => get(KEY),
  license: () => get(LICENSE),
  heygen: () => get(HEYGEN),
};

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

async function toBase64(b: Blob): Promise<{ media_type: string; data: string } | null> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(b.type)) {
    // Re-encode anything else (SVG, HEIC…) to JPEG through a canvas.
    try {
      const bmp = await createImageBitmap(b);
      const c = new OffscreenCanvas(Math.min(1568, bmp.width), Math.round((Math.min(1568, bmp.width) / bmp.width) * bmp.height));
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      b = await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    } catch { return null; }
  }
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { media_type: b.type, data: btoa(s) };
}

export const sample = {
  async limits() {
    return { images: { maxCount: 4, maxInputBytes: 900_000 } };
  },
  /** quick: drafts and captions (low effort, shorter answer); leave it off for brand brains. */
  async json(prompt: string, opts: { images?: Blob[]; quick?: boolean } = {}) {
    const key = settingsStore.apiKey();
    if (!key && !builtIn) {
      openSettings("Add your Claude API key to use the ✦ features.");
      throw err("no_key", "Claude isn't switched on yet.");
    }
    const images = (await Promise.all((opts.images ?? []).slice(0, 4).map(toBase64))).filter(Boolean);
    let res: Response, data: { result?: unknown; error?: string; code?: string };
    try {
      res = await fetch(apiUrl("/api/ai"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-hm-device": deviceId(), ...(key ? { "x-anthropic-key": key } : {}) },
        body: JSON.stringify({ prompt, images, ...(opts.quick ? { effort: "low", maxTokens: 4000 } : {}) }),
      });
      data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    } catch {
      // The connection dropped (iOS calls this "Load failed"), usually because the app went to the background.
      throw err("network", "Claude took too long or the connection dropped. Tap to try again.");
    }
    // Errors that happen while Claude writes arrive in a 200 response body.
    if (!res.ok || data.error) throw err(data.code || (res.status === 429 ? "rate_limited" : "error"), data.error || "Claude couldn't answer. Try again.");
    return data.result;
  },
};

/** Stands in for the desktop app's browser tool: "navigate" fetches the page on the server, "get_page_text" returns it. */
const pages = new Map<string, string>();
const BROWSER = "host:claude_browser";
export const mcp = {
  async describeTool(_server: string, name: string) {
    return name === "get_page_text"
      ? { inputSchema: { required: ["tabId"], properties: { tabId: { type: "string" } } } }
      : { inputSchema: { required: ["url"], properties: { url: { type: "string" } } } };
  },
  async callTool(server: string, name: string, input: { url?: string; tabId?: string }) {
    if (server === "HeyGen") return heygen(name, input as Record<string, unknown>);
    if (server === "Google Drive") return { payload: await driveTool(name, input as Record<string, unknown>) };
    if (server !== BROWSER) throw err("server_not_connected", `${server} isn't connected. Add it in Settings → Connectors.`);
    if (name === "navigate") {
      const res = await fetch(apiUrl("/api/read-link"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.url }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw err("read_failed", data.error || "Couldn't read that page");
      const tabId = "t" + pages.size;
      pages.set(tabId, data.text);
      return { payload: { tabId }, content: [{ type: "text", text: `Opened tab id ${tabId}` }] };
    }
    if (name === "get_page_text") {
      const text = pages.get(String(input.tabId)) ?? "";
      pages.delete(String(input.tabId));
      return { content: [{ type: "text", text }] };
    }
    throw err("unknown_tool", name);
  },
};

async function heygen(tool: string, input: Record<string, unknown>) {
  const key = settingsStore.heygen();
  if (!key) throw err("server_not_connected", "Add your HeyGen API key in Settings → Connectors.");
  const res = await fetch(apiUrl("/api/heygen"), { method: "POST", headers: { "content-type": "application/json", "x-heygen-key": key }, body: JSON.stringify({ tool, input }) });
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (!res.ok) throw err(data.code || "tool_error", data.error || "HeyGen didn't answer");
  return { payload: data };
}

/** What the Connect screen reads and writes. Keys stay on this device. */
export const conn = {
  get: () => ({ claude: get(KEY), license: get(LICENSE), heygen: get(HEYGEN), driveAvailable: driveAvailable(), driveConnected: driveConnected() }),
  set(k: "claude" | "license" | "heygen", v: string) { put(k === "claude" ? KEY : k === "license" ? LICENSE : HEYGEN, v.trim()); },
  connectDrive,
  disconnectDrive,
};

type Win = Window & { openPanel?: (html: string, wide?: boolean) => void; closePanel?: () => void; toast?: (m: string) => void };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function openSettings(note = "") {
  const w = window as Win;
  if (!w.openPanel) return;
  w.openPanel(`<div class="panel-h"><h2>Settings</h2><button class="btn ghost" data-close aria-label="Close">✕</button></div>
    ${note ? `<div class="banner">${esc(note)}</div>` : ""}
    <div class="form">
      <div class="field full"><label for="hds_key">Claude API key</label><input id="hds_key" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(settingsStore.apiKey())}">
        <span class="muted" style="font-size:12px">Powers brand brains, plans, blasts and clip picking. Get one at <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a>. It stays on this device and is sent only with each request to HyperMixer's server, which passes it to Anthropic and never stores it.</span></div>
      <div class="field full"><label for="hds_lic">Remotion license</label><input id="hds_lic" placeholder="free-license" value="${esc(settingsStore.license())}">
        <span class="muted" style="font-size:12px">Videos render in your browser with <a href="https://www.remotion.dev" target="_blank" rel="noopener">Remotion</a>. It's free for individuals and companies of up to 3 people: type <code>free-license</code>. Larger companies need a <a href="https://www.remotion.dev/license" target="_blank" rel="noopener">company license</a> key.</span></div>
    </div>
    <div class="field"><span class="lbl">Connectors</span>
      <span class="muted" style="font-size:12px">Connect your own accounts. Keys stay on this device and are sent only with each request.</span>
      <div class="field full" style="margin-top:8px"><label for="hds_hg">HeyGen API key</label><input id="hds_hg" type="password" autocomplete="off" placeholder="Paste your HeyGen API key" value="${esc(settingsStore.heygen())}">
        <span class="muted" style="font-size:12px">For avatar videos read to camera. Find it in HeyGen under Settings → API. Uses your HeyGen credits.</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><b style="font-size:14px">Google Drive</b>
        ${driveAvailable() ? (driveConnected() ? `<span class="muted" style="font-size:12px">Connected</span><button class="btn sm" id="hds_drv_off">Disconnect</button>` : `<button class="btn sm" id="hds_drv_on">Connect Google Drive</button>`) : `<span class="muted" style="font-size:12px">Coming soon</span>`}
        <span class="muted" style="font-size:12px;flex-basis:100%">Backs up each brand's brain, brand kit, posts and videos into a HyperMixer folder in your Drive. HyperMixer can only see files it made.</span></div></div>
    <div class="field"><span class="lbl">Your data</span><span class="muted" style="font-size:12px">Brands, posts, dumps and renders are saved on this device only. Export a backup to move them to another device.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn sm" id="hds_export">Export backup</button><label class="btn sm">Import backup<input type="file" id="hds_import" accept="application/json" hidden></label></div></div>
    <div class="panel-foot"><span></span><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="hds_save">Save</button></div></div>`);
  document.getElementById("hds_save")!.onclick = () => {
    put(KEY, (document.getElementById("hds_key") as HTMLInputElement).value.trim());
    put(LICENSE, (document.getElementById("hds_lic") as HTMLInputElement).value.trim());
    put(HEYGEN, (document.getElementById("hds_hg") as HTMLInputElement).value.trim());
    w.closePanel?.();
    w.toast?.("Settings saved");
  };
  const on = document.getElementById("hds_drv_on"), off = document.getElementById("hds_drv_off");
  if (on) on.onclick = async () => {
    try { await connectDrive(); w.toast?.("Google Drive connected"); openSettings(); } catch (e) { w.toast?.((e as Error).message || "Couldn't connect Google Drive"); }
  };
  if (off) off.onclick = async () => { await disconnectDrive(); w.toast?.("Google Drive disconnected"); openSettings(); };
  document.getElementById("hds_export")!.onclick = () => window.dispatchEvent(new Event("hds:export"));
  (document.getElementById("hds_import") as HTMLInputElement).onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) window.dispatchEvent(new CustomEvent("hds:import", { detail: f }));
  };
}
