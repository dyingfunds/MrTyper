/**
 * `{{…}}` commands in scripts: Google Docs shortcuts, raw key combos and
 * pauses. The engine (src-tauri/src/script.rs) decides what they do; this
 * file mirrors its rules so the UI can count, estimate and offer them. Keep
 * the two in step.
 */

export type CommandKind = "shortcut" | "pause";

export interface ScriptPiece {
  /** A typed character, or the full text of a command. */
  text: string;
  /** Present when the piece is a command. */
  command?: { kind: CommandKind; pauseMs?: number };
}

const MAX_COMMAND_LEN = 48;
const MAX_PAUSE_MS = 60_000;

const NAMED = new Set([
  "bold", "b", "italic", "i", "underline", "u", "strikethrough", "strike",
  "superscript", "sup", "subscript", "sub",
  "bigger", "larger", "sizeup", "fontup", "fontsizeup", "increasefontsize",
  "smaller", "sizedown", "fontdown", "fontsizedown", "decreasefontsize",
  "clear", "clearformatting", "plain", "normal", "normaltext", "body",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
  "numbers", "numbered", "numberedlist", "numberlist",
  "bullets", "bulleted", "bulletlist", "bulletedlist", "checklist", "checkbox",
  "alignleft", "center", "aligncenter", "alignright", "justify", "alignjustify",
  "indent", "outdent", "dedent", "unindent", "pagebreak", "undo", "redo",
]);

const NAMED_KEYS = new Set([
  "enter", "return", "tab", "backspace", "delete", "del", "home", "end",
  "pageup", "pgup", "pagedown", "pgdn", "up", "down", "left", "right", "space",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
]);

const MODIFIERS = new Set([
  "ctrl", "control", "alt", "option", "opt", "shift", "cmd", "command", "meta",
  "super", "win", "mod", "primary", "cmdorctrl",
]);

function parsePause(body: string): number | null {
  const match = /^(?:pause|wait)\s*(.*)$/.exec(body);
  if (!match) return null;
  let rest = match[1].trim();
  let scale = 1000;
  if (rest.endsWith("ms")) {
    rest = rest.slice(0, -2);
    scale = 1;
  } else {
    const unit = ["seconds", "second", "secs", "sec", "s"].find((suffix) => rest.endsWith(suffix));
    if (unit) rest = rest.slice(0, -unit.length);
  }
  rest = rest.trim();
  if (!/^\d*\.?\d+$/.test(rest)) return null;
  const milliseconds = Math.round(Number(rest) * scale);
  return milliseconds >= 1 && milliseconds <= MAX_PAUSE_MS ? milliseconds : null;
}

function isCombo(body: string): boolean {
  const parts = body.split("+").map((part) => part.trim());
  const key = parts.pop() ?? "";
  if (!parts.every((part) => MODIFIERS.has(part))) return false;
  if (NAMED_KEYS.has(key)) return true;
  return parts.length > 0 && Array.from(key).length === 1 && !/\s/.test(key);
}

/** What the text between the braces does, or null when it is plain text. */
export function resolveCommand(rawBody: string): ScriptPiece["command"] | null {
  const body = rawBody.trim().toLowerCase();
  if (!body) return null;
  const pauseMs = parsePause(body);
  if (pauseMs !== null) return { kind: "pause", pauseMs };
  if (NAMED.has(body.replace(/[\s_-]/g, ""))) return { kind: "shortcut" };
  return isCombo(body) ? { kind: "shortcut" } : null;
}

/** Split a script into typed characters and commands, as the engine does. */
export function splitScript(text: string, commands: boolean): ScriptPiece[] {
  const characters = Array.from(text);
  const pieces: ScriptPiece[] = [];
  let index = 0;

  while (index < characters.length) {
    if (commands && characters[index] === "{" && characters[index + 1] === "{") {
      const bodyStart = index + 2;
      let end = bodyStart;
      let found: number | null = null;
      while (end + 1 < characters.length && end - bodyStart <= MAX_COMMAND_LEN) {
        const character = characters[end];
        if (character === "\n" || character === "{") break;
        if (character === "}" && characters[end + 1] === "}") {
          found = end;
          break;
        }
        end += 1;
      }
      if (found !== null) {
        const command = resolveCommand(characters.slice(bodyStart, found).join(""));
        if (command) {
          pieces.push({ text: characters.slice(index, found + 2).join(""), command });
          index = found + 2;
          continue;
        }
      }
    }
    pieces.push({ text: characters[index] });
    index += 1;
  }

  return pieces;
}

const COMMAND_HINT = /\{\{/;

/** The text that actually gets typed, and the total time of pause commands. */
export function typedText(text: string, commands: boolean): { text: string; pauseMs: number } {
  if (!commands || !COMMAND_HINT.test(text)) return { text, pauseMs: 0 };
  let output = "";
  let pauseMs = 0;
  for (const piece of splitScript(text, true)) {
    if (!piece.command) output += piece.text;
    else if (piece.command.kind === "pause") pauseMs += piece.command.pauseMs ?? 0;
  }
  return { text: output, pauseMs };
}

/* ------------------------------------------------------------------ */
/*  The command menu                                                   */
/* ------------------------------------------------------------------ */

export interface CommandOption {
  /** Inserted as {{token}}. */
  token: string;
  label: string;
  /** The Google Docs shortcut it sends, for display. */
  keys: { other: string; mac: string };
}

export interface CommandGroup {
  label: string;
  options: CommandOption[];
}

const both = (other: string, mac: string) => ({ other, mac });

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    label: "Text style",
    options: [
      { token: "bold", label: "Bold", keys: both("Ctrl+B", "⌘B") },
      { token: "italic", label: "Italic", keys: both("Ctrl+I", "⌘I") },
      { token: "underline", label: "Underline", keys: both("Ctrl+U", "⌘U") },
      { token: "strike", label: "Strikethrough", keys: both("Alt+Shift+5", "⌘⇧X") },
      { token: "sup", label: "Superscript", keys: both("Ctrl+.", "⌘.") },
      { token: "sub", label: "Subscript", keys: both("Ctrl+,", "⌘,") },
      { token: "clear", label: "Clear formatting", keys: both("Ctrl+\\", "⌘\\") },
    ],
  },
  {
    label: "Size and headings",
    options: [
      { token: "bigger", label: "Font size up", keys: both("Ctrl+Shift+.", "⌘⇧.") },
      { token: "smaller", label: "Font size down", keys: both("Ctrl+Shift+,", "⌘⇧,") },
      { token: "normal", label: "Normal text", keys: both("Ctrl+Alt+0", "⌘⌥0") },
      { token: "h1", label: "Heading 1", keys: both("Ctrl+Alt+1", "⌘⌥1") },
      { token: "h2", label: "Heading 2", keys: both("Ctrl+Alt+2", "⌘⌥2") },
      { token: "h3", label: "Heading 3", keys: both("Ctrl+Alt+3", "⌘⌥3") },
    ],
  },
  {
    label: "Paragraph",
    options: [
      { token: "bullets", label: "Bulleted list", keys: both("Ctrl+Shift+8", "⌘⇧8") },
      { token: "numbers", label: "Numbered list", keys: both("Ctrl+Shift+7", "⌘⇧7") },
      { token: "checklist", label: "Checklist", keys: both("Ctrl+Shift+9", "⌘⇧9") },
      { token: "center", label: "Align centre", keys: both("Ctrl+Shift+E", "⌘⇧E") },
      { token: "alignleft", label: "Align left", keys: both("Ctrl+Shift+L", "⌘⇧L") },
      { token: "alignright", label: "Align right", keys: both("Ctrl+Shift+R", "⌘⇧R") },
      { token: "indent", label: "Indent", keys: both("Ctrl+]", "⌘]") },
      { token: "outdent", label: "Outdent", keys: both("Ctrl+[", "⌘[") },
      { token: "pagebreak", label: "Page break", keys: both("Ctrl+Enter", "⌘↩") },
    ],
  },
  {
    label: "Timing",
    options: [
      { token: "pause 1", label: "Pause 1 second", keys: both("—", "—") },
      { token: "pause 3", label: "Pause 3 seconds", keys: both("—", "—") },
    ],
  },
];
