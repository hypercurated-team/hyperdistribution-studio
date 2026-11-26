import { get, set, del } from "idb-keyval";
import { setVirtual } from "./db";
import { isMobile } from "./platform";

/**
 * The connected media folder. Files are read in the browser and never uploaded;
 * they show up in the board's "media" collection as read-only docs whose id is
 * the file's path inside the folder.
 */
type Kind = "video" | "image" | "audio";
export type FolderItem = {
  id: string; name: string; path: string; kind: Kind; size: number;
  assetUrl: string; thumbUrl?: string; durationSec?: number; width?: number; height?: number;
  takenAt: number; addedAt: number; tags: string[]; description: string; source: "folder" | "phone" | "files" | "google" | "microsoft" | "dropbox";
};
type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission(o: { mode: "read" }): Promise<PermissionState>;
};

const EXT: Record<string, Kind> = {
  mp4: "video", mov: "video", m4v: "video", webm: "video",
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", avif: "image",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio",
};
const HANDLE = "hds:folder";
const MAX = 3000;
const kindOf = (n: string) => EXT[n.split(".").pop()?.toLowerCase() ?? ""];

const state = { name: "", items: [] as FolderItem[], scanning: false, stored: null as DirHandle | null };
// Other media sources (the phone's library and picked files inside the app) join the same list.
const sources: (() => FolderItem[])[] = [];
export const addMediaSource = (fn: () => FolderItem[]) => { sources.push(fn); changed(); };
const publish = () => setVirtual("media", () => new Map(state.items.concat(...sources.map((f) => f())).map((i) => [i.id, i as unknown as Record<string, unknown>])));
const changed = () => { publish(); window.dispatchEvent(new Event("hds:folder")); };
export const mediaChanged = () => changed();

async function walk(dir: DirHandle, prefix: string, out: { file: File; path: string }[]) {
  for await (const h of dir.values()) {
    if (out.length >= MAX || h.name.startsWith(".")) continue;
    if (h.kind === "directory") await walk(h as DirHandle, `${prefix}${h.name}/`, out);
    else if (kindOf(h.name)) out.push({ file: await (h as FileSystemFileHandle).getFile(), path: prefix + h.name });
  }
}

async function probe(it: FolderItem): Promise<Partial<FolderItem>> {
  const canvas = document.createElement("canvas");
  const shot = (el: CanvasImageSource, w: number, h: number) => {
    const s = 320 / Math.max(w, h);
    canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
    canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  };
  if (it.kind === "image") {
    const img = new Image(); img.src = it.assetUrl; await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, thumbUrl: shot(img, img.naturalWidth, img.naturalHeight) };
  }
  const el = document.createElement(it.kind === "video" ? "video" : "audio") as HTMLVideoElement;
  el.muted = true; el.preload = "metadata"; el.src = it.assetUrl;
  await new Promise<void>((res, rej) => { el.onloadedmetadata = () => res(); el.onerror = () => rej(new Error("unreadable")); });
  const durationSec = Math.round(el.duration * 10) / 10;
  if (it.kind === "audio") return { durationSec };
  el.currentTime = Math.min(1, el.duration / 2);
  await new Promise<void>((res) => { el.onseeked = () => res(); setTimeout(res, 3000); });
  return { durationSec, width: el.videoWidth, height: el.videoHeight, thumbUrl: shot(el, el.videoWidth, el.videoHeight) };
}

async function ingest(files: { file: File; path: string }[], name: string) {
  state.items.forEach((i) => URL.revokeObjectURL(i.assetUrl));
  state.name = name;
  state.items = files.map(({ file, path }) => ({
    id: "f:" + path, name: file.name, path, kind: kindOf(file.name), size: file.size,
    assetUrl: URL.createObjectURL(file), takenAt: file.lastModified, addedAt: file.lastModified,
    tags: path.split("/").slice(0, -1).map((t) => t.toLowerCase()), description: "", source: "folder",
  }));
  changed();
  for (let i = 0; i < state.items.length; i += 6) {
    const batch = state.items.slice(i, i + 6);
    const res = await Promise.all(batch.map((it) => probe(it).catch(() => ({}))));
    batch.forEach((it, k) => Object.assign(it, res[k]));
    if (i % 30 === 0 || i + 6 >= state.items.length) changed();
  }
}

async function scan(dir: DirHandle) {
  state.scanning = true; changed();
  try { const out: { file: File; path: string }[] = []; await walk(dir, "", out); await ingest(out, dir.name); }
  finally { state.scanning = false; changed(); }
}

export const folder = {
  state,
  supportsPicker: () => "showDirectoryPicker" in window,
  async restore() {
    const h = await get<DirHandle>(HANDLE).catch(() => undefined);
    if (!h) return;
    state.name = h.name;
    if ((await h.queryPermission({ mode: "read" })) === "granted") await scan(h);
    else { state.stored = h; changed(); }
  },
  async connect() {
    if (state.stored && (await state.stored.requestPermission({ mode: "read" })) === "granted") {
      const h = state.stored; state.stored = null; return scan(h);
    }
    if (this.supportsPicker()) {
      const dir = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker({ mode: "read" });
      await set(HANDLE, dir).catch(() => {});
      state.stored = null;
      return scan(dir);
    }
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    // Phones can't pick a folder: let them pick clips, photos and music from the library instead.
    if (isMobile) input.accept = "image/*,video/*,audio/*";
    else input.setAttribute("webkitdirectory", "");
    input.onchange = () => {
      const files = [...(input.files ?? [])].filter((f) => kindOf(f.name)).slice(0, MAX);
      const rel = (f: File) => (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name;
      if (!files.length) return;
      if (isMobile) return ingest(files.map((file) => ({ file, path: file.name })), "Library picks");
      ingest(files.map((file) => ({ file, path: rel(file).split("/").slice(1).join("/") || file.name })), rel(files[0]).split("/")[0]);
    };
    input.click();
  },
  async disconnect() {
    await del(HANDLE).catch(() => {});
    state.items.forEach((i) => URL.revokeObjectURL(i.assetUrl));
    Object.assign(state, { name: "", items: [], stored: null });
    changed();
  },
  note() {
    const n = state.items.length;
    const btn = (label: string, act: string) => `<button class="btn sm" data-hdsfolder="${act}">${label}</button>`;
    if (!state.name) return isMobile
      ? `Pick the photos, clips and music to work with. They're read on this device and never uploaded. ${btn("📷 Pick media", "connect")}`
      : `Connect the folder where your photos, clips and music live. Files are read in your browser and never uploaded. ${btn("📁 Connect folder", "connect")}`;
    if (state.stored) return `Folder “${state.name}” needs permission again. ${btn("Reconnect", "connect")}`;
    return `📁 ${state.name} · ${state.scanning ? "scanning…" : `${n} file${n === 1 ? "" : "s"}`} ${btn(isMobile ? "Pick again" : "Change folder", "connect")} ${btn(isMobile ? "Clear" : "Disconnect", "disconnect")}`;
  },
};
