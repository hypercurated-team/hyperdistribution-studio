import { useEffect, useState } from "react";
import { clouds, CLOUDS, type CloudId, type Folder } from "../../shim/clouds";
import { errText, Icon, Sheet, toast } from "../ui";

/** Browse a connected drive and choose the folders HyperMixer should use. */
export default function CloudFolders({ provider, onClose }: { provider: CloudId; onClose: () => void }) {
  const name = CLOUDS.find((c) => c.id === provider)!.name;
  const [trail, setTrail] = useState<Folder[]>([{ id: "root", name }]);
  const [list, setList] = useState<Folder[] | null>(null);
  const [chosen, setChosen] = useState<Folder[]>(clouds.state[provider].folders);
  const here = trail[trail.length - 1];

  useEffect(() => {
    let live = true;
    setList(null);
    clouds.folders(provider, here.id).then((f) => live && setList(f)).catch((e) => { if (live) { setList([]); toast(errText(e)); } });
    return () => { live = false; };
  }, [provider, here.id]);

  const isChosen = (id: string) => chosen.some((f) => f.id === id);
  const toggle = (f: Folder) => setChosen((c) => (isChosen(f.id) ? c.filter((x) => x.id !== f.id) : [...c, f]));
  const done = async () => {
    onClose();
    toast(chosen.length ? `Reading ${chosen.length} folder${chosen.length > 1 ? "s" : ""} from ${name}…` : `${name}: no folders chosen`);
    await clouds.setFolders(provider, chosen).catch((e) => toast(errText(e)));
  };

  return (
    <Sheet title={`${name} folders`} onClose={onClose}>
      <nav className="row wrap small" aria-label="Folder path" style={{ gap: 4 }}>
        {trail.map((f, i) => (
          <span key={f.id} className="row" style={{ gap: 4 }}>
            {i > 0 && <span className="muted">›</span>}
            <button type="button" className="btn pill" style={{ minHeight: 30 }} disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>{f.name}</button>
          </span>
        ))}
      </nav>
      {here.id !== "root" && (
        <button type="button" className={`btn ${isChosen(here.id) ? "on" : "primary"}`} onClick={() => toggle(here)}>
          <Icon name="check" size={16} />{isChosen(here.id) ? `Using “${here.name}”` : `Use “${here.name}”`}
        </button>
      )}
      <div className="card list" style={{ maxHeight: "45dvh", overflowY: "auto" }}>
        {list === null ? <div className="item muted small">Loading…</div>
          : !list.length ? <div className="item muted small">No folders here.</div>
          : list.map((f) => (
            <div className="item" key={f.id} style={{ minHeight: 52 }}>
              <button type="button" className="grow" onClick={() => setTrail([...trail, f])}
                style={{ textAlign: "left", background: "none", border: 0, padding: 0, minHeight: 44, color: "inherit", font: "inherit" }}>
                {f.name}
              </button>
              <button type="button" className={`btn pill ${isChosen(f.id) ? "on" : ""}`} aria-pressed={isChosen(f.id)} onClick={() => toggle(f)}>{isChosen(f.id) ? "Using" : "Use"}</button>
            </div>
          ))}
      </div>
      {chosen.length > 0 && <p className="small muted" style={{ margin: 0 }}>Using: {chosen.map((f) => f.name).join(", ")}. All subfolders are included.</p>}
      <button type="button" className="btn block primary" onClick={done}>Done</button>
    </Sheet>
  );
}
