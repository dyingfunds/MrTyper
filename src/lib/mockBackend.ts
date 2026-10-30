import type {
  AppSettings,
  BackendEvents,
  BootstrapPayload,
  EngineStatus,
  FinishReason,
  Phase,
  Preset,
  StartRequest,
  TypingSettings,
  WindowBounds,
} from "../types";
import {
  DEFAULT_SETTINGS,
  makeDefaultPresets,
  normalizeSettings,
  normalizeTyping,
} from "./defaults";

const STORAGE_KEY = "mrtyper.browser-preview.v1";
const DEMO_TEXT =
  "Meet MrTyper — a small, deliberate typing companion.\n\nPaste a script, choose a rhythm, and let it write itself into whatever window you choose. It understands café accents, 日本語, and even ✨ emoji.\n\nEvery pause, stumble, and burst is yours to tune.";

interface StoredState {
  settings: AppSettings;
  presets: Preset[];
  lastText: string;
  windowBounds: WindowBounds | null;
}

interface MockRun {
  runId: number;
  text: string;
  chars: string[];
  settings: AppSettings;
  index: number;
  phase: Phase;
  countdown: number | null;
  startedAt: number | null;
  paused: boolean;
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function readStorage(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      return {
        settings: normalizeSettings(parsed.settings),
        presets: Array.isArray(parsed.presets)
          ? parsed.presets
              .filter(
                (preset): preset is Preset =>
                  Boolean(preset) &&
                  typeof preset.id === "string" &&
                  typeof preset.name === "string" &&
                  Boolean(preset.typing),
              )
              .map((preset) => ({
                ...preset,
                typing: normalizeTyping(preset.typing),
              }))
          : makeDefaultPresets(),
        lastText: typeof parsed.lastText === "string" ? parsed.lastText : DEMO_TEXT,
        windowBounds: parsed.windowBounds ?? null,
      };
    }
  } catch {
    // A corrupt preview cache should never prevent the demo from loading.
  }
  return {
    settings: normalizeSettings(DEFAULT_SETTINGS),
    presets: makeDefaultPresets(),
    lastText: DEMO_TEXT,
    windowBounds: null,
  };
}

/**
 * A lightweight in-browser approximation of the Rust engine. It exists so the UI can
 * be developed and reviewed in a normal browser. The packaged application always uses
 * the native backend.
 */
class MockBackend {
  private state = readStorage();
  private listeners = new Map<keyof BackendEvents, Set<(payload: never) => void>>();
  private run: MockRun | null = null;
  private nextRunId = 1;

  constructor() {
    window.addEventListener("keydown", this.handleGlobalKeydown);
  }

  async bootstrap(): Promise<BootstrapPayload> {
    return {
      settings: this.state.settings,
      presets: this.state.presets,
      lastText: this.state.lastText,
      windowBounds: this.state.windowBounds,
    };
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const next = normalizeSettings(settings);
    if (
      !next.hotkeyStart ||
      !next.hotkeyPause ||
      next.hotkeyStart === next.hotkeyPause ||
      next.hotkeyStart.toUpperCase().startsWith("ESCAPE") ||
      next.hotkeyPause.toUpperCase().startsWith("ESCAPE")
    ) {
      throw new Error("Choose two different shortcut keys. Escape is reserved for stopping.");
    }
    this.state.settings = next;
    this.persist();
    return next;
  }

  async saveLastText(text: string): Promise<void> {
    this.state.lastText = text;
    this.persist();
  }

  async saveWindowBounds(bounds: WindowBounds): Promise<void> {
    this.state.windowBounds = bounds;
    this.persist();
  }

  async startTyping(request: StartRequest): Promise<void> {
    if (this.run) throw new Error("A typing session is already running.");
    const text = request.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text.trim()) throw new Error("There is nothing to type yet.");

    this.state.settings = normalizeSettings(request.settings);
    this.state.lastText = request.text;
    this.persist();

    const chars = Array.from(text);
    const countdown = this.state.settings.typing.startDelaySecs;
    const run: MockRun = {
      runId: this.nextRunId++,
      text,
      chars,
      settings: structuredClone(this.state.settings),
      index: 0,
      phase: "countdown",
      countdown,
      startedAt: null,
      paused: false,
      cancelled: false,
      timer: null,
    };
    this.run = run;
    this.emitPhase(run);
    this.tickCountdown(run);
  }

  async pauseTyping(): Promise<void> {
    const run = this.run;
    if (!run || run.phase !== "typing") return;
    run.phase = "paused";
    run.paused = true;
    this.emitPhase(run);
  }

  async resumeTyping(): Promise<void> {
    const run = this.run;
    if (!run || run.phase !== "paused") return;
    run.phase = "typing";
    run.paused = false;
    this.emitPhase(run);
  }

  async stopTyping(): Promise<void> {
    this.finish(this.run, "stopped");
  }

  async emergencyStop(): Promise<void> {
    this.finish(this.run, "escape");
  }

  async savePreset(name: string, typing: TypingSettings): Promise<Preset> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Give this preset a name.");
    if (
      this.state.presets.some(
        (preset) => preset.name.toLowerCase() === cleanName.toLowerCase(),
      )
    ) {
      throw new Error("A preset with that name already exists.");
    }
    const preset: Preset = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: cleanName,
      typing: normalizeTyping(typing),
      updatedAt: Date.now(),
    };
    this.state.presets = [preset, ...this.state.presets];
    this.persist();
    return preset;
  }

  async renamePreset(id: string, name: string): Promise<Preset> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Give this preset a name.");
    if (
      this.state.presets.some(
        (preset) =>
          preset.id !== id && preset.name.toLowerCase() === cleanName.toLowerCase(),
      )
    ) {
      throw new Error("A preset with that name already exists.");
    }
    const preset = this.state.presets.find((item) => item.id === id);
    if (!preset) throw new Error("That preset no longer exists.");
    preset.name = cleanName;
    preset.updatedAt = Date.now();
    this.persist();
    return { ...preset };
  }

  async deletePreset(id: string): Promise<void> {
    this.state.presets = this.state.presets.filter((preset) => preset.id !== id);
    this.persist();
  }

  async getEngineStatus(): Promise<EngineStatus> {
    const run = this.run;
    if (!run) {
      return {
        phase: "idle",
        runId: null,
        countdown: null,
        typed: 0,
        total: 0,
        wpm: 0,
        etaSecs: null,
        elapsedMs: 0,
      };
    }
    return {
      phase: run.phase,
      runId: run.runId,
      countdown: run.phase === "countdown" ? run.countdown : null,
      typed: run.index,
      total: run.chars.length,
      wpm: this.currentWpm(run),
      etaSecs: null,
      elapsedMs:
        run.startedAt === null
          ? 0
          : Math.max(0, performance.now() - run.startedAt),
    };
  }

  on<K extends keyof BackendEvents>(
    event: K,
    handler: (payload: BackendEvents[K]) => void,
  ): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(handler as (payload: never) => void);
    return () => {
      this.listeners.get(event)?.delete(handler as (payload: never) => void);
    };
  }

  private emit<K extends keyof BackendEvents>(event: K, payload: BackendEvents[K]) {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const handler of bucket) {
      (handler as (value: BackendEvents[K]) => void)(payload);
    }
  }

  private emitPhase(run: MockRun) {
    this.emit("typing-phase", {
      phase: run.phase,
      runId: run.runId,
      countdown: run.phase === "countdown" ? run.countdown : null,
      total: run.chars.length,
    });
  }

  private tickCountdown(run: MockRun) {
    if (this.run !== run || run.cancelled) return;
    const scheduleTick = () => {
      run.timer = setTimeout(() => {
        if (this.run !== run || run.cancelled) return;
        if (run.countdown !== null && run.countdown > 1) {
          run.countdown -= 1;
          this.emitPhase(run);
          scheduleTick();
          return;
        }
        run.phase = "typing";
        run.countdown = null;
        run.startedAt = performance.now();
        this.emitPhase(run);
        this.scheduleNext(run, 140);
      }, 1000);
    };
    scheduleTick();
  }

  private scheduleNext(run: MockRun, delay: number) {
    if (this.run !== run || run.cancelled) return;
    run.timer = setTimeout(() => {
      if (this.run !== run || run.cancelled) return;
      if (run.paused) {
        this.scheduleNext(run, 100);
        return;
      }
      this.typeNext(run);
    }, Math.max(18, delay));
  }

  private typeNext(run: MockRun) {
    const char = run.chars[run.index];
    if (char === undefined) {
      this.finish(run, "completed");
      return;
    }

    run.index += 1;
    const now = performance.now();
    const elapsedMs = run.startedAt === null ? 0 : now - run.startedAt;
    const wpm = this.currentWpm(run);
    const remaining = run.chars.length - run.index;
    const charsPerMs = run.index / Math.max(1, elapsedMs);
    const etaSecs = remaining > 0 ? Math.round(remaining / charsPerMs / 1000) : 0;

    this.emit("typing-keystroke", {
      runId: run.runId,
      index: run.index,
      kind: "key",
    });
    this.emit("typing-progress", {
      runId: run.runId,
      typed: run.index,
      total: run.chars.length,
      wpm,
      etaSecs,
      elapsedMs,
    });

    if (run.index >= run.chars.length) {
      this.finish(run, "completed");
      return;
    }

    this.scheduleNext(run, this.delayFor(run, char, run.index));
  }

  private delayFor(run: MockRun, char: string, index: number): number {
    const typing = run.settings.typing;
    const { minWpm, maxWpm, randomness } = typing;
    const midpoint = (minWpm + maxWpm) / 2;
    const target =
      midpoint + (Math.random() * (maxWpm - minWpm) + minWpm - midpoint) * (randomness / 100);
    let wpm = Math.max(10, target);

    if (typing.burstEnabled) {
      const wave = Math.sin((index / Math.max(12, 26 - typing.burstIntensity / 5)) * Math.PI);
      wpm *= 1 + Math.max(0, wave) * (typing.burstIntensity / 100) * 0.5;
    }
    if (typing.fatigueEnabled) {
      wpm /= 1 + (index / run.chars.length) * (typing.fatigueDrift / 100);
    }

    let delay = 60_000 / (wpm * 5);

    if (typing.punctuationEnabled && /[.!?]/.test(char)) {
      delay *= 1 + (typing.punctuationFactor - 1) * 0.75;
    } else if (typing.punctuationEnabled && /[,;:]/.test(char)) {
      delay *= 1 + (typing.punctuationFactor - 1) * 0.35;
    }
    if (typing.lineBreakEnabled && char === "\n") {
      delay += typing.lineBreakExtraMs + Math.random() * typing.lineBreakExtraMs * 0.4;
    }
    if (
      typing.thinkingEnabled &&
      index > 0 &&
      index % typing.thinkingEveryChars === 0
    ) {
      delay += 300 + Math.random() * (typing.thinkingPauseMaxMs - 300);
    }
    if (typing.typosEnabled && Math.random() < typing.typoChance / 100) {
      delay += 110 + Math.random() * 140;
    }

    return delay;
  }

  private currentWpm(run: MockRun): number {
    if (run.startedAt === null || run.index === 0) return 0;
    const minutes = Math.max(0.002, (performance.now() - run.startedAt) / 60_000);
    return Math.min(999, Math.round((run.index / 5 / minutes) * 10) / 10);
  }

  private finish(run: MockRun | null, reason: FinishReason, message?: string) {
    if (!run || this.run !== run) return;
    run.cancelled = true;
    if (run.timer) clearTimeout(run.timer);
    this.run = null;
    const elapsedMs =
      run.startedAt === null ? 0 : Math.max(0, performance.now() - run.startedAt);
    this.emit("typing-finished", {
      runId: run.runId,
      reason,
      typed: run.index,
      total: run.chars.length,
      elapsedMs,
      wpm:
        run.index > 0 && elapsedMs > 0
          ? Math.round((run.index / 5 / (elapsedMs / 60_000)) * 10) / 10
          : 0,
      message,
    });
  }

  private persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Preview persistence is best effort.
    }
  }

  private handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const startMatch = matchesAccelerator(event, this.state.settings.hotkeyStart);
    const pauseMatch = matchesAccelerator(event, this.state.settings.hotkeyPause);

    if (startMatch) {
      event.preventDefault();
      if (this.run) {
        this.stopTyping().catch(() => undefined);
      } else if (this.state.lastText.trim()) {
        this.startTyping({
          text: this.state.lastText,
          settings: this.state.settings,
        }).catch(() => undefined);
      } else {
        this.emit("mrtyper-toast", {
          kind: "error",
          title: "Nothing to type",
          message: "Add a script before starting a session.",
        });
      }
    }

    if (pauseMatch) {
      event.preventDefault();
      if (this.run?.phase === "paused") {
        this.resumeTyping().catch(() => undefined);
      } else {
        this.pauseTyping().catch(() => undefined);
      }
    }
  };
}

function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const key = tokens[tokens.length - 1].toUpperCase();
  const modifiers = new Set(tokens.slice(0, -1).map((token) => token.toUpperCase()));
  const ctrl = modifiers.has("CTRL") || modifiers.has("CONTROL") || modifiers.has("COMMANDORCONTROL");
  const alt = modifiers.has("ALT") || modifiers.has("OPTION");
  const shift = modifiers.has("SHIFT");
  const meta =
    modifiers.has("SUPER") || modifiers.has("META") || modifiers.has("COMMAND") || modifiers.has("CMD");
  if (event.ctrlKey !== ctrl) return false;
  if (event.altKey !== alt) return false;
  if (event.shiftKey !== shift) return false;
  if (event.metaKey !== meta) return false;
  return event.key.toUpperCase() === key || event.code.toUpperCase() === key;
}

export const mockBackend = new MockBackend();
