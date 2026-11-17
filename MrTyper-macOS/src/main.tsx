import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "./index.css";
import App from "./App";
import { PLATFORM } from "./lib/platform";
import {
  REDUCED_MOTION_QUERY,
  applyAccent,
  applyReducedMotion,
  loadUiPrefs,
  shouldReduceMotion,
} from "./lib/uiPrefs";

document.documentElement.dataset.platform = PLATFORM.id;

// Paint with the right accent and motion policy on the very first frame.
const bootPrefs = loadUiPrefs();
applyAccent(bootPrefs.accent);
applyReducedMotion(
  shouldReduceMotion(bootPrefs.motion, window.matchMedia(REDUCED_MOTION_QUERY).matches),
);

if (!("__TAURI_INTERNALS__" in window)) {
  document.documentElement.classList.add("browser-preview");
}

// The floating mini window loads the same page; its window label tells it
// apart. In a browser preview, open /?view=mini to see it.
const tauriLabel = (
  window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }
).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
const isMini =
  tauriLabel === "mini" || new URLSearchParams(window.location.search).get("view") === "mini";
if (isMini) document.documentElement.classList.add("is-mini-window");

const root = createRoot(document.getElementById("root")!);
if (isMini) {
  void import("./MiniBar").then(({ MiniBar }) => {
    root.render(
      <StrictMode>
        <MiniBar />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
