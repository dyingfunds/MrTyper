/**
 * Everything the UI needs to know about the platform it runs on.
 *
 * This is the only frontend file that differs between the three MrTyper apps
 * (repository root = Windows, MrTyper-macOS/, MrTyper-ArchLinux/). Every other
 * file under src/ is identical in all three; `node scripts/check-platform-sync.mjs`
 * at the repository root verifies that. Platform-specific wording and chrome
 * belong here, not in components.
 *
 * This copy: Windows.
 */

export interface PlatformNote {
  /** Bold lead-in. */
  title: string;
  body: string;
}

export interface Platform {
  id: "windows" | "macos" | "linux";
  /** Shown in Setup → About. */
  productLabel: string;
  /** What the OS calls itself in settings copy. */
  osName: string;
  /** Where the window goes when it is closed. */
  hideTarget: string;
  /** True when the OS draws the window buttons and MrTyper hides its own. */
  nativeWindowControls: boolean;
  /** Setup → Motion descriptions. */
  motion: {
    systemReduced: string;
    systemFull: string;
    forcedFull: string;
  };
  /** Extra note under Setup → Shortcuts. */
  shortcutsNote: PlatformNote | null;
  /** Extra note under Setup → Safety (permissions). */
  permissionNote: PlatformNote | null;
}

export const PLATFORM: Platform = {
  id: "windows",
  productLabel: "MrTyper for Windows",
  osName: "Windows",
  hideTarget: "system tray",
  nativeWindowControls: false,
  motion: {
    systemReduced:
      "Windows has animation effects turned off, so motion is reduced. Pick Full to animate anyway.",
    systemFull: "Following Windows: animation effects are on.",
    forcedFull: "Every transition plays, whatever Windows says.",
  },
  shortcutsNote: null,
  permissionNote: null,
};
