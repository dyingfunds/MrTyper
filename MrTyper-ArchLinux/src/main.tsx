import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "./index.css";
import App from "./App";
import { PLATFORM } from "./lib/platform";
import { applyPalette, paletteColors } from "./lib/palette";
import {
  REDUCED_MOTION_QUERY,
  applyReducedMotion,
  loadUiPrefs,
  shouldReduceMotion,
} from "./lib/uiPrefs";

document.documentElement.dataset.platform = PLATFORM.id;

// Paint with the right palette and motion policy on the very first frame.
// The light or dark theme is only known once settings load, so start from
// the system's preference; App repaints if the saved theme differs.
const bootPrefs = loadUiPrefs();
applyPalette(
  paletteColors(bootPrefs.palette, bootPrefs.customPalettes),
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
);
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
