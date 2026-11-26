import { createStore, get, set } from "idb-keyval";
import { auth } from "./auth";
import { applyRemote, onLocalWrite, storedDocs } from "./db";

/**
 * Account sync: a signed-in person's studio data (brands, posts, dumps, …)
 * is kept in their own space in the Hypercurated Firebase project,
 * users/{uid}/hm_<collection>/<doc>, readable and writable only by them
 * (Firestore rules). Talks to Firestore's REST API with the person's ID token.
 *
 * Each document is stored as { d: JSON text, t: last change (ms), x: deleted }.
 * The newest change wins. Sync runs at sign-in, whenever the app comes back to
 * the front, and a moment after every local change.
 */
export const SYNCED = ["brands", "posts", "dumps", "renders", "subs", "styles", "analyses", "kits", "setups", "campaigns", "messages"];
const MAX_DOC = 900_000; // Firestore's limit is 1 MiB per document

type Remote = { t: number; x: boolean; d: string };
type Status = "off" | "syncing" | "synced" | "error";

const metaStore = createStore("hm-sync", "meta");
let uid = "";
let meta = new Map<string, number>(); // "<collection>/<id>" → time of the change this device last saw or made
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;

const state = { status: "off" as Status, error: "", at: 0, pushed: 0, pulled: 0, skipped: 0 };
const changed = () => window.dispatchEvent(new Event("hm:sync"));

const base = () => `https://firestore.googleapis.com/v1/projects/${auth.config()!.projectId}/databases/(default)/documents`;
const docName = (c: string, id: string) => `projects/${auth.config()!.projectId}/databases/(default)/documents/users/${uid}/hm_${c}/${id}`;

class SyncError extends Error { code: number; constructor(m: string, code = 0) { super(m); this.code = code; } }

async function call(url: string, init: RequestInit = {}) {
  const tok = await auth.idToken();
  if (!tok) throw new SyncError("Signed out", 401);
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${tok}`, "content-type": "application/json" } }).catch(() => null);
  if (!r) throw new SyncError("No connection");
  if (r.status === 403) throw new SyncError("Account sync isn't switched on yet.", 403);
  if (!r.ok) throw new SyncError(`Sync failed (${r.status})`, r.status);
  return r.json();
}

async function listAll(c: string): Promise<Map<string, Remote>> {
  const out = new Map<string, Remote>();
  let page = "";
  do {
    const j = await call(`${base()}/users/${uid}/hm_${c}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    for (const doc of j.documents ?? []) {
      const f = doc.fields ?? {};
      out.set(String(doc.name).split("/").pop()!, { t: Number(f.t?.integerValue ?? 0), x: !!f.x?.booleanValue, d: f.d?.stringValue ?? "" });
    }
    page = j.nextPageToken ?? "";
  } while (page);
  return out;
}

async function loadMeta(u: string) {
  meta = new Map(Object.entries((await get<Record<string, number>>(u, metaStore).catch(() => undefined)) ?? {}));
}
const saveMeta = () => set(uid, Object.fromEntries(meta), metaStore).catch(() => {});

/** Sends this device's pending changes, in batches. */
async function flush() {
  if (!uid || !pending.size) return;
  const keys = [...pending];
  const byCol = new Map<string, Map<string, Record<string, unknown>>>();
  const writes: { key: string; body: unknown; size: number }[] = [];
  for (const key of keys) {
    const [c, ...rest] = key.split("/");
    const id = rest.join("/");
    if (!byCol.has(c)) byCol.set(c, await storedDocs(c));
    const data = byCol.get(c)!.get(id);
    const d = data ? JSON.stringify(data) : "";
    if (d.length > MAX_DOC) { pending.delete(key); state.skipped++; continue; }
    const t = meta.get(key) ?? Date.now();
    writes.push({ key, size: d.length + 200, body: { update: { name: docName(c, id), fields: { d: { stringValue: d }, t: { integerValue: String(t) }, x: { booleanValue: !data } } } } });
  }
  // Firestore takes up to 500 writes and 10 MiB per commit.
  for (let i = 0; i < writes.length;) {
    const batch: typeof writes = [];
    let size = 0;
    while (i < writes.length && batch.length < 200 && size + writes[i].size < 4_000_000) { size += writes[i].size; batch.push(writes[i++]); }
    await call(`${base()}:commit`, { method: "POST", body: JSON.stringify({ writes: batch.map((w) => w.body) }) });
    batch.forEach((w) => pending.delete(w.key));
    state.pushed += batch.length;
  }
  await saveMeta();
}

async function run() {
  const s = auth.state.session;
  if (!s || !auth.config()) { state.status = "off"; changed(); return; }
  if (s.uid !== uid) { uid = s.uid; pending.clear(); await loadMeta(uid); }
  state.status = "syncing"; state.error = ""; changed();
  try {
    for (const c of SYNCED) {
      const [remote, local] = await Promise.all([listAll(c), storedDocs(c)]);
      for (const [id, r] of remote) {
        const key = `${c}/${id}`;
        if (r.t > (meta.get(key) ?? 0)) {
          const data = r.x ? null : (() => { try { return JSON.parse(r.d); } catch { return undefined; } })();
          if (data !== undefined) { await applyRemote(c, id, data); state.pulled++; }
          meta.set(key, r.t);
        }
      }
      // Anything here that the account doesn't have yet (or that changed here since) goes up.
      for (const id of local.keys()) {
        const key = `${c}/${id}`, r = remote.get(id);
        if (!r) { if (!meta.has(key)) meta.set(key, Date.now()); pending.add(key); }
        else if ((meta.get(key) ?? 0) > r.t) pending.add(key);
      }
    }
    await saveMeta();
    await flush();
    state.status = "synced"; state.at = Date.now();
  } catch (e) {
    state.status = "error"; state.error = (e as Error).message;
  }
  changed();
}

export const sync = {
  state,
  /** Removes everything this account has synced (for deleting the account). Data on this device stays. */
  async wipeAccount() {
    const s = auth.state.session;
    if (!s || !auth.config()) return;
    clearTimeout(timer);
    uid = s.uid; pending.clear();
    const deletes: { delete: string }[] = [];
    for (const c of SYNCED) for (const id of (await listAll(c)).keys()) deletes.push({ delete: docName(c, id) });
    for (let i = 0; i < deletes.length; i += 400) await call(`${base()}:commit`, { method: "POST", body: JSON.stringify({ writes: deletes.slice(i, i + 400) }) });
    meta.clear(); await saveMeta();
  },
  /** Syncs now (or joins the sync already running). */
  now() { running ??= run().finally(() => { running = null; }); return running; },
  setup() {
    onLocalWrite((c, id) => {
      if (!SYNCED.includes(c) || !auth.state.session) return;
      const key = `${c}/${id}`;
      meta.set(key, Date.now());
      pending.add(key);
      clearTimeout(timer);
      timer = setTimeout(() => { flush().then(() => { if (state.status === "error") { state.status = "synced"; state.error = ""; } changed(); }, (e) => { state.status = "error"; state.error = (e as Error).message; changed(); }); }, 1500);
    });
    let was = auth.state.session?.uid ?? "";
    window.addEventListener("hm:auth", () => {
      const now = auth.state.session?.uid ?? "";
      if (now !== was) { was = now; if (now) sync.now(); else { uid = ""; pending.clear(); state.status = "off"; changed(); } }
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && auth.state.session) sync.now(); });
    if (auth.state.session) sync.now();
  },
};
