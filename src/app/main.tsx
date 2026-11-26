/**
 * HyperMixer: six modules, one path. Connect → Brands → Swipe → Edit → Publish,
 * with the Dashboard as home. Data, Claude, media and rendering come from the
 * same local services the classic board (board.html) uses, so both read the
 * same brands and posts.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerWorker } from "../shim/assets";
import { folder } from "../shim/folder";
import { setupNative } from "../shim/native";
import { startRenderer } from "../shim/render";
import { claudeStatus } from "../shim/services";
import { phone } from "../shim/phone";
import { clouds } from "../shim/clouds";
import App from "./App";
import { auth } from "../shim/auth";
import { SignInRelay } from "./screens/SignIn";
import "./app.css";

(async () => {
  // Opened by the app in the phone's browser to sign in with Apple, Google or Microsoft: just that page.
  if (new URLSearchParams(location.search).has("signin")) {
    createRoot(document.getElementById("root")!).render(<StrictMode><SignInRelay /></StrictMode>);
    return;
  }
  setupNative();
  // Learn whether Claude is built in before the first screen, but never wait long for it.
  await Promise.race([Promise.all([claudeStatus.refresh(), auth.setup()]), new Promise((r) => setTimeout(r, 1500))]);
  await registerWorker();
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  startRenderer();
  folder.restore().catch(() => {});
  phone.setup();
  clouds.setup().catch(() => {});
  // In the app, rescan the photos the person already allowed (no prompt the second time).
  try { if (phone.available && localStorage.getItem("hm:phone-scan")) phone.scan(); } catch { /* private mode */ }
})();
