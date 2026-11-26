import { go, type ScreenProps } from "../App";
import { thisWeek } from "../store";
import { brandColor, Glyph, Icon, Mono } from "../ui";

export default function Dashboard({ brands, posts }: ScreenProps) {
  const week = thisWeek();
  const inWeek = (d?: string) => week.includes(d ?? "");
  const stats = [
    { n: posts.filter((p) => p.status === "idea").length, label: "To approve", href: "#/swipe" },
    { n: posts.filter((p) => p.status === "drafting").length, label: "In edit", href: "#/edit" },
    { n: posts.filter((p) => p.status === "scheduled").length, label: "Scheduled", href: "#/publish", color: "var(--info)" },
    { n: posts.filter((p) => p.status === "posted" && inWeek(p.date)).length, label: "Posted this week", href: "#/publish", color: "var(--ok)" },
  ];

  return (
    <main className="screen">
      <header className="head">
        <div>
          <span className="brandbar" aria-label="Hypercurated HyperMixer"><span className="hc-mark" aria-hidden="true" /><span className="hc-word">HyperMixer</span></span>
          <h1 style={{ marginTop: 10 }}>Dashboard</h1>
          <span className="small muted">This week · {brands.length} brand{brands.length === 1 ? "" : "s"}</span>
        </div>
        <a className="btn icon" href="#/connect" aria-label="Connections"><Icon name="link" size={20} /></a>
      </header>

      <div className="stats">
        {stats.map((s) => (
          <a key={s.label} href={s.href} className="card stat">
            <b style={{ color: s.color }}>{s.n}</b>
            <span className="small muted">{s.label}</span>
          </a>
        ))}
      </div>

      {brands.length ? (
        <section className="stack" aria-labelledby="d-b">
          <div className="eyebrow" id="d-b">Brands vs weekly target</div>
          <div className="card list">
            {brands.map((b) => {
              const mine = posts.filter((p) => p.brandId === b.id && (p.status === "posted" || p.status === "scheduled") && inWeek(p.date));
              const chans = b.channels ?? [];
              const target = chans.reduce((n, c) => n + (+(c.cadence ?? 0) || 0), 0);
              const done = mine.length;
              const r = target ? done / target : 0;
              const [tag, cls] = !target ? ["No target", "plain"] : r >= 1 ? ["Hit", "ok"] : r >= 0.5 ? ["On track", "ok"] : done ? ["Behind", "warn"] : ["Not started", "bad"];
              return (
                <a key={b.id} href="#/brands" className="stack" style={{ padding: "13px 14px", gap: 9, color: "inherit", textDecoration: "none" }}>
                  <div className="row">
                    <Mono brand={b} size={34} />
                    <strong className="grow ellipsis">{b.name}</strong>
                    <span className={`tag ${cls}`}>{tag}</span>
                  </div>
                  <div className="row">
                    <div className="bar grow" role="progressbar" aria-label={`${b.name} progress`} aria-valuemin={0} aria-valuemax={target || 1} aria-valuenow={done}>
                      <i style={{ width: `${Math.min(100, Math.round(r * 100))}%`, background: brandColor(b) }} />
                    </div>
                    <span className="small" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{done} / {target || "–"} posts</span>
                  </div>
                  {chans.length > 0 && (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {chans.map((c) => {
                        const n = mine.filter((p) => p.channelId === c.id).length;
                        return (
                          <span key={c.id} className="row small" style={{ gap: 5, border: "1px solid var(--line)", borderRadius: 999, padding: "2px 8px 2px 3px" }}>
                            <Glyph platform={c.platform} small />{n}/{c.cadence ?? 0}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="empty">
          <h2>Start with a brand</h2>
          <p>Connect Claude, add a brand, then swipe through its first drafts.</p>
          <button type="button" className="btn primary" onClick={() => go("brands")}>Add a brand</button>
        </div>
      )}
    </main>
  );
}
