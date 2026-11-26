import { useEffect, useState } from "react";
import { Icon, Toaster } from "./ui";
import { useCollection, type Brand, type Post } from "./store";
import { hasKey } from "./ai";
import Connect from "./screens/Connect";
import Brands from "./screens/Brands";
import Swipe from "./screens/Swipe";
import Edit from "./screens/Edit";
import Publish from "./screens/Publish";
import Dashboard from "./screens/Dashboard";
import SignIn from "./screens/SignIn";
import { auth } from "../shim/auth";

export type Route = "connect" | "brands" | "swipe" | "edit" | "publish" | "dashboard";
const ROUTES: Route[] = ["connect", "brands", "swipe", "edit", "publish", "dashboard"];

export const go = (r: Route, arg = "") => { location.hash = `#/${r}${arg ? "/" + arg : ""}`; };

function parse(): { route: Route; arg: string } {
  const [r = "", arg = ""] = location.hash.replace(/^#\/?/, "").split("/");
  return { route: ROUTES.includes(r as Route) ? (r as Route) : "" as Route, arg: decodeURIComponent(arg) };
}

export default function App() {
  const [loc, setLoc] = useState(parse);
  useEffect(() => {
    const on = () => { setLoc(parse()); scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const [, claudeTick] = useState(0);
  useEffect(() => {
    const on = () => claudeTick((n) => n + 1);
    addEventListener("hm:claude", on);
    return () => removeEventListener("hm:claude", on);
  }, []);
  const [, authTick] = useState(0);
  const [askSignIn, setAskSignIn] = useState(false);
  useEffect(() => {
    const on = () => authTick((n) => n + 1);
    const need = () => setAskSignIn(true);
    addEventListener("hm:auth", on);
    addEventListener("hm:need-signin", need);
    return () => { removeEventListener("hm:auth", on); removeEventListener("hm:need-signin", need); };
  }, []);
  const brands = useCollection<Brand>("brands");
  const posts = useCollection<Post>("posts");
  const live = brands.filter((b) => b.status !== "paused");

  // First visit: start at Connect until Claude is ready (built in, or the person's own key); then Dashboard.
  const route: Route = loc.route || (hasKey() && live.length ? "dashboard" : hasKey() ? "brands" : "connect");
  const counts = {
    swipe: posts.filter((p) => p.status === "idea").length,
    edit: posts.filter((p) => p.status === "drafting").length,
    publish: posts.filter((p) => p.status === "scheduled").length,
  };
  const props = { brands: live, posts, arg: loc.arg };

  // First run (or when the free AI needs an account): sign in, or "Not now".
  const a = auth.state;
  if (a.enabled && !a.session && (askSignIn || !a.skipped || a.required)) {
    return <div className="app"><SignIn onDone={() => setAskSignIn(false)} /><Toaster /></div>;
  }

  return (
    <div className="app">
      {route === "connect" && <Connect {...props} />}
      {route === "brands" && <Brands {...props} />}
      {route === "swipe" && <Swipe {...props} />}
      {route === "edit" && <Edit {...props} />}
      {route === "publish" && <Publish {...props} />}
      {route === "dashboard" && <Dashboard {...props} />}
      <nav className="nav" aria-label="Main">
        <div className="nav-in">
          {([
            ["dashboard", "Dashboard", "home", 0],
            ["brands", "Brands", "brands", 0],
            ["swipe", "Swipe", "swipe", counts.swipe],
            ["edit", "Edit", "edit", counts.edit],
            ["publish", "Publish", "publish", counts.publish],
          ] as const).map(([r, label, icon, n]) => (
            <a key={r} href={`#/${r}`} aria-current={route === r ? "page" : undefined}>
              <Icon name={icon} />{label}
              {n > 0 && <span className="badge" aria-label={`${n} waiting`}>{n > 99 ? "99+" : n}</span>}
            </a>
          ))}
        </div>
      </nav>
      <Toaster />
    </div>
  );
}

export type ScreenProps = { brands: Brand[]; posts: Post[]; arg: string };
