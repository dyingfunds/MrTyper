import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  ClipboardPaste,
  Eraser,
  FileDown,
  Pause,
  Play,
  Square,
} from "lucide-react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { CadenceScope } from "../components/CadenceScope";
import { LiveScript } from "../components/LiveScript";
import { Tachometer } from "../components/Tachometer";
import { AnimatedNumber } from "../components/ui/AnimatedNumber";
import { Button, IconButton } from "../components/ui/Button";
import { Keycap } from "../components/ui/Keycap";
import { RangeSlider, Slider } from "../components/ui/Slider";
import { humanLabel, humanScore } from "../lib/cadence";
import { easeOut, springSnappy } from "../lib/motion";
import {
  averageWpm,
  characterCount,
  cn,
  estimateDurationSeconds,
  formatDuration,
  formatElapsed,
  formatHotkey,
  formatNumber,
  formatWpm,
  normalizeScript,
  wordCount,
} from "../lib/utils";
import type {
  AppSettings,
  FinishReason,
  LiveEngineState,
  Phase,
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
  paletteKey: string;
  onTextChange: (text: string) => void;
  onTypingChange: (patch: Partial<TypingSettings>) => void;
  onStart: () => void;
  onStop: () => void;
  onPauseResume: () => void;
  onOpenSettings: () => void;
  notify: Notify;
}

interface ScriptCounts {
  characters: number;
  words: number;
  seconds: number;
}

/** Dropped files larger than this are almost certainly not a script. */
const MAX_DROP_BYTES = 1_500_000;

/* ------------------------------------------------------------------ */
/*  Stage                                                              */
/* ------------------------------------------------------------------ */

interface StageProps {
  text: string;
  phase: Phase;
  typed: number;
  total: number;
  counts: ScriptCounts;
  hotkeyStart: string;
  onTextChange: (text: string) => void;
  notify: Notify;
}

const Stage = memo(function Stage({
  text,
  phase,
  typed,
  total,
  counts,
  hotkeyStart,
  onTextChange,
  notify,
}: StageProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
  const isIdle = phase === "idle";
  const liveText = useMemo(() => (isIdle ? "" : normalizeScript(text)), [isIdle, text]);

  const insertAtCursor = useCallback(
    (addition: string) => {
      const element = textareaRef.current;
      if (!element) {
        onTextChange(text + addition);
        return;
      }
      const start = element.selectionStart ?? text.length;
      const end = element.selectionEnd ?? text.length;
      onTextChange(`${text.slice(0, start)}${addition}${text.slice(end)}`);
      requestAnimationFrame(() => {
        element.focus();
        const caret = start + addition.length;
        element.setSelectionRange(caret, caret);
      });
    },
    [onTextChange, text],
  );

  async function pasteFromClipboard() {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (!clipboard) {
        notify("info", "Clipboard is empty", "Copy some text first, then try again.");
        return;
      }
      insertAtCursor(clipboard);
    } catch {
      notify(
        "warning",
        "Clipboard unavailable",
        "Click into the editor and press Ctrl + V instead.",
      );
    }
  }

  function hasDroppable(event: ReactDragEvent<HTMLElement>): boolean {
    const types = event.dataTransfer?.types;
    return Boolean(types && (types.includes("Files") || types.includes("text/plain")));
  }

  function handleDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!isIdle || !hasDroppable(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }

  function handleDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!isIdle || !hasDroppable(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }

  async function handleDrop(event: ReactDragEvent<HTMLElement>) {
    dragDepth.current = 0;
    setDropping(false);
    if (!isIdle || !hasDroppable(event)) return;
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      const dropped = event.dataTransfer.getData("text/plain");
      if (dropped) onTextChange(dropped);
      return;
    }
    if (file.size > MAX_DROP_BYTES) {
      notify("warning", "That file is too large", "Drop a plain-text file under 1.5 MB.");
      return;
    }
    try {
      const contents = await file.text();
      if (contents.includes("\u0000")) {
        notify("warning", "Not a text file", "MrTyper can only load plain text.");
        return;
      }
      onTextChange(normalizeScript(contents));
      notify("success", "Script loaded", `${file.name} is on the stage.`);
    } catch {
      notify("error", "Couldn't read that file", "Try pasting its contents instead.");
    }
  }

  return (
    <section
      className={cn("panel stage rise", !isIdle && "is-live", dropping && "is-dropping")}
      style={{ "--i": 0 } as CSSProperties}
      aria-label="Script"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      <header className="stage-head">
        <span className="stage-title label">
          <span className={cn("led", `is-${phase}`)} />
          {isIdle ? "Script" : phase === "countdown" ? "Armed" : "Live"}
        </span>

        <div className="stage-stats">
          {isIdle ? (
            <>
              <span>
                <strong>{formatNumber(counts.characters)}</strong> chars
              </span>
              <i />
              <span>
                <strong>{formatNumber(counts.words)}</strong> words
              </span>
              <i className="is-optional" />
              <span className="is-optional">
                <strong>{counts.seconds ? `~${formatDuration(counts.seconds)}` : "—"}</strong>{" "}
                to type
              </span>
            </>
          ) : (
            <span>
              <strong>{formatNumber(typed)}</strong> / {formatNumber(total)} delivered
            </span>
          )}
        </div>

        <div className="stage-actions">
          <IconButton
            label="Paste from clipboard"
            onClick={() => void pasteFromClipboard()}
            disabled={!isIdle}
          >
            <ClipboardPaste size={15} strokeWidth={1.8} />
          </IconButton>
          <IconButton
            label="Clear script"
            tone="danger"
            onClick={() => {
              onTextChange("");
              textareaRef.current?.focus();
            }}
            disabled={!isIdle || text.length === 0}
          >
            <Eraser size={15} strokeWidth={1.8} />
          </IconButton>
        </div>
      </header>

      <div className="stage-body">
        <textarea
          ref={textareaRef}
          className="script-input"
          value={text}
          disabled={!isIdle}
          aria-label="Text to type"
          placeholder={text ? undefined : "Start writing, or paste a script…"}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => onTextChange(event.target.value)}
        />

        <AnimatePresence initial={false}>
          {!isIdle ? (
            <motion.div
              key="live"
              className="absolute inset-0 z-[2]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <LiveScript text={liveText} typed={typed} phase={phase} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {isIdle && text.length === 0 ? (
            <motion.div
              key="empty"
              className="stage-empty"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.4, ease: easeOut }}
            >
              <p className="stage-empty-title">
                Paste a script.
                <br />
                Pick a rhythm.
                <br />
                <b>Press {formatHotkey(hotkeyStart)}.</b>
              </p>
              <div className="stage-empty-row">
                <Button icon={ClipboardPaste} onClick={() => void pasteFromClipboard()}>
                  Paste from clipboard
                </Button>
                <span>or drop a text file anywhere here</span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {dropping ? (
          <div className="stage-drop">
            <FileDown size={16} strokeWidth={1.8} />
            Drop to load script
          </div>
        ) : null}
      </div>
    </section>
  );
});

/* ------------------------------------------------------------------ */
/*  Deck                                                               */
/* ------------------------------------------------------------------ */

type RealismKey =
  | "punctuationEnabled"
  | "lineBreakEnabled"
  | "thinkingEnabled"
  | "burstEnabled"
  | "typosEnabled"
  | "fatigueEnabled";

const REALISM_KEYS: Array<{
  key: RealismKey;
  label: string;
  value: (typing: TypingSettings) => string;
}> = [
  {
    key: "punctuationEnabled",
    label: "Punctuation",
    value: (typing) => `${typing.punctuationFactor.toFixed(1)}× pause`,
  },
  {
    key: "lineBreakEnabled",
    label: "Line breaks",
    value: (typing) => `+${typing.lineBreakExtraMs} ms`,
  },
  {
    key: "thinkingEnabled",
    label: "Thinking",
    value: (typing) => `every ${typing.thinkingEveryChars}`,
  },
  {
    key: "burstEnabled",
    label: "Bursts",
    value: (typing) => `${typing.burstIntensity}% surge`,
  },
  {
    key: "typosEnabled",
    label: "Typos",
    value: (typing) => `${typing.typoChance.toFixed(1)}% chance`,
  },
  {
    key: "fatigueEnabled",
    label: "Fatigue",
    value: (typing) => `+${typing.fatigueDrift}% drift`,
  },
];

const METER_CELLS = 16;

interface DeckProps {
  typing: TypingSettings;
  phase: Phase;
  liveWpm: number;
  onTypingChange: (patch: Partial<TypingSettings>) => void;
  onOpenSettings: () => void;
}

const Deck = memo(function Deck({
  typing,
  phase,
  liveWpm,
  onTypingChange,
  onOpenSettings,
}: DeckProps) {
  const [tempoDragging, setTempoDragging] = useState(false);
  const isIdle = phase === "idle";
  const showLive = phase === "typing" || phase === "paused";
  const score = humanScore(typing);
  const litCells = Math.round(score * METER_CELLS);

  return (
    <aside
      className="panel deck rise"
      style={{ "--i": 1 } as CSSProperties}
      aria-label="Session controls"
    >
      <section className="deck-section">
        <div className="deck-head">
          <span className="label">Tempo</span>
          <span className="tag num">
            {typing.minWpm}–{typing.maxWpm} wpm
          </span>
        </div>
        <Tachometer
          min={typing.minWpm}
          max={typing.maxWpm}
          live={showLive ? liveWpm : null}
          paused={phase === "paused"}
          dragging={tempoDragging}
        />
        <div className="tempo-range">
          <div className="tempo-bound">
            <strong>{typing.minWpm}</strong>
            <span>Min</span>
          </div>
          <RangeSlider
            min={10}
            max={300}
            step={1}
            value={[typing.minWpm, typing.maxWpm]}
            onChange={([minWpm, maxWpm]) => onTypingChange({ minWpm, maxWpm })}
            ariaLabelLow="Minimum words per minute"
            ariaLabelHigh="Maximum words per minute"
            formatValue={(value) => `${value} words per minute`}
            bubble={(value) => `${value}`}
            disabled={!isIdle}
            onDragChange={setTempoDragging}
          />
          <div className="tempo-bound">
            <strong>{typing.maxWpm}</strong>
            <span>Max</span>
          </div>
        </div>
      </section>

      <section className="deck-section">
        <div className="control-row">
          <div className="control-top">
            <span className="control-name">
              Head start
              <span className="control-hint">before the first key</span>
            </span>
            <span className="control-value">{typing.startDelaySecs}s</span>
          </div>
          <Slider
            min={1}
            max={30}
            step={1}
            value={typing.startDelaySecs}
            onChange={(startDelaySecs) => onTypingChange({ startDelaySecs })}
            ariaLabel="Start delay in seconds"
            formatValue={(value) => `${value} seconds`}
            bubble={(value) => `${value}s`}
            disabled={!isIdle}
          />
        </div>
        <div className="control-row">
          <div className="control-top">
            <span className="control-name">
              Randomness
              <span className="control-hint">key-to-key variance</span>
            </span>
            <span className="control-value">{typing.randomness}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={typing.randomness}
            onChange={(randomness) => onTypingChange({ randomness })}
            ariaLabel="Keystroke randomness"
            formatValue={(value) => `${value} percent`}
            bubble={(value) => `${value}%`}
            disabled={!isIdle}
          />
        </div>
      </section>

      <section className="deck-section">
        <div className="deck-head">
          <span className="label">Humanize</span>
          <button type="button" className="deck-link" onClick={onOpenSettings}>
            Fine-tune
            <ArrowUpRight size={13} strokeWidth={2} />
          </button>
        </div>

        <div className="human-grid">
          {REALISM_KEYS.map((control) => {
            const enabled = typing[control.key];
            return (
              <button
                key={control.key}
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${control.label} ${enabled ? "on" : "off"}`}
                className="human-key"
                disabled={!isIdle}
                onClick={() => onTypingChange({ [control.key]: !enabled })}
              >
                <span className="human-key-led" />
                <span className="human-key-name">{control.label}</span>
                <span className="human-key-value">
                  {enabled ? control.value(typing) : "off"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="human-meter" aria-label={`Humanity: ${humanLabel(score)}`}>
          <div className="human-meter-cells" aria-hidden="true">
            {Array.from({ length: METER_CELLS }, (_, index) => (
              <i
                key={index}
                className={index < litCells ? "is-on" : undefined}
                style={{ "--i": index } as CSSProperties}
              />
            ))}
          </div>
          <span className="human-meter-label">{humanLabel(score)}</span>
        </div>
      </section>
    </aside>
  );
});

/* ------------------------------------------------------------------ */
/*  Transport                                                          */
/* ------------------------------------------------------------------ */

const REASON_LABEL: Record<FinishReason, string> = {
  completed: "Delivered",
  stopped: "Stopped",
  escape: "Emergency stop",
  focusLost: "Focus lost",
  error: "Interrupted",
};

const REASON_TONE: Record<FinishReason, string> = {
  completed: "is-ok",
  stopped: "is-warn",
  escape: "is-bad",
  focusLost: "is-bad",
  error: "is-bad",
};

/** Runs already celebrated, so revisiting the tab does not replay the sweep. */
const celebratedRuns = new WeakSet<SessionSummary>();

/** Progress events pause during long thinking gaps; the clock should not. */
function useTickingElapsed(elapsedMs: number, phase: Phase): number {
  const [now, setNow] = useState(elapsedMs);
  const anchor = useRef({ elapsedMs, at: performance.now() });

  useEffect(() => {
    anchor.current = { elapsedMs, at: performance.now() };
    setNow(elapsedMs);
  }, [elapsedMs]);

  useEffect(() => {
    if (phase !== "typing") return;
    const timer = window.setInterval(() => {
      const { elapsedMs: base, at } = anchor.current;
      setNow(base + (performance.now() - at));
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  return now;
}

interface ReadoutProps {
  label: string;
  value: ReactNode;
  unit?: string;
  accent?: boolean;
}

function Readout({ label, value, unit, accent }: ReadoutProps) {
  return (
    <div className="readout">
      <span className="label">{label}</span>
      <span className={cn("readout-value", accent && "is-accent")}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
    </div>
  );
}

interface TransportProps {
  engine: LiveEngineState;
  lastRun: SessionSummary | null;
  typing: TypingSettings;
  counts: ScriptCounts;
  hotkeyStart: string;
  hotkeyPause: string;
  paletteKey: string;
  onStart: () => void;
  onStop: () => void;
  onPauseResume: () => void;
}

const Transport = memo(function Transport({
  engine,
  lastRun,
  typing,
  counts,
  hotkeyStart,
  hotkeyPause,
  paletteKey,
  onStart,
  onStop,
  onPauseResume,
}: TransportProps) {
  const { phase } = engine;
  const isIdle = phase === "idle";
  const isPaused = phase === "paused";
  const isCounting = phase === "countdown";
  const elapsed = useTickingElapsed(engine.elapsedMs, phase);

  const [flashRun, setFlashRun] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!lastRun || lastRun.reason !== "completed") return;
    if (celebratedRuns.has(lastRun)) return;
    celebratedRuns.add(lastRun);
    setFlashRun(lastRun);
  }, [lastRun]);

  const progress = !isIdle
    ? engine.total
      ? Math.min(1, engine.typed / engine.total)
      : 0
    : lastRun?.total
      ? Math.min(1, lastRun.typed / lastRun.total)
      : 0;
  const percent = Math.floor(progress * 100);

  let statusTone = "";
  let statusText = "Predicted cadence";
  if (isCounting) {
    statusTone = "is-live";
    statusText = "Armed · waiting for focus";
  } else if (isPaused) {
    statusTone = "is-warn";
    statusText = "Paused · holding position";
  } else if (phase === "typing") {
    statusTone = "is-live";
    statusText = "Recording live cadence";
  } else if (lastRun) {
    statusTone = REASON_TONE[lastRun.reason];
    statusText = `Last run · ${REASON_LABEL[lastRun.reason]}`;
  }

  return (
    <footer
      className="panel transport rise"
      style={{ "--i": 2, "--progress": progress } as CSSProperties}
      aria-label="Transport"
    >
      <div className={cn("transport-progress", isIdle && "is-idle")} aria-hidden="true">
        <div className="transport-progress-fill" />
      </div>
      {flashRun && flashRun === lastRun ? (
        <span className="transport-flash" aria-hidden="true" />
      ) : null}

      <div className="transport-main">
        <AnimatePresence mode="popLayout" initial={false}>
          {isIdle ? (
            <motion.div
              key="start"
              className="transport-swap"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.1 } }}
              transition={springSnappy}
            >
              <button type="button" className="start-btn" onClick={onStart}>
                <span className="start-btn-icon">
                  <Play size={15} fill="currentColor" strokeWidth={0} />
                </span>
                <span className="start-btn-copy">
                  <span className="start-btn-label">Start typing</span>
                  <span className="start-btn-sub">{typing.startDelaySecs}s head start</span>
                </span>
                <Keycap>{formatHotkey(hotkeyStart)}</Keycap>
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="running"
              className="transport-swap run-controls"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.1 } }}
              transition={springSnappy}
            >
              <button
                type="button"
                className={cn("run-btn", isPaused && "is-resume")}
                onClick={onPauseResume}
                disabled={isCounting}
                title={`${isPaused ? "Resume" : "Pause"} (${formatHotkey(hotkeyPause)})`}
              >
                {isPaused ? (
                  <Play size={15} fill="currentColor" strokeWidth={0} />
                ) : (
                  <Pause size={15} fill="currentColor" strokeWidth={0} />
                )}
                {isPaused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="run-btn is-stop"
                onClick={onStop}
                title={`Stop (${formatHotkey(hotkeyStart)})`}
              >
                <Square size={13} fill="currentColor" strokeWidth={0} />
                Stop
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="scope">
        <div className="scope-head">
          <span className={cn("scope-status", statusTone)} role="status">
            <span className={cn("led", `is-${phase}`)} />
            <span className="label">{statusText}</span>
          </span>
          <div className="scope-legend" aria-hidden="true">
            <span>
              <i /> key
            </span>
            <span>
              <i className="is-typo" /> typo
            </span>
            <span>
              <i className="is-pause" /> pause
            </span>
          </div>
        </div>
        <CadenceScope typing={typing} phase={phase} paletteKey={paletteKey} />
      </div>

      <div className="readouts">
        {!isIdle ? (
          <>
            <Readout label="Progress" value={percent} unit="%" accent />
            <Readout label="Elapsed" value={formatElapsed(elapsed)} />
            <Readout
              label="Remaining"
              value={
                isCounting || engine.etaSecs === null || !Number.isFinite(engine.etaSecs)
                  ? "—"
                  : formatDuration(engine.etaSecs)
              }
            />
          </>
        ) : lastRun ? (
          <>
            <Readout label="Avg speed" value={formatWpm(lastRun.wpm)} unit="wpm" accent />
            <Readout label="Time" value={formatElapsed(lastRun.elapsedMs)} />
            <Readout label="Delivered" value={percent} unit="%" />
          </>
        ) : (
          <>
            <Readout
              label="Target"
              value={<AnimatedNumber value={averageWpm(typing)} />}
              unit="wpm"
            />
            <Readout label="Length" value={formatNumber(counts.characters)} unit="ch" />
            <Readout
              label="Estimate"
              value={counts.seconds ? `~${formatDuration(counts.seconds)}` : "—"}
            />
          </>
        )}
      </div>
    </footer>
  );
});

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export const TypePage = memo(function TypePage({
  settings,
  text,
  engine,
  lastRun,
  paletteKey,
  onTextChange,
  onTypingChange,
  onStart,
  onStop,
  onPauseResume,
  onOpenSettings,
  notify,
}: TypePageProps) {
  const typing = settings.typing;
  // Counting a long script should never hold up a keystroke in the editor.
  const deferredText = useDeferredValue(text);
  const counts = useMemo<ScriptCounts>(
    () => ({
      characters: characterCount(deferredText),
      words: wordCount(deferredText),
      seconds: estimateDurationSeconds(deferredText, typing),
    }),
    [deferredText, typing],
  );

  return (
    <div className="type-page" id="panel-type" role="tabpanel" aria-label="Type">
      <Stage
        text={text}
        phase={engine.phase}
        typed={engine.typed}
        total={engine.total}
        counts={counts}
        hotkeyStart={settings.hotkeyStart}
        onTextChange={onTextChange}
        notify={notify}
      />
      <Deck
        typing={typing}
        phase={engine.phase}
        liveWpm={engine.wpm}
        onTypingChange={onTypingChange}
        onOpenSettings={onOpenSettings}
      />
      <Transport
        engine={engine}
        lastRun={lastRun}
        typing={typing}
        counts={counts}
        hotkeyStart={settings.hotkeyStart}
        hotkeyPause={settings.hotkeyPause}
        paletteKey={paletteKey}
        onStart={onStart}
        onStop={onStop}
        onPauseResume={onPauseResume}
      />
    </div>
  );
});
