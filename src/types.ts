export type TabId = "type" | "presets" | "settings";
export type Phase = "idle" | "countdown" | "typing" | "paused";
export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface TypingSettings {
  /** 1–30 seconds */
  startDelaySecs: number;
  /** 10–300 WPM */
  minWpm: number;
  /** 10–300 WPM */
  maxWpm: number;
  /** 0–100 percent */
  randomness: number;
  punctuationEnabled: boolean;
  /** 1.0–4.0 multiplier */
  punctuationFactor: number;
  lineBreakEnabled: boolean;
  /** 80–1500 ms */
  lineBreakExtraMs: number;
  thinkingEnabled: boolean;
  /** 20–400 characters between thinking pauses */
  thinkingEveryChars: number;
  /** 300–5000 ms maximum pause length */
  thinkingPauseMaxMs: number;
  burstEnabled: boolean;
  /** 10–100 percent */
  burstIntensity: number;
  typosEnabled: boolean;
  /** 0.5–15 percent per eligible character */
  typoChance: number;
  fatigueEnabled: boolean;
  /** 0–40 percent slow-down across the text */
  fatigueDrift: number;
  /** Which kinds of typo may happen; at least one stays on. */
  typoNeighbor: boolean;
  typoSwap: boolean;
  typoDouble: boolean;
  typoSkip: boolean;
  /** 0–60 percent of typos noticed one to three keys late */
  lateNoticeChance: number;
  /** 40–1500 ms between a typo and the first backspace */
  typoReactionMs: number;
  /** 30–400 ms per backspace */
  backspaceMs: number;
  paragraphEnabled: boolean;
  /** 100–6000 ms extra at a blank line */
  paragraphExtraMs: number;
  wordPauseEnabled: boolean;
  /** 5–500 ms average extra after each space */
  wordPauseMs: number;
  capitalEnabled: boolean;
  /** 5–400 ms average extra before a capital letter */
  capitalExtraMs: number;
  warmupEnabled: boolean;
  /** 20–1000 characters to reach full speed */
  warmupChars: number;
}

export interface AppSettings {
  typing: TypingSettings;
  theme: ThemeChoice;
  alwaysOnTop: boolean;
  stopOnEsc: boolean;
  stopOnFocusLoss: boolean;
  hotkeyStart: string;
  hotkeyPause: string;
  /** Run {{…}} commands in scripts instead of typing them. */
  scriptCommands: boolean;
  /** Look for a new version when MrTyper opens. */
  checkUpdates: boolean;
}

export interface Preset {
  id: string;
  name: string;
  typing: TypingSettings;
  updatedAt: number;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BootstrapPayload {
  settings: AppSettings;
  presets: Preset[];
  lastText: string;
  windowBounds: WindowBounds | null;
}

export interface StartRequest {
  text: string;
  settings: AppSettings;
}

export interface EngineStatus {
  phase: Phase;
  runId: number | null;
  countdown: number | null;
  typed: number;
  total: number;
  wpm: number;
  etaSecs: number | null;
  elapsedMs: number;
}

export interface PhasePayload {
  phase: Phase;
  runId: number;
  countdown: number | null;
  total: number;
}

export interface ProgressPayload {
  runId: number;
  typed: number;
  total: number;
  wpm: number;
  etaSecs: number | null;
  elapsedMs: number;
}

export interface KeystrokePayload {
  runId: number;
  index: number;
  kind: "key" | "typo" | "correction";
}

export type FinishReason =
  | "completed"
  | "stopped"
  | "escape"
  | "focusLost"
  | "error";

export interface FinishedPayload {
  runId: number;
  reason: FinishReason;
  typed: number;
  total: number;
  elapsedMs: number;
  wpm: number;
  message?: string | null;
}

export interface ToastPayload {
  kind: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
}

export interface BackendEvents {
  "typing-phase": PhasePayload;
  "typing-progress": ProgressPayload;
  "typing-keystroke": KeystrokePayload;
  "typing-finished": FinishedPayload;
  "mrtyper-toast": ToastPayload;
}

export interface ToastMessage {
  id: number;
  kind: ToastPayload["kind"];
  title?: string;
  message: string;
}

export interface SessionSummary {
  reason: FinishReason;
  typed: number;
  total: number;
  elapsedMs: number;
  wpm: number;
  message?: string | null;
}

export interface LiveEngineState {
  phase: Phase;
  countdown: number | null;
  typed: number;
  total: number;
  wpm: number;
  etaSecs: number | null;
  elapsedMs: number;
  runId: number | null;
}
