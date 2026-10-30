import { AnimatePresence, motion } from "framer-motion";
import {
  AlignLeft,
  ArrowUpRight,
  ClipboardPaste,
  FileText,
  Gauge,
  Keyboard,
  Lock,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Type as TypeIcon,
  Waves,
} from "lucide-react";
import { useMemo, useRef, type ChangeEvent } from "react";
import { GlassCard } from "../components/GlassCard";
import { AnimatedNumber } from "../components/ui/AnimatedNumber";
import { GlassButton, IconButton, StartButton } from "../components/ui/Button";
import { HotkeyKeycaps, Keycap } from "../components/ui/Keycap";
import { RangeSlider, Slider } from "../components/ui/Slider";
import { Toggle } from "../components/ui/Toggle";
import { springSoft } from "../lib/motion";
import {
  averageWpm,
  characterCount,
  cn,
  estimateDurationSeconds,
  formatDuration,
  formatElapsed,
  formatNumber,
  formatWpm,
  wordCount,
} from "../lib/utils";
import type {
  AppSettings,
  FinishReason,
  LiveEngineState,
  SessionSummary,
  TypingSettings,
} from "../types";

type Notify = (
  kind: "info" | "success" | "warning" | "error",
  title: string,
  message: string,
) => void;

interface TypePageProps {
  settings: AppSettings;
  text: string;
  engine: LiveEngineState;
  lastRun: SessionSummary | null;
  onTextChange: (text: string) => void;
  onTypingChange: (patch: Partial<TypingSettings>) => void;
  onStart: () => void;
  onStop: () => void;
  onPauseResume: () => void;
  onOpenSettings: () => void;
  notify: Notify;
}

const REASON_LABEL: Record<FinishReason, string> = {
  completed: "Complete",
  stopped: "Stopped",
  escape: "Emergency stop",
  focusLost: "Focus lost",
  error: "Interrupted",
};

const REALISM_CONTROLS: Array<{
  key: keyof Pick<
    TypingSettings,
    | "punctuationEnabled"
    | "lineBreakEnabled"
    | "thinkingEnabled"
    | "burstEnabled"
    | "typosEnabled"
    | "fatigueEnabled"
  >;
  label: string;
  value: (typing: TypingSettings) => string;
}> = [
  {
    key: "punctuationEnabled",
    label: "Punctuation",
    value: (typing) => `${typing.punctuationFactor.toFixed(1)}×`,
  },
  {
    key: "lineBreakEnabled",
    label: "Line breaks",
    value: (typing) => `${typing.lineBreakExtraMs}ms`,
  },
  {
    key: "thinkingEnabled",
    label: "Thinking",
    value: (typing) => `every ${typing.thinkingEveryChars}`,
  },
  {
    key: "burstEnabled",
    label: "Bursts",
    value: (typing) => `${typing.burstIntensity}%`,
  },
  {
    key: "typosEnabled",
    label: "Typos",
    value: (typing) => `${typing.typoChance.toFixed(1)}%`,
  },
  {
    key: "fatigueEnabled",
    label: "Fatigue",
    value: (typing) => `+${typing.fatigueDrift}%`,
  },
];

const METER_HEIGHTS = [5, 8, 12, 7, 14, 10, 6, 11, 8, 13, 6, 9];

export function TypePage({
  settings,
  text,
  engine,
  lastRun,
  onTextChange,
  onTypingChange,
  onStart,
  onStop,
  onPauseResume,
  onOpenSettings,
  notify,
}: TypePageProps) {
  const typing = settings.typing;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isIdle = engine.phase === "idle";
  const isCounting = engine.phase === "countdown";
  const isPaused = engine.phase === "paused";
  const isActive = !isIdle;

  const counts = useMemo(
    () => ({
      characters: characterCount(text),
      words: wordCount(text),
      seconds: estimateDurationSeconds(text, typing),
    }),
    [text, typing],
  );

  const progress = engine.total
    ? Math.min(1, engine.typed / engine.total)
    : lastRun?.total
      ? Math.min(1, lastRun.typed / lastRun.total)
      : 0;

  const enabledLayers = REALISM_CONTROLS.filter(
    (control) => typing[control.key],
  ).length;
  const humanScore =
    0.16 +
    (enabledLayers / REALISM_CONTROLS.length) * 0.62 +
    (typing.randomness / 100) * 0.22;

  async function pasteFromClipboard() {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (!clipboard) {
        notify("info", "Clipboard is empty", "Copy some text first, then try again.");
        return;
      }
      const el = textareaRef.current;
      if (el) {
        const start = el.selectionStart ?? text.length;
        const end = el.selectionEnd ?? text.length;
        const next = `${text.slice(0, start)}${clipboard}${text.slice(end)}`;
        onTextChange(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + clipboard.length, start + clipboard.length);
        });
      } else {
        onTextChange(text + clipboard);
      }
    } catch {
      notify(
        "warning",
        "Clipboard unavailable",
        "Use Ctrl + V inside the editor instead.",
      );
    }
  }

  return (
    <div className="page" id="panel-type" role="tabpanel" aria-label="Type">
      <div className="page-heading">
        <div className="page-heading-copy">
          <span className="eyebrow">The writing room</span>
          <h1 className="page-title">Make every keystroke feel human.</h1>
          <p className="page-subtitle">
            Give MrTyper a script, dial in a rhythm, then let it write itself
            into whatever window you choose.
          </p>
        </div>
        <div className="heading-badges">
          <span className="stat-pill">
            <Gauge size={11} strokeWidth={1.8} />
            {typing.minWpm}–{typing.maxWpm} WPM
          </span>
          <span className="stat-pill">
            <Sparkles size={11} strokeWidth={1.8} />
            {typing.randomness}% random
          </span>
          <span className="stat-pill">
            <Lock size={10} strokeWidth={1.8} />
            Local only
          </span>
        </div>
      </div>

      <div className="type-grid">
        <div className="type-column">
          <GlassCard className="script-card card-pad">
            <div className="card-heading-row">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mini-orb">
                  <AlignLeft size={14} strokeWidth={1.7} />
                </span>
                <div className="card-heading-copy">
                  <span className="card-heading-kicker">Script</span>
                  <h2 className="section-title">What should MrTyper say?</h2>
                </div>
              </div>
              <span className="editor-badge">
                <TypeIcon size={8} strokeWidth={2} />
                PLAIN TEXT
              </span>
            </div>

            <div className="script-body">
              <textarea
                ref={textareaRef}
                className="script-input"
                value={text}
                disabled={!isIdle}
                aria-label="Text to type"
                placeholder={
                  "Paste an email, a story, a message…\n\nMrTyper types every character — accents, emoji, and all."
                }
                spellCheck={false}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  onTextChange(event.target.value)
                }
              />
              <div className="script-input-footer" aria-hidden="true">
                <span className="script-wordcount">
                  {formatNumber(counts.characters)} characters
                </span>
                <span>Newlines become Enter</span>
              </div>
            </div>

            <div className="script-footer">
              <div className="script-stats">
                <div className="script-stat">
                  <span className="script-stat-value">
                    {formatNumber(counts.characters)}
                  </span>
                  <span className="script-stat-label">Characters</span>
                </div>
                <div className="script-stat">
                  <span className="script-stat-value">
                    {formatNumber(counts.words)}
                  </span>
                  <span className="script-stat-label">Words</span>
                </div>
                <div className="script-stat">
                  <span className="script-stat-value">
                    {counts.seconds ? `~${formatDuration(counts.seconds)}` : "—"}
                  </span>
                  <span className="script-stat-label">At this pace</span>
                </div>
              </div>
              <div className="script-actions">
                <GlassButton
                  size="sm"
                  variant="ghost"
                  icon={ClipboardPaste}
                  onClick={pasteFromClipboard}
                  disabled={!isIdle}
                >
                  Paste
                </GlassButton>
                <IconButton
                  label="Clear script"
                  onClick={() => onTextChange("")}
                  disabled={!isIdle || text.length === 0}
                >
                  <Trash2 size={13} strokeWidth={1.7} />
                </IconButton>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="progress-card card-pad">
            <div className="progress-header">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Live progress</span>
                <h2 className="section-title">
                  {isActive
                    ? isPaused
                      ? "Holding the rhythm."
                      : isCounting
                        ? "Waiting for focus."
                        : "In the flow."
                    : lastRun
                      ? REASON_LABEL[lastRun.reason]
                      : "A clean slate."}
                </h2>
              </div>
              <div className="live-orb" aria-hidden="true">
                <div className={cn("live-wave", (engine.phase === "typing") && "is-active")}>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span key={index} />
                  ))}
                </div>
                <AnimatePresence mode="popLayout">
                  {engine.phase === "typing" && engine.strokes > 0 ? (
                    <motion.span
                      key={engine.strokes}
                      className="ripple-ring"
                      initial={{ opacity: 0.72, scale: 0.38 }}
                      animate={{ opacity: 0, scale: 1.75 }}
                      exit={{ opacity: 0, transition: { duration: 0.08 } }}
                      transition={{ type: "spring", stiffness: 135, damping: 19 }}
                    />
                  ) : null}
                </AnimatePresence>
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {isActive ? (
                <motion.div
                  key="live-progress"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={springSoft}
                >
                  <div className="wpm-live">
                    <strong>
                      <AnimatedNumber
                        value={engine.wpm}
                        format={(next) => formatWpm(next)}
                      />
                    </strong>
                    <span>effective WPM</span>
                    <span className="wpm-live-note">
                      {isPaused ? "Paused" : "Human cadence"}
                      <br />
                      {engine.typed > 0 ? "after pauses" : "warming up"}
                    </span>
                  </div>

                  <div className="progress-track-wrap">
                    <div className="progress-track">
                      <motion.div
                        className={cn(
                          "progress-fill",
                          engine.phase === "typing" && "is-shimmer",
                        )}
                        initial={false}
                        animate={{ width: `${progress * 100}%` }}
                        transition={springSoft}
                      />
                    </div>
                  </div>

                  <div className="progress-stats">
                    <div className="progress-stat">
                      <strong>
                        {formatNumber(engine.typed)}
                        <span className="text-[var(--text-faint)]">
                          {" "}
                          / {formatNumber(engine.total)}
                        </span>
                      </strong>
                      <span>Characters</span>
                    </div>
                    <div className="progress-stat">
                      <strong>{formatElapsed(engine.elapsedMs)}</strong>
                      <span>Elapsed</span>
                    </div>
                    <div className="progress-stat progress-stat--right">
                      <strong>
                        {enginelessEta(engine.etaSecs, engine.phase)}
                      </strong>
                      <span>Remaining</span>
                    </div>
                  </div>
                </motion.div>
              ) : lastRun ? (
                <motion.div
                  key="summary-progress"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={springSoft}
                >
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span
                      className={cn(
                        "progress-summary-reason",
                        (lastRun.reason === "error" ||
                          lastRun.reason === "focusLost") &&
                          "is-error",
                      )}
                    >
                      {lastRun.reason === "completed" ? (
                        <ShieldCheck size={9} strokeWidth={2} />
                      ) : lastRun.reason === "escape" ? (
                        <Square size={8} strokeWidth={2} />
                      ) : (
                        <Waves size={9} strokeWidth={2} />
                      )}
                      {REASON_LABEL[lastRun.reason]}
                    </span>
                    <span className="faint text-[9px]">
                      {formatNumber(lastRun.typed)} of {formatNumber(lastRun.total)}{" "}
                      delivered
                    </span>
                  </div>
                  <div className="progress-track-wrap">
                    <div className="progress-track">
                      <motion.div
                        className="progress-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress * 100}%` }}
                        transition={springSoft}
                      />
                    </div>
                  </div>
                  <div className="progress-stats">
                    <div className="progress-stat">
                      <strong>{formatWpm(lastRun.wpm)}</strong>
                      <span>Final WPM</span>
                    </div>
                    <div className="progress-stat">
                      <strong>{formatElapsed(lastRun.elapsedMs)}</strong>
                      <span>On stage</span>
                    </div>
                    <div className="progress-stat progress-stat--right">
                      <strong>
                        {lastRun.reason === "completed" ? "Done" : "Stopped"}
                      </strong>
                      <span>Status</span>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="idle-progress"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={springSoft}
                  className="progress-idle"
                >
                  <p className="section-hint max-w-[340px]">
                    Your keystrokes, pause patterns, and quiet corrections will
                    appear here once the curtain rises.
                  </p>
                  <div className="progress-idle-line" />
                  <div className="progress-idle-stats">
                    <div className="progress-stat">
                      <strong>0</strong>
                      <span>WPM</span>
                    </div>
                    <div className="progress-stat">
                      <strong>0:00</strong>
                      <span>Elapsed</span>
                    </div>
                    <div className="progress-stat progress-stat--right">
                      <strong>{formatDuration(counts.seconds)}</strong>
                      <span>Estimate</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        </div>

        <div className="type-column">
          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mini-orb">
                  <Keyboard size={14} strokeWidth={1.7} />
                </span>
                <div className="card-heading-copy">
                  <span className="card-heading-kicker">Session</span>
                  <h2 className="section-title">Set the pace.</h2>
                </div>
              </div>
              <span className="stat-pill">
                <span
                  className={cn(
                    "status-dot",
                    engine.phase === "typing" && "is-live",
                    engine.phase === "paused" && "is-paused",
                    engine.phase === "countdown" && "is-counting",
                  )}
                />
                {engine.phase === "idle"
                  ? "Ready"
                  : engine.phase === "typing"
                    ? "Typing"
                    : engine.phase === "paused"
                      ? "Paused"
                      : "Starting"}
              </span>
            </div>

            <div className="mt-4">
              <div className="speed-readout">
                <div className="speed-big">
                  <AnimatedNumber
                    value={averageWpm(typing)}
                    format={(next) => Math.round(next).toString()}
                  />
                  <span>WPM average</span>
                </div>
                <span className="speed-envelope">
                  {typing.minWpm}–{typing.maxWpm} range
                </span>
              </div>
              <RangeSlider
                min={10}
                max={300}
                step={1}
                value={[typing.minWpm, typing.maxWpm]}
                onChange={([minWpm, maxWpm]) =>
                  onTypingChange({ minWpm, maxWpm })
                }
                ariaLabelLow="Minimum words per minute"
                ariaLabelHigh="Maximum words per minute"
                formatValue={(value) => `${value} words per minute`}
                disabled={!isIdle}
              />
              <div className="range-values">
                <span className="range-value-pill">{typing.minWpm} min</span>
                <span className="range-value-pill">{typing.maxWpm} max</span>
              </div>
            </div>

            <div className="control-divider hairline" />

            <div className="secondary-controls-grid">
              <div>
                <div className="control-label-row">
                  <span className="control-label">Head start</span>
                  <span className="control-value">
                    {typing.startDelaySecs}s
                  </span>
                </div>
                <Slider
                  min={1}
                  max={30}
                  step={1}
                  value={typing.startDelaySecs}
                  onChange={(value) => onTypingChange({ startDelaySecs: value })}
                  ariaLabel="Start delay in seconds"
                  formatValue={(value) => `${value} seconds`}
                  disabled={!isIdle}
                />
                <p className="control-caption">Before the first key lands.</p>
              </div>
              <div>
                <div className="control-label-row">
                  <span className="control-label">Randomness</span>
                  <span className="control-value">{typing.randomness}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={typing.randomness}
                  onChange={(value) => onTypingChange({ randomness: value })}
                  ariaLabel="Keystroke randomness"
                  formatValue={(value) => `${value} percent`}
                  disabled={!isIdle}
                />
                <p className="control-caption">Key-to-key variance.</p>
              </div>
            </div>

            <div className="session-actions">
              <AnimatePresence mode="popLayout" initial={false}>
                {isIdle ? (
                  <motion.div
                    key="start"
                    className="w-full"
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={springSoft}
                  >
                    <StartButton
                      onClick={onStart}
                      mode="start"
                      label="Start typing"
                      icon={<Play size={12} fill="currentColor" strokeWidth={0} />}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="running"
                    className="flex w-full gap-2"
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={springSoft}
                  >
                    <GlassButton
                      className="flex-1"
                      icon={isPaused ? Play : Pause}
                      onClick={onPauseResume}
                      disabled={isCounting}
                    >
                      {isPaused ? "Resume" : "Pause"}
                    </GlassButton>
                    <GlassButton
                      className="flex-1"
                      variant="danger"
                      icon={Square}
                      onClick={onStop}
                    >
                      Stop
                    </GlassButton>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="shortcut-note">
              <span className="inline-flex items-center gap-1">
                <HotkeyKeycaps accelerator={settings.hotkeyStart} /> start / stop
              </span>
              <span className="nav-meta-sep" />
              <span className="inline-flex items-center gap-1">
                <HotkeyKeycaps accelerator={settings.hotkeyPause} /> pause
              </span>
              {settings.stopOnEsc ? (
                <>
                  <span className="nav-meta-sep" />
                  <span className="inline-flex items-center gap-1">
                    <Keycap>Esc</Keycap> is safety
                  </span>
                </>
              ) : null}
            </div>
          </GlassCard>

          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Human texture</span>
                <h2 className="section-title">A little imperfection.</h2>
              </div>
              <button
                type="button"
                className="section-link"
                onClick={onOpenSettings}
              >
                Tune
                <ArrowUpRight size={10} strokeWidth={1.8} />
              </button>
            </div>

            <div className="realism-grid">
              {REALISM_CONTROLS.map((control) => {
                const enabled = typing[control.key];
                return (
                  <div
                    key={control.key}
                    className={cn("realism-chip", enabled && "is-on")}
                    title={
                      enabled
                        ? `${control.label}: ${control.value(typing)}`
                        : `${control.label}: off`
                    }
                  >
                    <span className="realism-chip-label">
                      <span>{control.label}</span>
                      <span className="realism-chip-value">
                        {enabled ? control.value(typing) : "off"}
                      </span>
                    </span>
                    <Toggle
                      checked={enabled}
                      onChange={(checked) =>
                        onTypingChange({ [control.key]: checked })
                      }
                      label={`${control.label} ${enabled ? "on" : "off"}`}
                      disabled={!isIdle}
                    />
                  </div>
                );
              })}
            </div>

            <div className="realism-footer">
              <div className="human-readout">
                <div className="human-meter" aria-hidden="true">
                  {METER_HEIGHTS.map((height, index) => (
                    <span
                      key={index}
                      style={{
                        height: Math.max(3, height * humanScore),
                        opacity: 0.3 + humanScore * 0.65,
                      }}
                    />
                  ))}
                </div>
                <span className="section-hint">
                  {enabledLayers} of {REALISM_CONTROLS.length} layers on
                </span>
              </div>
              <span className="faint text-[8.5px]">
                {typing.typosEnabled
                  ? "QWERTY neighbour map"
                  : "Clean key strikes"}
              </span>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function enginelessEta(etaSecs: number | null, phase: string): string {
  if (phase === "paused") return "Paused";
  if (etaSecs === null || !Number.isFinite(etaSecs)) return "—";
  return formatDuration(etaSecs);
}
