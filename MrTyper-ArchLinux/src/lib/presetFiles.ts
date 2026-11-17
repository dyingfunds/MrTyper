/**
 * Preset files for sharing: a small JSON document anyone can import into
 * their own MrTyper. Only the name and the typing settings travel; ids and
 * dates belong to each device.
 */

import { normalizeTyping } from "./defaults";
import type { Preset, TypingSettings } from "../types";

const FORMAT = "mrtyper-presets";
const VERSION = 1;

interface PresetFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  presets: Array<{ name: string; typing: TypingSettings }>;
}

export interface ImportedPreset {
  name: string;
  typing: TypingSettings;
}

export function presetFileContents(presets: Preset[]): string {
  const file: PresetFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    presets: presets.map((preset) => ({ name: preset.name, typing: preset.typing })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function presetFileName(presets: Preset[]): string {
  if (presets.length === 1) return `${presets[0].name} (MrTyper preset).json`;
  const date = new Date().toISOString().slice(0, 10);
  return `MrTyper presets ${date}.json`;
}

/** Read a preset file. Throws an Error with a message meant for the user. */
export function parsePresetFile(contents: string): ImportedPreset[] {
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error("That file isn't a MrTyper preset file.");
  }

  // Accept the full file, a bare list, or a single preset.
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as PresetFile).presets)
      ? (data as PresetFile).presets
      : [data];

  const presets: ImportedPreset[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { name, typing } = item as { name?: unknown; typing?: unknown };
    if (typeof name !== "string" || !name.trim() || !typing || typeof typing !== "object") continue;
    presets.push({
      name: name.trim().slice(0, 42),
      typing: normalizeTyping(typing as Partial<TypingSettings>),
    });
  }
  if (!presets.length) throw new Error("No presets were found in that file.");
  return presets;
}

/** `name`, or `name (2)`, `name (3)`… so it doesn't clash with `taken`. */
export function uniquePresetName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let copy = 2; ; copy += 1) {
    const suffix = ` (${copy})`;
    const candidate = `${name.slice(0, 42 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
