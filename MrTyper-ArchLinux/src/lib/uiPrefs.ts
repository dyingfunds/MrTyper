/**
 * Purely cosmetic preferences. They live in the webview's own storage so the
 * native settings file keeps its original shape.
 */
import {
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_PALETTE_ID,
  PALETTES,
  isHexColor,
  type PaletteColors,
} from "./palette";

/** "system" follows the operating system's reduced-motion preference. */
export type MotionPref = "system" | "full" | "reduced";

/** The script editor's typeface. */
export type EditorFont = "mono" | "sans" | "serif";

export interface UiPrefs {
  /** One of PALETTES, or "custom" for `customColors`. */
  palette: string;
  customColors: PaletteColors;
  motion: MotionPref;
  editorFont: EditorFont;
  /** Script editor text size in px. */
  editorSize: number;
  /** Show the cadence scope in the transport bar. */
  showScope: boolean;
}

export const EDITOR_SIZE_MIN = 11;
export const EDITOR_SIZE_MAX = 24;

const MOTION_PREFS: MotionPref[] = ["system", "full", "reduced"];
const EDITOR_FONTS: EditorFont[] = ["mono", "sans", "serif"];
export const STORAGE_KEY = "mrtyper.ui.v1";

export const DEFAULT_UI_PREFS: UiPrefs = {
  palette: DEFAULT_PALETTE_ID,
  customColors: DEFAULT_CUSTOM_COLORS,
  motion: "system",
  editorFont: "mono",
  editorSize: 14.5,
  showScope: true,
};

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_PREFS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof UiPrefs, unknown>>;
    const custom = (parsed.customColors ?? {}) as Partial<Record<keyof PaletteColors, unknown>>;
    return {
      palette:
        parsed.palette === CUSTOM_PALETTE_ID ||
        PALETTES.some((palette) => palette.id === parsed.palette)
          ? (parsed.palette as string)
          : DEFAULT_UI_PREFS.palette,
      customColors: {
        dark: isHexColor(custom.dark) ? custom.dark : DEFAULT_CUSTOM_COLORS.dark,
        light: isHexColor(custom.light) ? custom.light : DEFAULT_CUSTOM_COLORS.light,
        accent: isHexColor(custom.accent) ? custom.accent : DEFAULT_CUSTOM_COLORS.accent,
      },
      motion: MOTION_PREFS.includes(parsed.motion as MotionPref)
        ? (parsed.motion as MotionPref)
        : DEFAULT_UI_PREFS.motion,
      editorFont: EDITOR_FONTS.includes(parsed.editorFont as EditorFont)
        ? (parsed.editorFont as EditorFont)
        : DEFAULT_UI_PREFS.editorFont,
      editorSize:
        typeof parsed.editorSize === "number" && Number.isFinite(parsed.editorSize)
          ? Math.min(EDITOR_SIZE_MAX, Math.max(EDITOR_SIZE_MIN, parsed.editorSize))
          : DEFAULT_UI_PREFS.editorSize,
      showScope:
        typeof parsed.showScope === "boolean" ? parsed.showScope : DEFAULT_UI_PREFS.showScope,
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

const EDITOR_FONT_STACKS: Record<EditorFont, string> = {
  mono: "var(--font-mono)",
  sans: "var(--font-sans)",
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
};

export function applyEditorLook(font: EditorFont, size: number): void {
  const style = document.documentElement.style;
  style.setProperty("--editor-font", EDITOR_FONT_STACKS[font]);
  style.setProperty("--editor-size", `${size}px`);
}

export function applyReducedMotion(reduced: boolean): void {
  document.documentElement.classList.toggle("reduce-motion", reduced);
}
