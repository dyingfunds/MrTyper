import type { AppSettings, Preset, TypingSettings } from "../types";

export const DEFAULT_TYPING: TypingSettings = {
  startDelaySecs: 5,
  minWpm: 55,
  maxWpm: 105,
  randomness: 62,
  punctuationEnabled: true,
  punctuationFactor: 2.4,
  lineBreakEnabled: true,
  lineBreakExtraMs: 380,
  thinkingEnabled: true,
  thinkingEveryChars: 95,
  thinkingPauseMaxMs: 1400,
  burstEnabled: true,
  burstIntensity: 38,
  typosEnabled: true,
  typoChance: 2.5,
  fatigueEnabled: false,
  fatigueDrift: 18,
};

export const DEFAULT_SETTINGS: AppSettings = {
  typing: DEFAULT_TYPING,
  theme: "system",
  alwaysOnTop: false,
  stopOnEsc: true,
  stopOnFocusLoss: true,
  hotkeyStart: "F8",
  hotkeyPause: "F9",
};

export const PRESET_BLUEPRINTS: Array<{
  name: string;
  typing: Partial<TypingSettings>;
}> = [
  {
    name: "Fast & clean",
    typing: {
      startDelaySecs: 3,
      minWpm: 150,
      maxWpm: 210,
      randomness: 42,
      punctuationEnabled: true,
      punctuationFactor: 1.6,
      lineBreakEnabled: true,
      lineBreakExtraMs: 180,
      thinkingEnabled: false,
      thinkingEveryChars: 140,
      thinkingPauseMaxMs: 700,
      burstEnabled: true,
      burstIntensity: 28,
      typosEnabled: false,
      typoChance: 0.5,
      fatigueEnabled: false,
      fatigueDrift: 8,
    },
  },
  {
    name: "Careful",
    typing: {
      startDelaySecs: 7,
      minWpm: 45,
      maxWpm: 72,
      randomness: 54,
      punctuationEnabled: true,
      punctuationFactor: 3.2,
      lineBreakEnabled: true,
      lineBreakExtraMs: 680,
      thinkingEnabled: true,
      thinkingEveryChars: 62,
      thinkingPauseMaxMs: 2400,
      burstEnabled: false,
      burstIntensity: 22,
      typosEnabled: false,
      typoChance: 0.5,
      fatigueEnabled: true,
      fatigueDrift: 12,
    },
  },
  {
    name: "Sloppy",
    typing: {
      startDelaySecs: 5,
      minWpm: 62,
      maxWpm: 98,
      randomness: 92,
      punctuationEnabled: true,
      punctuationFactor: 2.1,
      lineBreakEnabled: true,
      lineBreakExtraMs: 320,
      thinkingEnabled: true,
      thinkingEveryChars: 54,
      thinkingPauseMaxMs: 960,
      burstEnabled: true,
      burstIntensity: 58,
      typosEnabled: true,
      typoChance: 8.5,
      fatigueEnabled: true,
      fatigueDrift: 24,
    },
  },
];

export function makeDefaultPresets(now = Date.now()): Preset[] {
  return PRESET_BLUEPRINTS.map((blueprint, index) => ({
    id: `starter-${index + 1}`,
    name: blueprint.name,
    typing: { ...DEFAULT_TYPING, ...blueprint.typing },
    updatedAt: now - (PRESET_BLUEPRINTS.length - index) * 86_400_000,
  }));
}

/** Coerce persisted or imported settings into a safe, complete shape. */
export function normalizeTyping(value: Partial<TypingSettings> | undefined): TypingSettings {
  const merged = { ...DEFAULT_TYPING, ...value };
  const minWpm = clamp(round(merged.minWpm), 10, 300);
  const maxWpm = clamp(round(merged.maxWpm), minWpm, 300);
  const pauseMin = clamp(round(merged.thinkingPauseMaxMs), 300, 5000);

  return {
    ...merged,
    startDelaySecs: clamp(round(merged.startDelaySecs), 1, 30),
    minWpm,
    maxWpm,
    randomness: clamp(round(merged.randomness), 0, 100),
    punctuationFactor: clamp(round1(merged.punctuationFactor), 1, 4),
    lineBreakExtraMs: clamp(round(merged.lineBreakExtraMs), 80, 1500),
    thinkingEveryChars: clamp(round(merged.thinkingEveryChars), 20, 400),
    thinkingPauseMaxMs: pauseMin,
    burstIntensity: clamp(round(merged.burstIntensity), 10, 100),
    typoChance: clamp(round1(merged.typoChance), 0.5, 15),
    fatigueDrift: clamp(round(merged.fatigueDrift), 0, 40),
    punctuationEnabled: Boolean(merged.punctuationEnabled),
    lineBreakEnabled: Boolean(merged.lineBreakEnabled),
    thinkingEnabled: Boolean(merged.thinkingEnabled),
    burstEnabled: Boolean(merged.burstEnabled),
    typosEnabled: Boolean(merged.typosEnabled),
    fatigueEnabled: Boolean(merged.fatigueEnabled),
  };
}

export function normalizeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...value };
  const theme =
    merged.theme === "light" || merged.theme === "dark" || merged.theme === "system"
      ? merged.theme
      : "system";

  return {
    typing: normalizeTyping(merged.typing),
    theme,
    alwaysOnTop: Boolean(merged.alwaysOnTop),
    stopOnEsc: Boolean(merged.stopOnEsc),
    stopOnFocusLoss: Boolean(merged.stopOnFocusLoss),
    hotkeyStart: validHotkey(merged.hotkeyStart) ? merged.hotkeyStart : "F8",
    hotkeyPause: validHotkey(merged.hotkeyPause) ? merged.hotkeyPause : "F9",
  };
}

export function validHotkey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.toUpperCase().startsWith("ESCAPE")
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round(value: number): number {
  return Math.round(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
