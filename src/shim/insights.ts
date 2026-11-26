import { createStore, entries, setMany } from "idb-keyval";

/**
 * What the phone understood about each photo (scene labels, faces, quality),
 * kept on this device. Raw labels from Apple Vision or ML Kit are folded into a
 * few plain groups for search and ranking. Nothing here is uploaded; only
 * group counts are ever shared with Claude.
 */
export type Insight = {
  id: string;
  labels: { name: string; conf: number }[];
  faces: number;
  quality: number;
  isScreenshot: boolean;
  isBlurry: boolean;
  isUtility?: boolean;
  groups: string[];
};

const store = createStore("hm-vision", "insights");
const all = new Map<string, Insight>();
let loaded: Promise<void> | null = null;

export const GROUPS: [string, RegExp][] = [
  ["people", /\b(people|person|selfie|smile|portrait|crowd|team|child|baby|wedding|bride)\b/],
  ["food", /\b(food|dish|meal|dessert|baked|bread|cake|pizza|cuisine|fruit|vegetable|coffee|tea|drink|beverage|cocktail|wine|beer|breakfast|lunch|dinner|snack|plate)\b/],
  ["outdoor", /\b(outdoor|sky|cloud|landscape|mountain|beach|sea|ocean|lake|river|tree|forest|nature|plant|flower|garden|park|sunset|sunrise|snow|road|street|city|building|structure)\b/],
  ["indoor", /\b(indoor|room|interior|furniture|kitchen|office|restaurant|cafe|shop|store|bedroom|living)\b/],
  ["product", /\b(product|bottle|package|packaging|box|cosmetic|shoe|bag|clothing|dress|shirt|watch|jewelry|phone|laptop|computer|electronics|gadget|tableware)\b/],
  ["animals", /\b(animal|dog|cat|pet|bird|horse|fish)\b/],
  ["vehicles", /\b(car|vehicle|motorcycle|bike|bicycle|truck|bus|wheel)\b/],
  ["events", /\b(concert|party|stage|festival|celebration|event|crowd|performance|sport|game)\b/],
  ["documents", /\b(document|text|paper|receipt|screen|monitor|whiteboard|handwriting)\b/],
];

export function groupsOf(i: Pick<Insight, "labels" | "faces" | "isScreenshot">): string[] {
  const words = i.labels.map((l) => l.name.toLowerCase().replace(/_/g, " ")).join(" ");
  const g = GROUPS.filter(([, rx]) => rx.test(words)).map(([name]) => name);
  if (i.faces > 0 && !g.includes("people")) g.unshift("people");
  if (i.isScreenshot && !g.includes("documents")) g.push("documents");
  return g;
}

export const insights = {
  load() {
    loaded ??= entries<string, Insight>(store).then((rows) => { for (const [k, v] of rows) all.set(k, v); }).catch(() => {});
    return loaded;
  },
  get: (id: string) => all.get(id),
  has: (id: string) => all.has(id),
  size: () => all.size,
  async save(rows: Omit<Insight, "groups">[]) {
    const full = rows.map((r) => ({ ...r, groups: groupsOf(r) }));
    full.forEach((r) => all.set(r.id, r));
    await setMany(full.map((r) => [r.id, r] as [string, Insight]), store).catch(() => {});
  },
  /** Group counts across the indexed library, biggest first. */
  counts(ids?: Iterable<string>): [string, number][] {
    const c = new Map<string, number>();
    const rows = ids ? [...ids].map((id) => all.get(id)).filter(Boolean) as Insight[] : [...all.values()];
    for (const r of rows) for (const g of r.groups) c.set(g, (c.get(g) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  },
};
