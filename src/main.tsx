import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "./index.css";
import App from "./App";
import {
  REDUCED_MOTION_QUERY,
  applyAccent,
  applyReducedMotion,
  loadUiPrefs,
  shouldReduceMotion,
} from "./lib/uiPrefs";

// Paint with the right accent and motion policy on the very first frame.
const bootPrefs = loadUiPrefs();
applyAccent(bootPrefs.accent);
applyReducedMotion(
  shouldReduceMotion(bootPrefs.motion, window.matchMedia(REDUCED_MOTION_QUERY).matches),
);

if (!("__TAURI_INTERNALS__" in window)) {
  document.documentElement.classList.add("browser-preview");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
