import { addMediaSource, mediaChanged, type FolderItem } from "./folder";
import { insights, type Insight } from "./insights";
import { isNative, postToApp } from "./platform";

/**
 * Inside the iOS / Android app: the phone's photo library (whatever the person
 * allows) and files picked from Files or cloud drives, read by the app shell
 * (mobile/media.ts). Items join the same media list as a picked folder.
 * Previews arrive on request; a full file is fetched only when an edit needs it.
 */
type Wire = { id: string; name: string; kind: "image" | "video"; w?: number; h?: number; d?: number; t?: number; src: "phone" | "files" };
export type Access = "unknown" | "all" | "limited" | "none" | "error";

const state = {
  access: "unknown" as Access, scanning: false, items: [] as FolderItem[], files: [] as FolderItem[],
  /** On-phone understanding of the library: progress of the indexer. */
  vision: { available: true, running: false, paused: false, done: 0, total: 0 },
  /** Which app build and over-the-air update is running (shown on Connect). */
  shell: { version: "", update: "", channel: "", updatedAt: "" },
};
const visionWait = new Map<string, (r: { results: Omit<Insight, "groups">[]; unavailable?: boolean }) => void>();
const byId = new Map<string, FolderItem>();
const waiting = new Map<string, { parts: string[]; mime: string; ok: (b: Blob) => void; no: (e: Error) => void }>();
const asked = new Set<string>();

// Publishing the media list is O(library size), so while a big scan streams in,
// publish at most once a second; everything else publishes right away.
let lastPublish = 0, trailing: ReturnType<typeof setTimeout> | undefined;
const changed = () => {
  clearTimeout(trailing);
  const wait = state.scanning ? 1000 - (Date.now() - lastPublish) : 0;
  if (wait > 0) { trailing = setTimeout(changed, wait); return; }
  lastPublish = Date.now();
  mediaChanged();
};

const toItem = (w: Wire): FolderItem => {
  const it: FolderItem = {
    id: w.id, name: w.name, path: w.name, kind: w.kind, size: 0, assetUrl: "",
    durationSec: w.d ?? undefined, width: w.w, height: w.h,
    takenAt: w.t ?? 0, addedAt: w.t ?? 0, tags: [w.src === "files" ? "files" : "photos"], description: "", source: w.src,
  };
  byId.set(it.id, it);
  return it;
};

function onApp(m: Record<string, unknown>) {
  // Other features (cloud sign-in results) listen for the shell's messages too.
  window.dispatchEvent(new CustomEvent("hm:app", { detail: m }));
  switch (m.type) {
    case "shell-info":
      state.shell = { version: String(m.version || ""), update: String(m.update || ""), channel: String(m.channel || ""), updatedAt: String(m.updatedAt || "") };
      mediaChanged();
      return;
    case "media-perm":
      state.access = m.access as Access;
      if (state.access === "none" || state.access === "error") state.scanning = false;
      else { state.items = []; }
      return changed();
    case "media-items":
      for (const w of m.items as Wire[]) state.items.push(toItem(w));
      if (m.done) { state.scanning = false; phone.index(); }
      changed();
      // Previews for the newest items, so the grid and Auto-pick have something to show.
      if (state.items.length <= 400) phone.previews(state.items.slice(0, 96).map((i) => i.id));
      return;
    case "files-items": {
      const add = (m.items as Wire[]).map(toItem);
      state.files = add.concat(state.files);
      changed();
      return phone.previews(add.map((i) => i.id));
    }
    case "media-thumb": {
      const it = byId.get(m.id as string);
      if (it && m.data) { it.thumbUrl = "data:image/jpeg;base64," + m.data; changedSoon(); }
      return;
    }
    case "vision-results": {
      const r = visionWait.get(m.req as string); visionWait.delete(m.req as string);
      return r?.({ results: (m.results as Omit<Insight, "groups">[]) ?? [], unavailable: !!m.unavailable });
    }
    case "file-start": { const w = waiting.get(m.req as string); if (w) w.mime = String(m.mime || ""); return; }
    case "file-chunk": waiting.get(m.req as string)?.parts.push(m.data as string); return;
    case "file-end": {
      const w = waiting.get(m.req as string); if (!w) return;
      waiting.delete(m.req as string);
      const bytes = w.parts.map((p) => Uint8Array.from(atob(p), (c) => c.charCodeAt(0)));
      return w.ok(new Blob(bytes, { type: w.mime || "application/octet-stream" }));
    }
    case "file-error": {
      const w = waiting.get(m.req as string); waiting.delete(m.req as string);
      return w?.no(new Error(String(m.error || "Couldn't read that file")));
    }
  }
}

let soon: ReturnType<typeof setTimeout> | undefined;
const changedSoon = () => { clearTimeout(soon); soon = setTimeout(changed, 250); };

export const phone = {
  state,
  available: isNative,
  setup() {
    if (!isNative) return;
    (window as unknown as { __hmFromApp: typeof onApp }).__hmFromApp = onApp;
    addMediaSource(() => state.files.concat(state.items));
    insights.load().then(changed);
  },
  scan() {
    state.scanning = true; changed(); postToApp({ type: "media-scan" });
    try { localStorage.setItem("hm:phone-scan", "1"); } catch { /* private mode */ }
  },
  changeSelection() { postToApp({ type: "media-change" }); },
  pickFiles() { postToApp({ type: "files-pick" }); },
  /** Asks the app for previews it hasn't sent yet. */
  previews(ids: string[]) {
    const want = ids.filter((id) => byId.has(id) && !byId.get(id)!.thumbUrl && !asked.has(id));
    want.forEach((id) => asked.add(id));
    if (want.length) postToApp({ type: "media-thumbs", ids: want });
  },
  isPhoneItem: (id: string) => byId.has(id),
  /** The live item (its preview may have arrived since the last snapshot). */
  item: (id: string) => byId.get(id),
  /**
   * Understands the library on the phone, newest first, 50 at a time, a few
   * seconds apart so the phone stays responsive. Resumes where it left off.
   */
  async index() {
    const v = state.vision;
    if (!isNative || v.running || !v.available) return;
    await insights.load();
    v.running = true; v.paused = false;
    const lib = () => state.items.filter((i) => i.source === "phone");
    try {
      for (;;) {
        const todo = lib().filter((i) => !insights.has(i.id));
        v.total = lib().length; v.done = v.total - todo.length; changed();
        if (!todo.length || v.paused) break;
        const req = Math.random().toString(36).slice(2);
        const res = await new Promise<{ results: Omit<Insight, "groups">[]; unavailable?: boolean }>((ok) => {
          visionWait.set(req, ok);
          postToApp({ type: "vision-analyze", req, ids: todo.slice(0, 50).map((i) => i.id) });
          setTimeout(() => { if (visionWait.delete(req)) ok({ results: [] }); }, 120_000);
        });
        if (res.unavailable) { v.available = false; break; }
        // Items the phone couldn't read (e.g. only in iCloud) are saved too, so they aren't retried forever.
        const got = new Set(res.results.map((r) => r.id));
        const missed = todo.slice(0, 50).filter((i) => !got.has(i.id)).map((i) => ({ id: i.id, labels: [], faces: 0, quality: 0.4, isScreenshot: false, isBlurry: false }));
        await insights.save([...res.results, ...missed]);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally { v.running = false; changed(); }
  },
  pauseIndex() { state.vision.paused = true; changed(); },
  /** Previews for these ids, waiting up to a few seconds for them to arrive. */
  async previewsReady(ids: string[], ms = 8000) {
    phone.previews(ids);
    const t0 = Date.now();
    while (Date.now() - t0 < ms && ids.some((id) => byId.has(id) && !byId.get(id)!.thumbUrl)) await new Promise((r) => setTimeout(r, 200));
  },
  /** Makes sure these items have their full file, fetching from the phone as needed. */
  async ensureFiles(ids: string[]) {
    for (const id of ids) {
      const it = byId.get(id);
      if (!it || it.assetUrl) continue;
      const req = Math.random().toString(36).slice(2);
      const blob = await new Promise<Blob>((ok, no) => {
        waiting.set(req, { parts: [], mime: "", ok, no });
        postToApp({ type: "media-file", id, req });
        setTimeout(() => { if (waiting.delete(req)) no(new Error("The phone took too long to hand over that file")); }, 180_000);
      });
      it.assetUrl = URL.createObjectURL(blob);
      it.size = blob.size;
    }
    changed();
  },
};
