import { createStore, get, set, del } from "idb-keyval";
import { addMediaSource, mediaChanged, type FolderItem } from "./folder";
import { apiUrl, isNative } from "./platform";

/**
 * Google Drive, OneDrive and Dropbox as media sources. The person signs in
 * with the provider (in the system browser inside the app, a popup on the
 * web), picks folders, and their photos and videos join the media library.
 * The device talks to each provider directly; HyperMixer's server only turns
 * the encrypted sign-in "grant" kept on this device into a short-lived token.
 * Previews load as needed and a full file is downloaded only to render.
 */
export type CloudId = "google" | "microsoft" | "dropbox";
export type Folder = { id: string; name: string };
type Saved = { account: string; grant: string; folders: Folder[] };
type Item = FolderItem & { remote: string; thumbSrc?: string };

export const CLOUDS: { id: CloudId; name: string; g: string; c: string }[] = [
  { id: "google", name: "Google Drive", g: "Gd", c: "#1A73E8" },
  { id: "microsoft", name: "OneDrive", g: "Od", c: "#0364B8" },
  { id: "dropbox", name: "Dropbox", g: "Db", c: "#0061FE" },
];

const EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|mp4|mov|m4v|webm)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const store = createStore("hm-clouds", "accounts");

type CloudState = { configured: boolean; account: string; folders: Folder[]; items: Item[]; indexing: boolean; error: string };
const blank = (): CloudState => ({ configured: false, account: "", folders: [], items: [], indexing: false, error: "" });
const state: Record<CloudId, CloudState> = { google: blank(), microsoft: blank(), dropbox: blank() };
const grants = new Map<CloudId, string>();
const tokens = new Map<CloudId, { t: string; until: number }>();
const byId = new Map<string, Item>();
const asked = new Set<string>();

const changed = () => mediaChanged();
const err = (m: string) => new Error(m);

async function save(p: CloudId) {
  const g = grants.get(p);
  if (!g) return del(p, store);
  await set(p, { account: state[p].account, grant: g, folders: state[p].folders } satisfies Saved, store);
}

/** A short-lived access token, refreshed through HyperMixer's server. */
async function token(p: CloudId): Promise<string> {
  const c = tokens.get(p);
  if (c && Date.now() < c.until - 60_000) return c.t;
  const grant = grants.get(p);
  if (!grant) throw err("Not connected");
  const r = await fetch(apiUrl("/api/oauth"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.accessToken) { if (j.code === "reauth") state[p].error = "Sign in again"; changed(); throw err(j.error || "Couldn't reach " + p); }
  tokens.set(p, { t: j.accessToken, until: Date.now() + (j.expiresIn || 3600) * 1000 });
  if (j.grant) { grants.set(p, j.grant); save(p); }
  return j.accessToken;
}

async function call(p: CloudId, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await token(p)}` } });
  if (!r.ok) throw err(`${p} ${r.status}`);
  return r;
}
const dbx = (p: CloudId, path: string, body: unknown) =>
  call(p, `https://api.dropboxapi.com/2/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

type Entry = { id: string; name: string; folder: boolean; t?: number; w?: number; h?: number; d?: number; thumb?: string };

/** One folder's children, all pages. */
async function children(p: CloudId, folderId: string): Promise<Entry[]> {
  const out: Entry[] = [];
  if (p === "google") {
    let pageToken = "";
    do {
      const q = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`, pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime,imageMediaMetadata(time,width,height),videoMediaMetadata(durationMillis,width,height))",
        ...(pageToken ? { pageToken } : {}),
      });
      const j = await (await call(p, `https://www.googleapis.com/drive/v3/files?${q}`)).json();
      for (const f of j.files ?? []) out.push({
        id: f.id, name: f.name, folder: f.mimeType === "application/vnd.google-apps.folder",
        t: Date.parse(f.createdTime) || 0, w: f.imageMediaMetadata?.width ?? f.videoMediaMetadata?.width, h: f.imageMediaMetadata?.height ?? f.videoMediaMetadata?.height,
        d: f.videoMediaMetadata?.durationMillis ? f.videoMediaMetadata.durationMillis / 1000 : undefined,
        thumb: f.thumbnailLink ? String(f.thumbnailLink).replace(/=s\d+$/, "=s320") : undefined,
      });
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
  } else if (p === "microsoft") {
    let next = `https://graph.microsoft.com/v1.0/me/drive/${folderId === "root" ? "root" : `items/${folderId}`}/children?$top=200&$expand=thumbnails&$select=id,name,folder,file,createdDateTime,image,video,photo`;
    while (next) {
      const j = await (await call(p, next)).json();
      for (const f of j.value ?? []) out.push({
        id: f.id, name: f.name, folder: !!f.folder, t: Date.parse(f.photo?.takenDateTime || f.createdDateTime) || 0,
        w: f.image?.width ?? f.video?.width, h: f.image?.height ?? f.video?.height, d: f.video?.duration ? f.video.duration / 1000 : undefined,
        thumb: f.thumbnails?.[0]?.medium?.url,
      });
      next = j["@odata.nextLink"] ?? "";
    }
  } else {
    let j = await dbx(p, "files/list_folder", { path: folderId === "root" ? "" : folderId, limit: 2000, include_media_info: true });
    for (;;) {
      for (const f of j.entries ?? []) out.push({
        id: f.id, name: f.name, folder: f[".tag"] === "folder", t: Date.parse(f.media_info?.metadata?.time_taken || f.client_modified) || 0,
        w: f.media_info?.metadata?.dimensions?.width, h: f.media_info?.metadata?.dimensions?.height,
        d: f.media_info?.metadata?.duration ? f.media_info.metadata.duration / 1000 : undefined,
      });
      if (!j.has_more) break;
      j = await dbx(p, "files/list_folder/continue", { cursor: j.cursor });
    }
  }
  return out;
}

const toItem = (p: CloudId, e: Entry): Item => {
  const it: Item = {
    id: `${p}:${e.id}|${e.name}`, name: e.name, path: e.name, kind: VIDEO.test(e.name) ? "video" : "image", size: 0, assetUrl: "",
    durationSec: e.d, width: e.w, height: e.h, takenAt: e.t ?? 0, addedAt: e.t ?? 0, tags: [p], description: "",
    source: p as FolderItem["source"], remote: e.id, thumbSrc: e.thumb,
  };
  byId.set(it.id, it);
  return it;
};

async function toDataUrl(blob: Blob) {
  return new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); });
}

let pendingNonce = "";

async function finishSignIn(encoded: string) {
  let r: { provider?: CloudId; nonce?: string; account?: string; grant?: string };
  try { r = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return; }
  const nonce = pendingNonce || (() => { try { return localStorage.getItem("hm:oauth-nonce") || ""; } catch { return ""; } })();
  if (!r.provider || !r.grant || !nonce || r.nonce !== nonce || !(r.provider in state)) return;
  pendingNonce = "";
  try { localStorage.removeItem("hm:oauth-nonce"); } catch { /* private mode */ }
  grants.set(r.provider, r.grant);
  tokens.delete(r.provider);
  Object.assign(state[r.provider], { account: r.account || "", error: "" });
  await save(r.provider);
  changed();
  window.dispatchEvent(new CustomEvent("hm:cloud-connected", { detail: r.provider }));
}

export const clouds = {
  state,
  async setup() {
    addMediaSource(() => CLOUDS.flatMap((c) => state[c.id].items));
    window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data?.type === "hm-oauth") finishSignIn(String(e.data.r)); });
    window.addEventListener("hm:app", (e) => { const m = (e as CustomEvent).detail; if (m?.type === "oauth-result") finishSignIn(String(m.r)); });
    for (const c of CLOUDS) {
      const s = await get<Saved>(c.id, store).catch(() => undefined);
      if (s?.grant) { grants.set(c.id, s.grant); Object.assign(state[c.id], { account: s.account, folders: s.folders ?? [] }); }
    }
    fetch(apiUrl("/api/oauth")).then((r) => r.json()).then((j) => { for (const c of CLOUDS) state[c.id].configured = !!j.providers?.[c.id]; changed(); }).catch(() => {});
    for (const c of CLOUDS) if (grants.has(c.id) && state[c.id].folders.length) clouds.index(c.id).catch(() => {});
    changed();
  },
  connected: (p: CloudId) => grants.has(p),
  /** Starts sign-in: the system browser inside the app, a popup on the web. */
  async connect(p: CloudId) {
    pendingNonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem("hm:oauth-nonce", pendingNonce); } catch { /* private mode */ }
    const popup = isNative ? null : window.open("", "hm-oauth", "popup,width=520,height=720");
    const r = await fetch(apiUrl(`/api/oauth?provider=${p}&ret=${isNative ? "app" : "web"}&nonce=${pendingNonce}`));
    const j = await r.json().catch(() => ({}));
    if (!j.url) { popup?.close(); throw err(j.error || "Sign-in isn't available right now"); }
    if (popup) popup.location.href = j.url;
    else location.href = j.url; // the app shell opens this in the system browser
  },
  async disconnect(p: CloudId) {
    grants.delete(p); tokens.delete(p);
    state[p].items.forEach((i) => byId.delete(i.id));
    Object.assign(state[p], { account: "", folders: [], items: [], error: "" });
    await del(p, store).catch(() => {});
    changed();
  },
  /** Subfolders of a folder, for the folder browser ("root" is the top). */
  async folders(p: CloudId, folderId = "root"): Promise<Folder[]> {
    return (await children(p, folderId)).filter((e) => e.folder).map((e) => ({ id: e.id, name: e.name })).sort((a, b) => a.name.localeCompare(b.name));
  },
  async setFolders(p: CloudId, folders: Folder[]) {
    state[p].folders = folders;
    await save(p);
    await clouds.index(p);
  },
  /** Lists every photo and video in the chosen folders and all their subfolders. No cap. */
  async index(p: CloudId) {
    const s = state[p];
    if (s.indexing) return;
    s.indexing = true; s.error = ""; changed();
    const found = new Map<string, Item>();
    const seen = new Set<string>();
    try {
      const walk = async (id: string) => {
        if (seen.has(id)) return; // a folder chosen twice, or inside another chosen one
        seen.add(id);
        for (const e of await children(p, id)) {
          if (e.folder) await walk(e.id);
          else if (EXT.test(e.name)) {
            const it = toItem(p, e);
            found.set(it.id, it);
            if (found.size % 2000 === 0) { s.items = [...found.values()]; changed(); } // count climbs while it reads
          }
        }
      };
      for (const f of s.folders) await walk(f.id);
      s.items.forEach((i) => { if (!found.has(i.id)) byId.delete(i.id); });
      s.items = [...found.values()].sort((a, b) => b.takenAt - a.takenAt);
    } catch (e) { s.error = (e as Error).message; }
    finally { s.indexing = false; changed(); }
  },
  isCloudItem: (id: string) => byId.has(id),
  item: (id: string) => byId.get(id),
  /** Loads previews for these items (as data URLs, so Auto-pick can use them). */
  async previews(ids: string[]) {
    const want = ids.map((id) => byId.get(id)).filter((i): i is Item => !!i && !i.thumbUrl && !asked.has(i.id));
    want.forEach((i) => asked.add(i.id));
    const drop = want.filter((i) => i.source === "dropbox");
    for (let k = 0; k < drop.length; k += 25) {
      const batch = drop.slice(k, k + 25);
      try {
        const r = await call("dropbox", "https://content.dropboxapi.com/2/files/get_thumbnail_batch", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ entries: batch.map((i) => ({ path: i.remote, format: "jpeg", size: "w256h256", mode: "fitone_bestfit" })) }),
        }).then((x) => x.json());
        (r.entries ?? []).forEach((e: { thumbnail?: string }, n: number) => { if (e.thumbnail) batch[n].thumbUrl = "data:image/jpeg;base64," + e.thumbnail; });
      } catch { /* leave without a preview */ }
    }
    await Promise.all(want.filter((i) => i.source !== "dropbox" && i.thumbSrc).map(async (i) => {
      try {
        const r = await fetch(i.thumbSrc!);
        i.thumbUrl = r.ok ? await toDataUrl(await r.blob()) : i.thumbSrc;
      } catch { i.thumbUrl = i.thumbSrc; } // shown, though Auto-pick can't read it
    }));
    if (want.length) changed();
  },
  /** Downloads the full files these items need (only when an edit renders). */
  async ensureFiles(ids: string[]) {
    for (const id of ids) {
      const it = byId.get(id);
      if (!it || it.assetUrl) continue;
      const p = it.source as CloudId;
      let blob: Blob;
      if (p === "google") blob = await (await call(p, `https://www.googleapis.com/drive/v3/files/${it.remote}?alt=media&supportsAllDrives=true`)).blob();
      else if (p === "microsoft") {
        const j = await (await call(p, `https://graph.microsoft.com/v1.0/me/drive/items/${it.remote}?$select=@microsoft.graph.downloadUrl`)).json();
        blob = await (await fetch(j["@microsoft.graph.downloadUrl"])).blob();
      } else {
        const j = await dbx(p, "files/get_temporary_link", { path: it.remote });
        blob = await (await fetch(j.link)).blob();
      }
      it.assetUrl = URL.createObjectURL(blob);
      it.size = blob.size;
    }
    changed();
  },
};
