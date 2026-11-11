import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { friendlyError, isTauri } from "./bridge";

/** Where people without a self-updating install download new versions. */
export const RELEASES_URL = "https://github.com/dyingfunds/MrTyper/releases/latest";

export type UpdateState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; canInstall: boolean }
  | { status: "downloading"; version: string; percent: number | null }
  | { status: "installed"; version: string }
  | { status: "error"; message: string };

export const INITIAL_UPDATE_STATE: UpdateState = isTauri
  ? { status: "idle" }
  : { status: "unsupported" };

/** The update found by the last check, kept out of React state. */
let pending: Update | null = null;

/**
 * Ask GitHub for the latest release. Installs that can't replace themselves
 * (Linux .deb, .rpm and Arch packages) are told about the update but are sent
 * to the download page instead.
 */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!isTauri) return { status: "unsupported" };
  try {
    const [update, canInstall] = await Promise.all([
      check({ timeout: 20_000 }),
      invoke<boolean>("can_self_update").catch(() => false),
    ]);
    pending = update;
    if (!update) return { status: "current" };
    return { status: "available", version: update.version, canInstall };
  } catch (error) {
    return { status: "error", message: friendlyError(error) };
  }
}

/**
 * Download, verify and install the pending update, then restart MrTyper.
 * On Windows the installer closes MrTyper itself and reopens it when done.
 */
export async function installUpdate(onProgress: (percent: number | null) => void): Promise<void> {
  const update = pending;
  if (!update) throw new Error("Check for updates first.");

  let total = 0;
  let received = 0;
  let lastPercent = -1;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(total ? 0 : null);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      if (!total) return;
      // Report whole percents only, so progress costs at most 100 renders.
      const percent = Math.min(100, Math.floor((received / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    }
  });
  await relaunch();
}

export async function openReleasePage(): Promise<void> {
  if (!isTauri) {
    window.open(RELEASES_URL, "_blank", "noopener");
    return;
  }
  await openUrl(RELEASES_URL);
}

export function updateTitle(state: UpdateState): string {
  switch (state.status) {
    case "unsupported":
      return "Updates run in the desktop app";
    case "checking":
      return "Checking for updates…";
    case "current":
      return "MrTyper is up to date";
    case "available":
      return `MrTyper ${state.version} is available`;
    case "downloading":
      return `Downloading ${state.version}${state.percent === null ? "…" : ` · ${state.percent}%`}`;
    case "installed":
      return `Installing ${state.version}…`;
    case "error":
      return "Couldn't check for updates";
    default:
      return "Check for updates";
  }
}

export function updateDescription(state: UpdateState): string {
  switch (state.status) {
    case "unsupported":
      return "The browser preview can't update itself.";
    case "available":
      return state.canInstall
        ? "MrTyper downloads it, checks its signature, installs it and restarts."
        : "This install was set up by your package manager, so get the new version from the download page.";
    case "downloading":
      return "MrTyper restarts by itself when the update is installed.";
    case "installed":
      return "MrTyper is restarting.";
    case "error":
      return state.message;
    default:
      return `You have version ${__APP_VERSION__}.`;
  }
}
