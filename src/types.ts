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
}

export interface AppSettings {
  typing: TypingSettings;
  theme: ThemeChoice;
  alwaysOnTop: boolean;
  stopOnEsc: boolean;
  stopOnFocusLoss: boolean;
  hotkeyStart: string;
  hotkeyPause: string;
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
  strokes: number;
}
