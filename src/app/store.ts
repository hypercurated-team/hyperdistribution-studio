import { useEffect, useState } from "react";
import { db } from "../shim/db";

/** The shapes HyperMixer keeps. They match the classic board's, so both read the same data. */
export type Channel = { id: string; platform: string; handle?: string; cadence?: number };
export type Brain = {
  summary?: string; audience?: string; personality?: string[]; tone?: string | Record<string, number>;
  pillars?: string[]; hooks?: string[]; dos?: string[]; donts?: string[];
};
/** A brain's tone as words: a sentence, or (from the classic board) sliders shown as the strongest traits. */
export const toneText = (t: Brain["tone"]): string =>
  typeof t === "string" ? t
  : t && typeof t === "object" ? Object.entries(t).filter(([, v]) => typeof v === "number").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(", ")
  : "";

export type Brand = {
  id: string; name: string; industry?: string; color?: string; color2?: string;
  links?: string[]; channels?: Channel[]; brain?: Brain; status?: string; createdAt?: number;
};
export type Status = "idea" | "drafting" | "scheduled" | "posted";
export type Post = {
  id: string; brandId: string; channelId?: string; platform?: string;
  title: string; notes?: string; format?: string; status: Status;
  date?: string; time?: string; why?: string; createdAt?: number; postedAt?: number;
  edit?: { style?: string; lengthSec?: number; clips?: { mediaId: string }[] };
};
export type Render = {
  id: string; postId?: string; status: string; progress?: number; error?: string;
  output?: { assetUrl: string }; createdAt?: number;
};
export type Media = { id: string; kind: string; name: string; assetUrl?: string; thumbUrl?: string; durationSec?: number };

type Doc = { id: string };

/** Live list of a collection, kept in step with every write. */
export function useCollection<T extends Doc>(name: string): T[] {
  const [docs, setDocs] = useState<T[]>([]);
  useEffect(() => {
    const off = db.collection(name).onSnapshot((snap) => setDocs(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T)));
    return () => { off(); };
  }, [name]);
  return docs;
}

export const col = (name: string) => db.collection(name);
export const now = () => Date.now();
export const uid = () => Math.random().toString(36).slice(2, 10);

export const savePost = (id: string, data: Partial<Post>) => col("posts").doc(id).update({ ...data, updatedAt: now() });
export const addPost = (data: Omit<Post, "id">) => col("posts").doc().set({ ...data, createdAt: now(), updatedAt: now() });
export const deletePost = (id: string) => col("posts").doc(id).delete();
export const saveBrand = (id: string | null, data: Partial<Brand>) =>
  id ? col("brands").doc(id).update({ ...data, updatedAt: now() }) : col("brands").doc().set({ ...data, createdAt: now(), updatedAt: now() });

/** YYYY-MM-DD in local time. */
export const ymd = (d = new Date()) => {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
/** Monday to Sunday of the current week. */
export const thisWeek = () => {
  const d = new Date();
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
};
export const dayLabel = (date?: string) => {
  if (!date) return "No date";
  const today = ymd();
  const tmr = ymd(new Date(Date.now() + 86_400_000));
  if (date === today) return "Today";
  if (date === tmr) return "Tomorrow";
  return new Date(date + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
};
