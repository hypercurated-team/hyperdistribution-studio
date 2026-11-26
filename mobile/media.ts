import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Asset, AssetField, MediaType, Query, presentPermissionsPicker, requestPermissionsAsync } from "expo-media-library";
import * as VideoThumbnails from "expo-video-thumbnails";
import { HmVision } from "./modules/hm-vision";

/**
 * The phone's media for the HyperMixer page: the photos and videos the person
 * allows (all, or a limited selection), and files picked from Files / cloud
 * drives. Everything is read on the phone and handed to the page in pieces;
 * nothing is uploaded.
 *
 * The whole allowed library is scanned (tens of thousands is fine): only
 * metadata goes over at first, in pages of 400.
 *
 * Item ids: "p:<asset id>|<name>" for the photo library, "d:<n>|<name>" for
 * picked files. Images are handed over as JPEG, so their names end in .jpg.
 */
export type Send = (m: Record<string, unknown>) => void;
type Item = { id: string; name: string; kind: "image" | "video"; w?: number; h?: number; d?: number; t?: number; src: "phone" | "files" };

const PAGE = 400;
const CHUNK = 1_500_000;
const docs = new Map<string, { uri: string; kind: "image" | "video" }>();

const jpgName = (name: string) => name.replace(/\.[^.]+$/, "") + ".jpg";

export async function scan(send: Send) {
  const perm = await requestPermissionsAsync(false, ["photo", "video"]);
  const access = perm.granted ? (perm.accessPrivileges === "limited" ? "limited" : "all") : "none";
  send({ type: "media-perm", access, canAsk: perm.canAskAgain });
  if (access === "none") return;
  let offset = 0;
  for (;;) {
    const page = await new Query()
      .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .limit(PAGE)
      .offset(offset)
      .exeForMetadata();
    const items: Item[] = page.map((a) => {
      const kind = a.mediaType === MediaType.VIDEO ? "video" : "image";
      const raw = a.filename || (kind === "video" ? "clip.mov" : "photo.jpg");
      const name = kind === "image" ? jpgName(raw) : raw;
      return { id: `p:${a.id}|${name}`, name, kind, w: a.width ?? undefined, h: a.height ?? undefined, d: a.duration ?? undefined, t: a.creationTime ?? undefined, src: "phone" };
    });
    offset += page.length;
    const done = page.length < PAGE;
    send({ type: "media-items", items, done, total: offset });
    if (done) break;
  }
}

/** iOS limited access: lets the person change which photos HyperMixer can see. */
export async function changeSelection() {
  await presentPermissionsPicker(["photo", "video"]);
}

/** Files app / Android picker: OneDrive, Google Drive, Dropbox, iCloud Drive and the rest show up here when installed. */
export async function pickFiles(send: Send) {
  const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "video/*"], multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return;
  const items: Item[] = res.assets.map((f) => {
    const kind = (f.mimeType || "").startsWith("video") || /\.(mov|mp4|m4v|webm)$/i.test(f.name) ? "video" : "image";
    const name = kind === "image" ? jpgName(f.name) : f.name;
    const id = `d:${docs.size + 1}-${Date.now().toString(36)}|${name}`;
    docs.set(id, { uri: f.uri, kind });
    return { id, name, kind, t: Date.now(), src: "files" };
  });
  send({ type: "files-items", items });
}

async function sourceOf(id: string): Promise<{ uri: string; kind: "image" | "video" }> {
  const doc = docs.get(id);
  if (doc) return doc;
  if (!id.startsWith("p:")) throw new Error("unknown item");
  const assetId = id.slice(2, id.lastIndexOf("|"));
  const asset = new Asset(assetId);
  const kind = (await asset.getMediaType()) === MediaType.VIDEO ? "video" : "image";
  return { uri: await asset.getUri(), kind };
}

async function jpeg(uri: string, max: number, compress: number) {
  const img = await ImageManipulator.manipulate(uri).resize({ width: max }).renderAsync();
  return img.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
}

/** Small previews, sent one by one as they're ready. */
export async function thumbs(ids: string[], send: Send) {
  for (const id of ids.slice(0, 120)) {
    try {
      const { uri, kind } = await sourceOf(id);
      const still = kind === "video" ? (await VideoThumbnails.getThumbnailAsync(uri, { time: 1000, quality: 0.6 })).uri : uri;
      const out = await jpeg(still, 256, 0.6);
      send({ type: "media-thumb", id, data: out.base64 });
    } catch {
      send({ type: "media-thumb", id, data: null });
    }
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}

/** The whole file, in pieces. Photos go as JPEG (up to 2160 px); videos as they are. */
export async function sendFile(id: string, req: string, send: Send) {
  try {
    const { uri, kind } = await sourceOf(id);
    const path = kind === "image" ? (await jpeg(uri, 2160, 0.9)).uri : uri;
    const file = new File(path);
    const handle = file.open();
    try {
      send({ type: "file-start", req, mime: kind === "image" ? "image/jpeg" : file.type || "video/mp4", size: handle.size });
      for (;;) {
        const bytes = await handle.readBytes(CHUNK);
        if (!bytes.length) break;
        send({ type: "file-chunk", req, data: base64(bytes) });
      }
    } finally { handle.close(); }
    send({ type: "file-end", req });
  } catch (e) {
    send({ type: "file-error", req, error: (e as Error)?.message || "Couldn't read that file" });
  }
}

/**
 * What the phone sees in each photo: scene labels, faces and quality, from the
 * native vision module (Apple Vision / ML Kit). Library photos only; picked
 * files are skipped. Nothing leaves the phone.
 */
export async function analyze(ids: string[], req: string, send: Send) {
  if (!HmVision) return send({ type: "vision-results", req, unavailable: true, results: [] });
  const assetIds = new Map<string, string>();
  for (const id of ids.slice(0, 60)) if (id.startsWith("p:")) assetIds.set(id.slice(2, id.lastIndexOf("|")), id);
  try {
    const found = assetIds.size ? await HmVision.analyze([...assetIds.keys()]) : [];
    send({ type: "vision-results", req, results: found.map((r) => ({ ...r, id: assetIds.get(r.id) ?? r.id })) });
  } catch (e) {
    send({ type: "vision-results", req, error: (e as Error)?.message || "vision failed", results: [] });
  }
}
