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
import App from "./App";
import "./app.css";

(async () => {
  setupNative();
  // Learn whether Claude is built in before the first screen, but never wait long for it.
  await Promise.race([claudeStatus.refresh(), new Promise((r) => setTimeout(r, 1500))]);
  await registerWorker();
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  startRenderer();
  folder.restore().catch(() => {});
  phone.setup();
  // In the app, rescan the photos the person already allowed (no prompt the second time).
  try { if (phone.available && localStorage.getItem("hm:phone-scan")) phone.scan(); } catch { /* private mode */ }
})();
