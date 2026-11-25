import { useState } from "react";
import { buildBrain, hasKey } from "../ai";
import { go, type ScreenProps } from "../App";
import { BRAND_COLORS, PLATFORMS } from "../platforms";
import { col, saveBrand, thisWeek, uid, type Brand, type Channel } from "../store";
import { brandColor, brandColor2, errText, Glyph, Icon, initials, Sheet, toast } from "../ui";

export default function Brands({ brands, posts }: ScreenProps) {
  const [open, setOpen] = useState<Brand | "new" | null>(null);
  const week = thisWeek();

  return (
    <main className="screen">
      <header className="head">
        <div>
          <h1>Brands</h1>
          <p>One card per brand. Its brain writes every post.</p>
        </div>
        <button type="button" className="btn icon primary" aria-label="Add brand" onClick={() => setOpen("new")}><Icon name="plus" /></button>
      </header>

      {!brands.length && (
        <div className="empty">
          <h2>Add your first brand</h2>
          <p>Paste its website or a profile link. Claude reads it and learns how the brand sounds.</p>
          <button type="button" className="btn primary" onClick={() => setOpen("new")}>Add brand</button>
        </div>
      )}

      {brands.map((b) => {
        const target = (b.channels ?? []).reduce((n, c) => n + (+(c.cadence ?? 0) || 0), 0);
        const done = posts.filter((p) => p.brandId === b.id && (p.status === "posted" || p.status === "scheduled") && week.includes(p.date ?? "")).length;
        const ready = !!b.brain?.summary;
        return (
          <button type="button" key={b.id} className="card bcard" onClick={() => setOpen(b)} aria-label={`Edit ${b.name}`}>
            <div className="bband" style={{ background: brandColor(b) }}>
              {b.industry && <span className="ind">{b.industry}</span>}
              <span className="mono" style={{ background: brandColor2(b) }} aria-hidden="true">{initials(b.name)}</span>
            </div>
            <div className="bbody">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>{b.name}</strong>
                <span className={`tag ${ready ? "ok" : "warn"}`}>{ready ? "Brain ready" : "Needs a brain"}</span>
              </div>
              <p>{b.brain?.tone || b.brain?.summary || "Add a website or profile link, then build its brain."}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                {(b.channels ?? []).map((c) => <Glyph key={c.id} platform={c.platform} />)}
                <span className="small muted" style={{ marginLeft: "auto" }}>{target ? `${done} of ${target} this week` : "No weekly target"}</span>
              </div>
            </div>
          </button>
        );
      })}

      {brands.length > 0 && (
        <button type="button" className="btn block primary" onClick={() => go("swipe")}>Draft posts to swipe</button>
      )}

      {open && <BrandSheet brand={open === "new" ? null : open} count={brands.length} onClose={() => setOpen(null)} />}
    </main>
  );
}

function BrandSheet({ brand, count, onClose }: { brand: Brand | null; count: number; onClose: () => void }) {
  const [name, setName] = useState(brand?.name ?? "");
  const [industry, setIndustry] = useState(brand?.industry ?? "");
  const [links, setLinks] = useState((brand?.links ?? []).join("\n"));
  const [color, setColor] = useState(brand?.color ?? BRAND_COLORS[count % BRAND_COLORS.length]);
  const [chans, setChans] = useState<Channel[]>(brand?.channels ?? []);
  const [busy, setBusy] = useState("");
  const [shots, setShots] = useState<File[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);

  const toggle = (platform: string) =>
    setChans((cs) => (cs.some((c) => c.platform === platform) ? cs.filter((c) => c.platform !== platform) : [...cs, { id: "c-" + uid(), platform, handle: "", cadence: 3 }]));
  const patch = (id: string, d: Partial<Channel>) => setChans((cs) => cs.map((c) => (c.id === id ? { ...c, ...d } : c)));
  const linkList = () => links.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s) || /\.[a-z]{2,}/i.test(s)).map((s) => (/^https?:/i.test(s) ? s : "https://" + s));

  const save = async (withBrain: boolean) => {
    if (!name.trim()) return toast("Give the brand a name");
    const data: Partial<Brand> & { name: string } = { name: name.trim(), industry: industry.trim(), links: linkList(), color, channels: chans };
    try {
      if (withBrain) {
        if (!hasKey()) { toast("Connect Claude first"); return go("connect"); }
        setBusy("Reading links and building the brain…");
        const { brain, read, seen } = await buildBrain(data, shots);
        data.brain = brain;
        const from = [read ? `${read} link${read > 1 ? "s" : ""}` : "", seen ? `${seen} screenshot${seen > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ");
        toast(from ? `Brain built from ${from}` : "Brain built from the name only. Add links or screenshots for a better one.");
      }
      await saveBrand(brand?.id ?? null, data);
      if (!withBrain) toast("Saved");
      onClose();
    } catch (e) {
      toast(errText(e));
    } finally { setBusy(""); }
  };

  return (
    <Sheet title={brand ? brand.name : "New brand"} onClose={onClose}>
      <div className="field"><label htmlFor="b-name">Name</label><input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand name" /></div>
      <div className="field"><label htmlFor="b-ind">What they do</label><input id="b-ind" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Coffee roaster" /></div>
      <div className="field">
        <label htmlFor="b-links">Links for the brain</label>
        <textarea id="b-links" value={links} onChange={(e) => setLinks(e.target.value)} placeholder={"Website, Instagram, LinkedIn…\none per line"} style={{ minHeight: 80 }} />
        <div className="row wrap">
          <label className="btn pill">
            {shots.length ? `${shots.length} screenshot${shots.length > 1 ? "s" : ""}` : "Add screenshots"}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setShots([...(e.target.files ?? [])].slice(0, 4))} />
          </label>
          {shots.length > 0 && <button type="button" className="btn pill" onClick={() => setShots([])}>Clear</button>}
        </div>
        <span className="hint">Optional: up to 4 screenshots of its Instagram or website. Claude reads the look and voice from them. They aren't saved.</span>
      </div>
      <div className="field">
        <span className="small" style={{ fontWeight: 600, color: "var(--muted)" }}>Colour</span>
        <div className="row wrap" role="radiogroup" aria-label="Brand colour">
          {BRAND_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
              style={{ width: 36, height: 36, borderRadius: 10, background: c, border: color === c ? "3px solid var(--ink)" : "1px solid var(--line)" }} />
          ))}
        </div>
      </div>
      <div className="stack">
        <span className="small" style={{ fontWeight: 600, color: "var(--muted)" }}>Channels and posts per week</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {Object.entries(PLATFORMS).map(([k, p]) => {
            const on = chans.some((c) => c.platform === k);
            return <button key={k} type="button" className={`btn pill ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(k)}>{p.label}</button>;
          })}
        </div>
        {chans.map((c) => (
          <div key={c.id} className="row">
            <Glyph platform={c.platform} />
            <input aria-label={`${PLATFORMS[c.platform]?.label ?? c.platform} handle`} className="grow" value={c.handle ?? ""} onChange={(e) => patch(c.id, { handle: e.target.value })} placeholder="@handle"
              style={{ minHeight: 44, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }} />
            <input aria-label="Posts per week" type="number" min={0} max={50} value={c.cadence ?? 0} onChange={(e) => patch(c.id, { cadence: Math.max(0, +e.target.value || 0) })}
              style={{ width: 64, minHeight: 44, padding: "0 10px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }} />
          </div>
        ))}
      </div>
      {brand?.brain?.summary && (
        <div className="card" style={{ padding: 12, background: "var(--sunk)" }}>
          <div className="eyebrow">Brain</div>
          <p style={{ margin: "4px 0 6px" }}>{brand.brain.summary}</p>
          {brand.brain.pillars?.length ? <p className="small muted" style={{ margin: 0 }}>Pillars: {brand.brain.pillars.join(", ")}</p> : null}
        </div>
      )}
      {busy && <p className="small muted" role="status" style={{ margin: 0 }}>{busy}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={!!busy} onClick={() => save(false)}>Save</button>
        <button type="button" className="btn primary grow" disabled={!!busy} onClick={() => save(true)}><Icon name="spark" size={18} />{brand?.brain ? "Save and rebuild brain" : "Save and build brain"}</button>
      </div>
      {brand && (
        confirmDel
          ? <div className="row"><span className="small grow">Delete {brand.name} and its posts?</span><button type="button" className="btn" onClick={() => setConfirmDel(false)}>Keep</button><button type="button" className="btn" style={{ color: "var(--bad)" }} onClick={async () => {
            const own = (await col("posts").where("brandId", "==", brand.id).get()).docs;
            for (const d of own) await col("posts").doc(d.id).delete();
            await col("brands").doc(brand.id).delete(); onClose(); toast("Brand deleted");
          }}>Delete</button></div>
          : <button type="button" className="btn" style={{ color: "var(--bad)", alignSelf: "flex-start" }} onClick={() => setConfirmDel(true)}>Delete brand</button>
      )}
    </Sheet>
  );
}
