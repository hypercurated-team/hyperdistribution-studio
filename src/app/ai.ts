import { claudeStatus, sample } from "../shim/services";
import { apiUrl } from "../shim/platform";
import { PLATFORMS } from "./platforms";
import type { Brain, Brand } from "./store";

/** True when Claude can be used: built in by HyperMixer, or the person added their own key. */
export const hasKey = () => claudeStatus.ready();

async function readLink(url: string): Promise<string> {
  const res = await fetch(apiUrl("/api/read-link"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.text) throw new Error(data.error || "Couldn't read that page");
  return String(data.text);
}

/** Reads the brand's links and asks Claude for a compact voice and content profile. */
export async function buildBrain(brand: Pick<Brand, "name" | "industry" | "links">): Promise<{ brain: Brain; read: number }> {
  const texts: string[] = [];
  for (const url of (brand.links ?? []).slice(0, 4)) {
    try { texts.push(`--- ${url} ---\n${(await readLink(url)).slice(0, 7000)}`); } catch { /* skip unreadable links */ }
  }
  const brain = (await sample.json(`You are a brand strategist. Build a "brand brain" for ${brand.name}${brand.industry ? ` (${brand.industry})` : ""}: a compact voice and content profile a content team will use to write every post.
${texts.length ? `What their own pages say:\n${texts.join("\n\n")}` : "No pages could be read. Work from the name and industry only, keep claims generic and say nothing you can't know."}
Reply with only JSON:
{"summary":"one sentence: who they are and why people care","audience":"who they speak to","personality":["3-5 single words"],"tone":"one sentence on how they sound","pillars":["3-5 recurring content themes"],"hooks":["5 opening lines in their voice"],"dos":["3 rules"],"donts":["3 rules"]}`)) as Brain;
  return { brain, read: texts.length };
}

export type Draft = { channelId: string; format: string; hook: string; caption: string; why: string };

/** Asks Claude for fresh post drafts for one brand, spread across its channels. */
export async function draftPosts(brand: Brand, count = 5): Promise<Draft[]> {
  const chans = (brand.channels ?? []).map((c) => ({ id: c.id, platform: PLATFORMS[c.platform]?.label ?? c.platform, formats: PLATFORMS[c.platform]?.formats ?? ["Post"] }));
  if (!chans.length) throw new Error(`Add a channel to ${brand.name} first.`);
  const out = (await sample.json(`You write social posts for ${brand.name}.
Brand brain: ${JSON.stringify(brand.brain ?? { summary: brand.industry ?? "" })}
Channels: ${JSON.stringify(chans)}
Write ${count} new post drafts, spread across the channels, each native to its platform and true to the brand's voice and pillars. No invented facts, prices or statistics; use [placeholders] where a fact is needed.
Reply with only JSON: {"drafts":[{"channelId":"one of the channel ids","format":"one of that channel's formats","hook":"the first line or on-screen hook, under 12 words","caption":"the full caption or script, ready to post","why":"which pillar, 2-4 words"}]}`)) as { drafts?: Draft[] };
  const ids = new Set(chans.map((c) => c.id));
  return (out.drafts ?? []).filter((d) => d && ids.has(d.channelId) && d.hook);
}
