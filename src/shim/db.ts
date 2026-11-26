import { createStore, entries, set, del } from "idb-keyval";

/**
 * A small local database with the same surface the board uses on claude.ai
 * (collection → doc → set/update/replace/delete, onSnapshot). Everything lives
 * in this browser's IndexedDB.
 */
type Data = Record<string, unknown>;
type Snap = { docs: { id: string; exists: boolean; data: () => Data }[] };
type Listener = (snap: Snap) => void;

const store = createStore("hyperdistribution", "docs");
const cols = new Map<string, Map<string, Data>>();
const listeners = new Map<string, Set<Listener>>();
/** Extra read-only docs merged into a collection (e.g. files from the connected folder). */
const virtual = new Map<string, () => Map<string, Data>>();
let loaded: Promise<void> | null = null;
/** Told about every change made on this device (account sync pushes them). */
const writeHooks = new Set<(name: string, id: string, data: Data | null) => void>();
export const onLocalWrite = (fn: (name: string, id: string, data: Data | null) => void) => { writeHooks.add(fn); return () => writeHooks.delete(fn); };

const col = (name: string) => {
  if (!cols.has(name)) cols.set(name, new Map());
  return cols.get(name)!;
};

function load() {
  loaded ??= entries<string, Data>(store).then((all) => {
    for (const [key, data] of all) {
      const i = key.indexOf("/");
      col(key.slice(0, i)).set(key.slice(i + 1), data);
    }
  });
  return loaded;
}

function snapshot(name: string): Snap {
  // Virtual docs (a media folder, the phone's library) are read-only and can number tens of
  // thousands, so they're handed out as cheap shallow copies; stored docs are deep-copied.
  const docs = new Map<string, { id: string; exists: boolean; data: () => Data }>();
  for (const [id, d] of virtual.get(name)?.() ?? []) docs.set(id, { id, exists: true, data: () => ({ ...d }) });
  for (const [id, d] of col(name)) docs.set(id, { id, exists: true, data: () => structuredClone(d) });
  return { docs: [...docs.values()] };
}

function emit(name: string) {
  const snap = snapshot(name);
  listeners.get(name)?.forEach((l) => {
    try { l(snap); } catch (e) { console.error(e); }
  });
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clean = (d: Data) => JSON.parse(JSON.stringify(d)) as Data;

async function put(name: string, id: string, data: Data | null) {
  await load();
  if (data === null) {
    col(name).delete(id);
    await del(`${name}/${id}`, store);
  } else {
    col(name).set(id, data);
    await set(`${name}/${id}`, data, store);
  }
  emit(name);
}

/** Writes a change that came from the person's account (not echoed back to it). */
export const applyRemote = (name: string, id: string, data: Data | null) => put(name, id, data === null ? null : clean(data));

function docRef(name: string, id: string) {
  const write = async (data: Data | null) => {
    await put(name, id, data);
    writeHooks.forEach((fn) => { try { fn(name, id, data); } catch (e) { console.error(e); } });
  };
  return {
    id,
    set: (data: Data) => write(clean(data)),
    replace: (data: Data) => write(clean(data)),
    update: async (patch: Data) => {
      await load();
      const cur = col(name).get(id) ?? virtual.get(name)?.().get(id);
      if (!cur) throw Object.assign(new Error("not found"), { code: "not_found" });
      return write(clean({ ...cur, ...patch }));
    },
    delete: () => write(null),
    get: async () => {
      await load();
      const d = col(name).get(id);
      return { id, exists: !!d, data: () => (d ? structuredClone(d) : undefined) };
    },
  };
}

export const db = {
  collection(name: string) {
    return {
      doc: (id?: string) => docRef(name, id || newId()),
      where: (field: string, op: string, value: unknown) => query(name, [[field, op, value]]),
      get: () => query(name, []).get(),
      onSnapshot(cb: Listener, _onErr?: (e: unknown) => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(cb);
        load().then(() => cb(snapshot(name)));
        return () => listeners.get(name)?.delete(cb);
      },
    };
  },
};

type Cond = [string, string, unknown];
const test = (v: unknown, op: string, w: unknown) => {
  const a = v as number | string, b = w as number | string;
  switch (op) {
    case "==": return v === w;
    case "!=": return v !== w;
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    case "in": return Array.isArray(w) && w.includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(w);
    default: return false;
  }
};
function query(name: string, conds: Cond[]) {
  return {
    where: (field: string, op: string, value: unknown) => query(name, [...conds, [field, op, value]]),
    async get() {
      await load();
      const docs = snapshot(name).docs.filter((d) => {
        const data = d.data() as Record<string, unknown>;
        return conds.every(([f, op, v]) => test(data?.[f], op, v));
      });
      return { docs, empty: !docs.length, size: docs.length };
    },
  };
}

export function setVirtual(name: string, fn: () => Map<string, Data>) {
  virtual.set(name, fn);
  emit(name);
}
export const refresh = emit;
/** This device's stored docs in a collection (not virtual ones), for sync. */
export const storedDocs = async (name: string) => { await load(); return new Map(col(name)); };
export const docsOf = async (name: string) => { await load(); return snapshot(name).docs.map((d) => ({ ...d.data(), id: d.id })); };
