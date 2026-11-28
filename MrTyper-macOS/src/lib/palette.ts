/**
 * Colour palettes. A palette is three colours (a dark, a light and an
 * accent); every surface, text, line and accent token of the app is worked
 * out from them, for both the light and the dark theme, keeping text and
 * accents readable whatever the three colours are.
 *
 * Tokens are written as inline custom properties on <html>, which win over
 * the defaults in styles/tokens.css.
 */

export interface PaletteColors {
  /** Backgrounds in the dark theme, text in the light one. */
  dark: string;
  /** Text in the dark theme, backgrounds in the light one. */
  light: string;
  /** The one loud colour: buttons, progress, highlights. */
  accent: string;
}

export interface Palette {
  id: string;
  label: string;
  /** What each colour is called, for tooltips. */
  names: [dark: string, light: string, accent: string];
  colors: PaletteColors;
}

export const PALETTES: Palette[] = [
  {
    id: "bougainvillea",
    label: "Bougainvillea",
    names: ["Olive Green", "Whitewash", "Bougainvillea Pink"],
    colors: { dark: "#313607", light: "#ebe7e2", accent: "#d9399c" },
  },
  {
    id: "graphite",
    label: "Graphite & Yellow",
    names: ["Gray", "Silver", "Yellow"],
    colors: { dark: "#2b2d31", light: "#d9dadc", accent: "#ffc93c" },
  },
  {
    id: "cocoa",
    label: "Cocoa & Sky",
    names: ["Brown", "Cream", "Baby Blue"],
    colors: { dark: "#3b2418", light: "#f2e8da", accent: "#8ec5ff" },
  },
  {
    id: "sage",
    label: "Sage & Tomato",
    names: ["Sage", "Off-White", "Tomato Red"],
    colors: { dark: "#9caf88", light: "#f7f5ef", accent: "#e8412c" },
  },
];

/** A palette the user made: any three colours, under a name they choose. */
export interface CustomPalette {
  /** Always starts with "custom-". */
  id: string;
  name: string;
  colors: PaletteColors;
}

export const CUSTOM_PREFIX = "custom-";
export const MAX_CUSTOM_PALETTES = 12;
export const MAX_PALETTE_NAME = 24;
export const DEFAULT_PALETTE_ID = "graphite";
export const DEFAULT_CUSTOM_COLORS: PaletteColors = {
  dark: "#1d2a38",
  light: "#eef2f6",
  accent: "#ff7a45",
};

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/** "#abc", "abc123" or " #ABC123 " → "#abc123", or null. */
export function cleanHex(value: string): string | null {
  let hex = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.replace(/./g, (digit) => digit + digit);
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/* ------------------------------------------------------------------ */
/*  Colour maths (sRGB ↔ OKLab)                                        */
/* ------------------------------------------------------------------ */

type Rgb = [number, number, number];
type Lab = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function srgbFromLinear(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function toLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    srgbFromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    srgbFromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    srgbFromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** The colour at OKLab lightness `lightness`, its chroma scaled by `chroma`. */
function tone(hex: string, lightness: number, chroma = 1): string {
  const [, a, b] = toLab(hex);
  return fromLab([lightness, a * chroma, b * chroma]);
}

function lightnessOf(hex: string): number {
  return toLab(hex)[0];
}

function hueOf(hex: string): { hue: number; chroma: number } {
  const [, a, b] = toLab(hex);
  return { hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(a, b) };
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Lighten or darken `hex` (keeping its hue) until it reaches `target` contrast on `on`. */
function readableOn(hex: string, on: string, target: number, direction: "up" | "down"): string {
  let lightness = lightnessOf(hex);
  let color = hex;
  for (let step = 0; step < 40 && contrast(color, on) < target; step += 1) {
    lightness = direction === "up" ? Math.min(1, lightness + 0.02) : Math.max(0, lightness - 0.02);
    color = tone(hex, lightness);
  }
  return color;
}

function mix(a: string, b: string, amount: number): string {
  const [la, aa, ba] = toLab(a);
  const [lb, ab, bb] = toLab(b);
  return fromLab([la + (lb - la) * amount, aa + (ab - aa) * amount, ba + (bb - ba) * amount]);
}

function alpha(hex: string, opacity: number): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 255));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Hue distance in degrees. */
function hueGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/* ------------------------------------------------------------------ */
/*  Palette → tokens                                                   */
/* ------------------------------------------------------------------ */

export type ThemeMode = "dark" | "light";

const DANGER = { dark: "#ff5340", light: "#de3b26" };
const DANGER_ROSE = { dark: "#ff3d7f", light: "#d4185a" };
const WARN = { dark: "#ffb224", light: "#b26f00" };
const WARN_ORANGE = { dark: "#ff8a3d", light: "#c25400" };

export function paletteTokens(colors: PaletteColors, mode: ThemeMode): Record<string, string> {
  const { dark, light, accent } = colors;
  const accentHue = hueOf(accent);
  const tokens: Record<string, string> = {};

  // Status colours move aside when the accent is close to them.
  const dangerHue = hueOf(DANGER[mode]).hue;
  const warnHue = hueOf(WARN[mode]).hue;
  tokens["--danger"] =
    accentHue.chroma > 0.08 && hueGap(accentHue.hue, dangerHue) < 30
      ? DANGER_ROSE[mode]
      : DANGER[mode];
  tokens["--warn"] =
    accentHue.chroma > 0.08 && hueGap(accentHue.hue, warnHue) < 25
      ? WARN_ORANGE[mode]
      : WARN[mode];

  if (mode === "dark") {
    // Deep tones of the dark colour, so even a mid-tone like sage reads as
    // a dark room.
    const bg = tone(dark, 0.17, 0.9);
    const text = readableOn(light, bg, 11, "up");
    Object.assign(tokens, {
      "--bg": bg,
      "--surface": tone(dark, 0.205, 0.85),
      "--surface-2": tone(dark, 0.235, 0.8),
      "--surface-3": tone(dark, 0.27, 0.75),
      "--surface-4": tone(dark, 0.31, 0.7),
      "--text": text,
      "--text-2": mix(text, bg, 0.34),
      "--text-3": mix(text, bg, 0.55),
      "--text-4": mix(text, bg, 0.72),
      "--line": alpha(text, 0.08),
      "--line-2": alpha(text, 0.14),
      "--line-3": alpha(text, 0.24),
      "--dot": alpha(text, 0.055),
      "--scrim": alpha(bg, 0.78),
      "--thumb": text,
    });
    const accentFill = lightnessOf(accent) < 0.45 ? readableOn(accent, bg, 3, "up") : accent;
    const accentText = readableOn(accentFill, tone(dark, 0.235, 0.8), 5, "up");
    tokens["--accent"] = accentFill;
    tokens["--accent-text"] = accentText;
    tokens["--accent-mark"] = accentText;
    tokens["--accent-ink"] = inkFor(accentFill, dark);
    tokens["--track"] = tokens["--surface-4"];
  } else {
    const bg = tone(light, 0.905, 0.75);
    const text = readableOn(tone(dark, Math.min(0.24, lightnessOf(dark)), 1), bg, 11, "down");
    Object.assign(tokens, {
      "--bg": bg,
      "--surface": tone(light, 0.94, 0.55),
      "--surface-2": tone(light, 0.965, 0.4),
      "--surface-3": tone(light, 0.99, 0.2),
      "--surface-4": tone(light, 0.99, 0.2),
      "--text": text,
      "--text-2": mix(text, bg, 0.36),
      "--text-3": mix(text, bg, 0.56),
      "--text-4": mix(text, bg, 0.74),
      "--line": alpha(text, 0.1),
      "--line-2": alpha(text, 0.17),
      "--line-3": alpha(text, 0.3),
      "--dot": alpha(text, 0.075),
      "--scrim": alpha(bg, 0.82),
      "--thumb": text,
      "--track": tone(light, 0.84, 0.5),
    });
    const accentText = readableOn(accent, bg, 4.8, "down");
    tokens["--accent"] = accent;
    tokens["--accent-text"] = accentText;
    tokens["--accent-mark"] = accentText;
    tokens["--accent-ink"] = inkFor(accent, dark);
  }

  return tokens;
}

/** Dark or white text on an accent-filled button, whichever reads better. */
function inkFor(accent: string, dark: string): string {
  const deep = tone(dark, 0.16, 0.9);
  return contrast(deep, accent) >= contrast("#ffffff", accent) ? deep : "#ffffff";
}

let appliedKeys: string[] = [];

export function applyPalette(colors: PaletteColors, mode: ThemeMode): void {
  const style = document.documentElement.style;
  for (const key of appliedKeys) style.removeProperty(key);
  const tokens = paletteTokens(colors, mode);
  for (const [key, value] of Object.entries(tokens)) style.setProperty(key, value);
  appliedKeys = Object.keys(tokens);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", tokens["--bg"]);
}

export function paletteColors(id: string, customPalettes: CustomPalette[]): PaletteColors {
  const custom = customPalettes.find((palette) => palette.id === id);
  if (custom) return custom.colors;
  return (
    PALETTES.find((palette) => palette.id === id) ??
    PALETTES.find((palette) => palette.id === DEFAULT_PALETTE_ID) ??
    PALETTES[0]
  ).colors;
}

/** A new custom palette starting from `colors`, with a free "Custom N" name. */
export function newCustomPalette(existing: CustomPalette[], colors: PaletteColors): CustomPalette {
  const taken = new Set(existing.map((palette) => palette.name.toLowerCase()));
  let number = existing.length + 1;
  while (taken.has(`custom ${number}`)) number += 1;
  const id = `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { id, name: `Custom ${number}`, colors: { ...colors } };
}

/** Keep only well-formed custom palettes, at most MAX_CUSTOM_PALETTES. */
export function cleanCustomPalettes(value: unknown): CustomPalette[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const palettes: CustomPalette[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, name, colors } = item as Partial<CustomPalette>;
    if (typeof id !== "string" || !id.startsWith(CUSTOM_PREFIX) || seen.has(id)) continue;
    if (!colors || !isHexColor(colors.dark) || !isHexColor(colors.light) || !isHexColor(colors.accent)) {
      continue;
    }
    seen.add(id);
    palettes.push({
      id,
      name: (typeof name === "string" && name.trim() ? name.trim() : "Custom").slice(0, MAX_PALETTE_NAME),
      colors: { dark: colors.dark, light: colors.light, accent: colors.accent },
    });
    if (palettes.length === MAX_CUSTOM_PALETTES) break;
  }
  return palettes;
}
