/**
 * Everything the UI needs to know about the platform it runs on.
 *
 * This is the only frontend file that differs between the three MrTyper apps
 * (repository root = Windows, MrTyper-macOS/, MrTyper-ArchLinux/). Every other
 * file under src/ is identical in all three; `node scripts/check-platform-sync.mjs`
 * at the repository root verifies that. Platform-specific wording and chrome
 * belong here, not in components.
 *
 * This copy: macOS.
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
  id: "macos",
  productLabel: "MrTyper for macOS",
  osName: "macOS",
  hideTarget: "menu bar",
  nativeWindowControls: true,
  motion: {
    systemReduced:
      "macOS has Reduce motion turned on, so motion is reduced. Pick Full to animate anyway.",
    systemFull: "Following macOS: Reduce motion is off.",
    forcedFull: "Every transition plays, whatever macOS says.",
  },
  shortcutsNote: {
    title: "Function keys on a Mac keyboard",
    body: "control media by default. Hold fn with F8 / F9, or rebind to a modifier chord such as Ctrl + Shift + Space.",
  },
  permissionNote: {
    title: "Accessibility access.",
    body: "macOS asks the first time you start typing. If you dismissed it, turn MrTyper on in System Settings → Privacy & Security → Accessibility.",
  },
};
