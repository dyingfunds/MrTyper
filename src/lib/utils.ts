import type { TypingSettings } from "../types";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function characterCount(text: string): number {
  return Array.from(text).length;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function averageWpm(typing: TypingSettings): number {
  return Math.round((typing.minWpm + typing.maxWpm) / 2);
}

export function estimateDurationSeconds(text: string, typing: TypingSettings): number {
  const characters = Math.max(0, characterCount(text));
  if (!characters) return 0;
  const base = (characters / 5 / averageWpm(typing)) * 60;
  let extra = 0;
  if (typing.punctuationEnabled) {
    const punctuation = (text.match(/[.!?,;:]/g) ?? []).length;
    extra += punctuation * (typing.punctuationFactor - 1) * 0.12;
  }
  if (typing.lineBreakEnabled) {
    const lines = (text.match(/\n/g) ?? []).length;
    extra += (lines * typing.lineBreakExtraMs) / 1000;
  }
  if (typing.thinkingEnabled) {
    extra += (characters / typing.thinkingEveryChars) * (typing.thinkingPauseMaxMs * 0.55) / 1000;
  }
  return Math.max(1, Math.round(base + extra));
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatWpm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
}

export function splitHotkey(accelerator: string): string[] {
  return accelerator
    .split("+")
    .map((part) => {
      const normalized = part.trim();
      if (/^super$/i.test(normalized)) return "Win";
      if (/^commandorcontrol$/i.test(normalized)) return "Ctrl";
      if (/^control$/i.test(normalized)) return "Ctrl";
      if (/^arrow(up|down|left|right)$/i.test(normalized)) {
        return normalized.replace(/^arrow/i, "");
      }
      return normalized;
    })
    .filter(Boolean);
}

export function formatHotkey(accelerator: string): string {
  return splitHotkey(accelerator).join(" + ");
}

export function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

type AcceleratorKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

/**
 * Convert a keyboard event into a Tauri/global-hotkey accelerator.
 * Bare letter keys are rejected so MrTyper cannot swallow normal typing.
 */
export function acceleratorFromKeyboardEvent(event: AcceleratorKeyEvent): string | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === "Escape") return null;

  let key: string | null = null;
  if (FUNCTION_KEY.test(event.key.toUpperCase())) {
    key = event.key.toUpperCase();
  } else if (event.key === " ") {
    key = "Space";
  } else if (/^[a-z0-9]$/i.test(event.key)) {
    key = event.key.toUpperCase();
  } else if (/^Arrow(Up|Down|Left|Right)$/.test(event.key)) {
    key = event.key;
  }

  if (!key) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");

  if (modifiers.length === 0 && !FUNCTION_KEY.test(key)) {
    return null;
  }

  return [...modifiers, key].join("+");
}

export function isEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function presetTraits(typing: TypingSettings): string[] {
  const traits: string[] = [];
  if (typing.typosEnabled && typing.typoChance >= 1) {
    traits.push(`${typing.typoChance.toFixed(typing.typoChance % 1 === 0 ? 0 : 1)}% typos`);
  } else {
    traits.push("Clean keys");
  }
  if (typing.thinkingEnabled) traits.push("Thinking pauses");
  else if (typing.punctuationEnabled) traits.push("Measured pauses");
  if (typing.burstEnabled) traits.push("Bursts");
  if (typing.fatigueEnabled) traits.push("Fatigue drift");
  return traits;
}

export function smoothstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
