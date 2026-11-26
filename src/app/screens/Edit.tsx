import { useEffect, useState } from "react";
import { folder } from "../../shim/folder";
import { phone } from "../../shim/phone";
import { clouds } from "../../shim/clouds";
import { GROUPS, insights } from "../../shim/insights";
import { settingsStore } from "../../shim/services";
import { go, type ScreenProps } from "../App";
import { hasKey, pickClips } from "../ai";
import { isVideo, pf } from "../platforms";
import { col, savePost, useCollection, ymd, type Brand, type Media, type Post, type Render } from "../store";
import { brandColor, errText, Glyph, Icon, Mono, toast } from "../ui";

const STYLES = [["clean", "Clean"], ["punch", "Punchy, fast cuts"], ["camcorder", "Camcorder"], ["bw", "Black and white"]] as const;

export default function Edit({ brands, posts, arg }: ScreenProps) {
  const queue = posts.filter((p) => p.status === "drafting").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const post = posts.find((p) => p.id === arg && (p.status === "drafting" || p.status === "scheduled"));
  const brandOf = (id: string) => brands.find((b) => b.id === id);

  if (post) return <Editor key={post.id} post={post} brand={brandOf(post.brandId)} />;

  return (
    <main className="screen">
      <header className="head">
        <div>
          <h1>Edit</h1>
          <p>Approved posts. Polish, cut the video, set a time.</p>
        </div>
      </header>
      {queue.length ? (
        <div className="card list">
          {queue.map((p) => {
            const b = brandOf(p.brandId);
            return (
              <a key={p.id} href={`#/edit/${p.id}`} className="item" style={{ color: "inherit", textDecoration: "none" }}>
                <Mono brand={b} />
                <div className="grow stack" style={{ gap: 0 }}>
                  <strong className="ellipsis">{p.title}</strong>
                  <span className="small muted row" style={{ gap: 6 }}><Glyph platform={p.platform} small />{b?.name ?? "Brand"} · {p.format || "Post"}</span>
                </div>
                <span className={`tag ${isVideo(p.format) ? "info" : "plain"}`}>{isVideo(p.format) ? "Video" : "Text"}</span>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <h2>Nothing to edit</h2>
          <p>Approve drafts in Swipe and they land here.</p>
          <a className="btn primary" href="#/swipe">Go to Swipe</a>
        </div>
      )}
    </main>
  );
}

function Editor({ post, brand }: { post: Post; brand?: Brand }) {
  const media = useCollection<Media & { takenAt?: number }>("media")
    .filter((m) => m.kind === "video" || m.kind === "image")
    .sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0));
  const [limit, setLimit] = useState(48);
  // On-phone understanding: filter by what's in the photo, best first, hide screenshots and blurry shots.
  const [group, setGroup] = useState("all");
  const [hideJunk, setHideJunk] = useState(true);
  const junk = (id: string) => { const i = insights.get(id); return !!i && (i.isScreenshot || i.isBlurry); };
  const filtered = media.filter((m) => !(hideJunk && junk(m.id)) && (group === "all" || group === "best" || !!insights.get(m.id)?.groups.includes(group)));
  const ordered = group === "best" ? [...filtered].sort((a, b) => (insights.get(b.id)?.quality ?? 0.5) - (insights.get(a.id)?.quality ?? 0.5)) : filtered;
  const chips = insights.size() ? insights.counts(media.map((m) => m.id)).slice(0, 6) : [];
  const shown = ordered.slice(0, limit);
  const shownKey = shown.map((m) => m.id).join(",");
  // Inside the app, ask the phone for previews of what's on screen.
  useEffect(() => {
    const ids = shown.map((m) => m.id);
    if (phone.available) phone.previews(ids);
    clouds.previews(ids.filter(clouds.isCloudItem));
  }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const renders = useCollection<Render>("renders").filter((r) => r.postId === post.id).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const last = renders[0];
  const video = isVideo(post.format);
  const [title, setTitle] = useState(post.title);
  const [notes, setNotes] = useState(post.notes ?? "");
  const [clips, setClips] = useState<string[]>((post.edit?.clips ?? []).map((c) => c.mediaId));
  const [length, setLength] = useState(post.edit?.lengthSec ?? 20);
  const [style, setStyle] = useState(post.edit?.style ?? "clean");
  const [date, setDate] = useState(post.date || ymd());
  const [time, setTime] = useState(post.time || "09:00");

  // Keep edits as they're typed, so leaving the screen loses nothing.
  useEffect(() => {
    const t = setTimeout(() => {
      savePost(post.id, { title, notes, date, time, edit: { ...post.edit, style, lengthSec: length, clips: clips.map((mediaId) => ({ mediaId })) } }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [title, notes, clips, length, style, date, time]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string) => setClips((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 8 ? c : [...c, id]));
  const [picking, setPicking] = useState(false);
  const autoPick = async () => {
    if (!hasKey()) return toast("Claude isn't switched on yet");
    setPicking(true);
    try {
      // Rank the whole library on the phone: what fits the script, how good it is, how recent.
      // Only the top 24 previews go to Claude, which picks and orders the clips.
      const words = `${title} ${notes}`.toLowerCase();
      const wanted = GROUPS.filter(([, rx]) => rx.test(words)).map(([g]) => g);
      const now = Date.now();
      const score = (m: (typeof media)[number]) => {
        const i = insights.get(m.id);
        const fit = i ? i.groups.filter((g) => wanted.includes(g)).length + i.labels.filter((l) => words.includes(l.name.toLowerCase())).length : 0;
        const age = Math.min(1, (now - (m.takenAt ?? 0)) / (90 * 86_400_000));
        return (clips.includes(m.id) ? 5 : 0) + fit * 3 + (i?.quality ?? 0.5) * 2 + (1 - age);
      };
      const top = media.filter((m) => !junk(m.id)).map((m) => [score(m), m] as const).sort((a, b) => b[0] - a[0]).slice(0, 24).map(([, m]) => m);
      if (phone.available) await phone.previewsReady(top.map((m) => m.id));
      await clouds.previews(top.map((m) => m.id).filter(clouds.isCloudItem));
      const order = await pickClips({ title, notes, format: post.format }, top.map((m) => ({ ...m, thumbUrl: phone.item(m.id)?.thumbUrl ?? clouds.item(m.id)?.thumbUrl ?? m.thumbUrl })), length);
      if (order.length) { setClips(order); toast(`Claude picked ${order.length} clip${order.length > 1 ? "s" : ""}`); }
      else toast("Claude didn't find clips that fit. Pick them yourself.");
    } catch (e) { toast(errText(e)); }
    setPicking(false);
  };
  const connect = async () => {
    if (phone.available) return phone.state.items.length ? phone.pickFiles() : phone.scan();
    try { await folder.connect(); } catch (e) { if ((e as Error).name !== "AbortError") toast("Couldn't open that folder"); }
  };

  const render = async () => {
    if (!settingsStore.license()) { toast("Turn on video rendering in Connect"); return go("connect"); }
    if (!clips.length) return toast("Pick at least one clip or photo");
    try {
      const fromPhone = clips.filter((id) => phone.isPhoneItem(id));
      if (fromPhone.length) { toast(`Getting ${fromPhone.length} clip${fromPhone.length > 1 ? "s" : ""} from your phone…`); await phone.ensureFiles(fromPhone); }
      const fromCloud = clips.filter((id) => clouds.isCloudItem(id));
      if (fromCloud.length) { toast(`Downloading ${fromCloud.length} clip${fromCloud.length > 1 ? "s" : ""} from your drives…`); await clouds.ensureFiles(fromCloud); }
      await col("renders").doc().set({
        postId: post.id, brandId: post.brandId, brand: brand?.name ?? "", handle: brand?.channels?.find((c) => c.id === post.channelId)?.handle ?? "",
        title, script: notes, format: post.format ?? "", style, lengthSec: length, aspect: post.platform === "linkedin" ? "4:5" : "9:16", music: "",
        clips: clips.map((mediaId) => ({ mediaId })), colors: [brand?.color, brand?.color2],
        status: "queued", createdAt: Date.now(), updatedAt: Date.now(),
      });
      toast("Rendering on this device. Keep HyperMixer open.");
    } catch (e) { toast(errText(e)); }
  };

  const schedule = async () => {
    await savePost(post.id, { title, notes, date, time, status: "scheduled" });
    toast("Scheduled · in Publish");
    go("publish");
  };

  const rendering = last && (last.status === "queued" || last.status === "rendering");

  return (
    <main className="screen">
      <header className="head" style={{ alignItems: "center" }}>
        <a className="btn icon" href="#/edit" aria-label="Back to edit list"><Icon name="back" /></a>
        <div className="grow">
          <h1 style={{ fontSize: 24 }}>Editing</h1>
          <p className="row" style={{ gap: 6 }}><Glyph platform={post.platform} small />{brand?.name ?? "Brand"} · {pf(post.platform).label} {post.format}</p>
        </div>
        <span className={`tag ${post.status === "scheduled" ? "info" : "ok"}`}>{post.status === "scheduled" ? "Scheduled" : "Approved"}</span>
      </header>

      {video && (
        <div className="preview" style={{ background: brandColor(brand) }}>
          {last?.status === "done" && last.output?.assetUrl
            ? <video src={last.output.assetUrl} controls playsInline />
            : <div className="hook">{title}</div>}
        </div>
      )}

      <div className="field"><label htmlFor="e-hook">{video ? "Hook (on screen)" : "Headline"}</label><input id="e-hook" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="e-cap">{video ? "Caption and script" : "Post"}</label><textarea id="e-cap" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

      {video && (
        <section className="card stack" style={{ padding: 14, gap: 12 }} aria-label="Video edit">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong style={{ whiteSpace: "nowrap" }}>Clips{clips.length ? ` · ${clips.length}` : ""}</strong>
            <div className="row" style={{ gap: 8 }}>
              {media.length > 1 && <button type="button" className="btn pill" disabled={picking} onClick={autoPick}><Icon name="spark" size={16} />{picking ? "Picking…" : "Auto-pick"}</button>}
              <button type="button" className="btn pill" onClick={connect}>{phone.available ? (phone.state.items.length ? "Add files" : "Scan phone") : media.length ? "Change" : "Add media"}</button>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="row" style={{ gap: 6, overflowX: "auto", flexWrap: "nowrap", margin: "0 -14px", padding: "0 14px 2px", scrollbarWidth: "none" }} role="group" aria-label="Filter clips">
              {[["all", "All"], ["best", "Best"], ...chips.map(([g, n]) => [g, `${g[0].toUpperCase()}${g.slice(1)} · ${n}`])].map(([k, l]) => (
                <button key={k} type="button" className={`btn pill ${group === k ? "on" : ""}`} aria-pressed={group === k} onClick={() => { setGroup(k); setLimit(48); }}>{l}</button>
              ))}
              <button type="button" className={`btn pill ${hideJunk ? "on" : ""}`} aria-pressed={hideJunk} onClick={() => setHideJunk(!hideJunk)}>Hide screenshots</button>
            </div>
          )}
          {media.length ? (
            <div className="clips">
              {shown.map((m) => {
                const n = clips.indexOf(m.id);
                return (
                  <button key={m.id} type="button" className="clip" aria-pressed={n >= 0} aria-label={`${m.name}${n >= 0 ? `, clip ${n + 1}` : ""}`} onClick={() => pick(m.id)}>
                    {m.thumbUrl ? <img src={m.thumbUrl} alt="" /> : <span className="k">{m.kind === "video" ? "Video" : "Photo"}</span>}
                    {n >= 0 && <span className="n">{n + 1}</span>}
                  </button>
                );
              })}
            </div>
          ) : <p className="small muted" style={{ margin: 0 }}>{phone.available ? "Scan your phone's photos, or add files from OneDrive, Google Drive or Dropbox. They're read on this phone and never uploaded." : "Add the photos and clips to cut from. They're read on this device and never uploaded."}</p>}
          {ordered.length > limit && <button type="button" className="btn pill" style={{ alignSelf: "center" }} onClick={() => setLimit((n) => n + 48)}>Show more · {(ordered.length - limit).toLocaleString()}</button>}
          <div className="row wrap">
            <div className="field grow" style={{ minWidth: 150 }}>
              <label htmlFor="e-style">Style</label>
              <select id="e-style" value={style} onChange={(e) => setStyle(e.target.value)}>{STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            <div className="field" style={{ width: 130 }}>
              <label htmlFor="e-len">Length · {length}s</label>
              <input id="e-len" type="range" min={8} max={60} step={1} value={length} onChange={(e) => setLength(+e.target.value)} style={{ padding: 0 }} />
            </div>
          </div>
          {last && (
            <div className="stack" style={{ gap: 6 }} role="status">
              <span className="small">
                {last.status === "done" ? "Video ready" : last.status === "failed" ? <span style={{ color: "var(--bad)" }}>{last.error || "Render failed"}</span> : `Rendering · ${last.progress ?? 0}%`}
              </span>
              {rendering && <div className="bar"><i style={{ width: `${last.progress ?? 2}%` }} /></div>}
            </div>
          )}
          <button type="button" className="btn accent" disabled={!!rendering} onClick={render}>{last?.status === "done" ? "Render again" : rendering ? "Rendering…" : "Render video"}</button>
        </section>
      )}

      <div className="row">
        <div className="field grow"><label htmlFor="e-date">Day</label><input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field grow"><label htmlFor="e-time">Time</label><input id="e-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <button type="button" className="btn block primary" onClick={schedule}>{post.status === "scheduled" ? "Save and back to publish" : "Send to publish"}</button>
      {video && last?.status !== "done" && <p className="small muted" style={{ margin: 0, textAlign: "center" }}>You can schedule now and render later from here.</p>}
    </main>
  );
}
