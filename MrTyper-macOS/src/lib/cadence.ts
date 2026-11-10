import type { TypingSettings } from "../types";

export type CadenceKind = "key" | "pause" | "typo";

export interface CadenceBar {
  /** 0–1, how fast this key lands. Taller is faster. */
  level: number;
  kind: CadenceKind;
}

/** Speed that maps to a full-height bar. */
const FULL_SCALE_WPM = 330;

export function levelForWpm(wpm: number): number {
  const ratio = Math.min(1, Math.max(0, wpm / FULL_SCALE_WPM));
  return Math.min(1, Math.max(0.05, Math.pow(ratio, 0.5)));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic sketch of what a rhythm looks like: one bar per keystroke.
 * It mirrors the engine's ingredients closely enough to make the sliders
 * legible at a glance; the real plan is always built natively.
 */
export function simulateCadence(
  typing: TypingSettings,
  count: number,
  seed = 11,
): CadenceBar[] {
  const random = mulberry32(seed);
  const mid = (typing.minWpm + typing.maxWpm) / 2;
  const span = typing.maxWpm - typing.minWpm;
  const spread = typing.randomness / 100;
  const burstPeriod = Math.max(6, 15 - typing.burstIntensity / 10);
  const bars: CadenceBar[] = [];
  let untilThought = Math.max(8, Math.round(typing.thinkingEveryChars * (0.35 + random() * 0.4)));

  for (let index = 0; index < count; index += 1) {
    // Always consume the same number of random draws per bar so toggling one
    // behaviour never reshuffles the rest of the picture.
    const jitter = random() - 0.5;
    const punctuationRoll = random();
    const lineRoll = random();
    const typoRoll = random();

    let wpm = mid + jitter * span * spread + jitter * 6 * spread;
    let kind: CadenceKind = "key";

    if (typing.burstEnabled) {
      const wave = Math.sin((index / burstPeriod) * Math.PI);
      wpm *= 1 + Math.max(0, wave) * (typing.burstIntensity / 100) * 0.45;
    }
    if (typing.fatigueEnabled) {
      wpm /= 1 + (index / Math.max(1, count)) * (typing.fatigueDrift / 100) * 1.6;
    }
    if (typing.punctuationEnabled && punctuationRoll < 0.07) {
      wpm /= 1 + (typing.punctuationFactor - 1) * 0.7;
    }
    if (typing.lineBreakEnabled && lineRoll < 0.022) {
      wpm = Math.min(wpm, 12000 / (120 + typing.lineBreakExtraMs));
      kind = "pause";
    }
    if (typing.thinkingEnabled) {
      untilThought -= 1;
      if (untilThought <= 0) {
        wpm = 4;
        kind = "pause";
        untilThought = Math.max(8, Math.round(typing.thinkingEveryChars * (0.7 + random() * 0.6)));
      }
    }
    if (kind === "key" && typing.typosEnabled && typoRoll < typing.typoChance / 100) {
      kind = "typo";
    }

    bars.push({ level: levelForWpm(wpm), kind });
  }

  return bars;
}

/** A 0–1 read of how "human" the current recipe is. */
export function humanScore(typing: TypingSettings): number {
  const layers = [
    typing.punctuationEnabled,
    typing.lineBreakEnabled,
    typing.thinkingEnabled,
    typing.burstEnabled,
    typing.typosEnabled,
    typing.fatigueEnabled,
  ].filter(Boolean).length;
  return Math.min(1, (layers / 6) * 0.68 + (typing.randomness / 100) * 0.32);
}

export function humanLabel(score: number): string {
  if (score < 0.18) return "Machine";
  if (score < 0.42) return "Steady";
  if (score < 0.72) return "Natural";
  if (score < 0.9) return "Loose";
  return "Chaotic";
}
