/**
 * Purely cosmetic preferences. They live in the webview's own storage so the
 * native settings file keeps its original shape.
 */
export type Accent = "volt" | "ember" | "ice" | "orchid";

/** "system" follows the operating system's reduced-motion preference. */
export type MotionPref = "system" | "full" | "reduced";

export interface UiPrefs {
  accent: Accent;
  motion: MotionPref;
}

export const ACCENTS: Array<{ id: Accent; label: string }> = [
  { id: "volt", label: "Volt" },
  { id: "ember", label: "Ember" },
  { id: "ice", label: "Ice" },
  { id: "orchid", label: "Orchid" },
];

const MOTION_PREFS: MotionPref[] = ["system", "full", "reduced"];
const STORAGE_KEY = "mrtyper.ui.v1";

export const DEFAULT_UI_PREFS: UiPrefs = { accent: "volt", motion: "system" };

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_PREFS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof UiPrefs, unknown>>;
    return {
      accent: ACCENTS.some((accent) => accent.id === parsed.accent)
        ? (parsed.accent as Accent)
        : DEFAULT_UI_PREFS.accent,
      motion: MOTION_PREFS.includes(parsed.motion as MotionPref)
        ? (parsed.motion as MotionPref)
        : DEFAULT_UI_PREFS.motion,
    };
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Cosmetic persistence is best effort.
  }
}

export function shouldReduceMotion(motion: MotionPref, systemReduces: boolean): boolean {
  return motion === "reduced" || (motion === "system" && systemReduces);
}

export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
}

export function applyReducedMotion(reduced: boolean): void {
  document.documentElement.classList.toggle("reduce-motion", reduced);
}
