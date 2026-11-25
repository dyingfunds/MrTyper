import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Braces,
  ClipboardPaste,
  Eraser,
  FileDown,
  FolderOpen,
  Pause,
  Play,
  Square,
} from "lucide-react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { CadenceScope } from "../components/CadenceScope";
import { CommandSuggest } from "../components/CommandSuggest";
import { LiveScript } from "../components/LiveScript";
import { ScriptHighlight } from "../components/ScriptHighlight";
import { Tachometer } from "../components/Tachometer";
import { AnimatedNumber } from "../components/ui/AnimatedNumber";
import { IconButton } from "../components/ui/Button";
import { Keycap } from "../components/ui/Keycap";
import { NumberField } from "../components/ui/NumberField";
import { RangeSlider, Slider } from "../components/ui/Slider";
import { caretBox } from "../lib/caret";
import { humanLabel, humanScore } from "../lib/cadence";
import { springSnappy } from "../lib/motion";
import { PLATFORM } from "../lib/platform";
import {
  COMMAND_GROUPS,
  findCommandTrigger,
  suggestCommands,
  typedText,
  type CommandSuggestion,
} from "../lib/scriptCommands";
import {
  averageWpm,
  characterCount,
  cn,
  estimateDurationSeconds,
  fitTempoToDuration,
  formatDuration,
  formatElapsed,
  formatHotkey,
  formatNumber,
  formatWpm,
  indexOfCodePoint,
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
  showScope: boolean;
  /** Where the next run starts, in code points; null is the top. */
  startAt: number | null;
  onStartAtChange: (startAt: number | null) => void;
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

/* ------------------------------------------------------------------ */
/*  Command menu                                                       */
/* ------------------------------------------------------------------ */

const IS_MAC = PLATFORM.id === "macos";

/** What the open-file picker offers: plain text, Markdown and Word. */
const SCRIPT_FILE_ACCEPT =
  ".txt,.text,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The {{…}} commands, offered from a button above the script. */
function CommandMenu({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="command-anchor" ref={anchorRef}>
      <IconButton
        label="Insert a formatting command"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        <Braces size={15} strokeWidth={1.8} />
      </IconButton>
      {open ? (
        <div className="command-menu" role="menu" aria-label="Insert a command">
          <p className="command-menu-note">
            Inserted at the cursor. MrTyper presses the Google Docs shortcut, or waits, instead of
            typing it.
          </p>
          {COMMAND_GROUPS.map((group) => (
            <div className="command-menu-group" key={group.label}>
              <span className="label">{group.label}</span>
              {group.compact ? (
                <div className="command-menu-chips">
                  {group.options.map((option) => (
                    <button
                      key={option.token}
                      type="button"
                      role="menuitem"
                      className="command-menu-chip"
                      title={`Insert {{${option.token}}}`}
                      onClick={() => {
                        onPick(option.token);
                        setOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {group.compact ? null : group.options.map((option) => {
                const keys = IS_MAC ? option.keys.mac : option.keys.other;
                return (
                  <button
                    key={option.token}
                    type="button"
                    role="menuitem"
                    className="command-menu-item"
                    onClick={() => {
                      onPick(option.token);
                      setOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    <code>{keys === "—" ? `{{${option.token}}}` : keys}</code>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage                                                              */
/* ------------------------------------------------------------------ */

interface StageProps {
  text: string;
  phase: Phase;
  typed: number;
  total: number;
  counts: ScriptCounts;
  scriptCommands: boolean;
  startAt: number | null;
  onStartAtChange: (startAt: number | null) => void;
  onTextChange: (text: string) => void;
  notify: Notify;
}

/**
 * After a run stops part way, the next one can carry on from where it got
 * to, from the cursor, or from the top.
 */
function StartPoint({
  text,
  startAt,
  onUseCursor,
  onShow,
  onClear,
}: {
  text: string;
  startAt: number;
  onUseCursor: () => void;
  onShow: () => void;
  onClear: () => void;
}) {
  const total = characterCount(text);
  const index = indexOfCodePoint(text, startAt);
  const preview = text.slice(index, index + 48).replace(/\s+/g, " ").trim();
  const percent = total ? Math.floor((startAt / total) * 100) : 0;
  return (
    <div className="start-point" role="status">
      <span className="start-point-copy">
        <span className="label">Next run starts at {percent}%</span>
        <button type="button" className="start-point-preview" onClick={onShow} title="Show in the script">
          {preview ? `“${preview}${index + 48 < text.length ? "…" : ""}”` : "the end of the script"}
        </button>
      </span>
      <span className="start-point-actions">
        <button
          type="button"
          className="start-point-btn"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onUseCursor}
          title="Click in the script first, then use this to start from there"
        >
          From cursor
        </button>
        <button type="button" className="start-point-btn" onClick={onClear}>
          From the top
        </button>
      </span>
    </div>
  );
}

const Stage = memo(function Stage({
  text,
  phase,
  typed,
  total,
  counts,
  scriptCommands,
  startAt,
  onStartAtChange,
  onTextChange,
  notify,
}: StageProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showHighlight = scriptCommands && text.includes("{{");

  // The highlight layer scrolls with the textarea it sits behind.
  const syncHighlight = useCallback(() => {
    const textarea = textareaRef.current;
    const layer = highlightRef.current;
    if (textarea && layer) layer.scrollTop = textarea.scrollTop;
  }, []);
  useLayoutEffect(syncHighlight, [syncHighlight, text, showHighlight]);
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

  /* Command suggestions while typing `/bo` or `{{bo` ------------------ */

  const stageBodyRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  /** A trigger the user closed with Esc stays closed until it changes. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [suggestBox, setSuggestBox] = useState<{ left: number; top: number; above: boolean } | null>(
    null,
  );

  const trigger = useMemo(
    () => (scriptCommands && isIdle && caret !== null ? findCommandTrigger(text, caret) : null),
    [caret, isIdle, scriptCommands, text],
  );
  const suggestions = useMemo(
    () => (trigger ? suggestCommands(trigger.query, IS_MAC) : []),
    [trigger],
  );
  const suggesting = Boolean(trigger) && suggestions.length > 0 && dismissedAt !== trigger?.start;
  const triggerStart = trigger?.start ?? null;
  const triggerQuery = trigger?.query ?? null;

  useEffect(() => {
    setActiveSuggestion(0);
  }, [triggerStart, triggerQuery]);

  useEffect(() => {
    if (dismissedAt !== null && dismissedAt !== triggerStart) setDismissedAt(null);
  }, [dismissedAt, triggerStart]);

  const placeSuggestions = useCallback(() => {
    const element = textareaRef.current;
    const body = stageBodyRef.current;
    if (!element || !body || triggerStart === null) {
      setSuggestBox(null);
      return;
    }
    const box = caretBox(element, triggerStart);
    const listWidth = 300;
    const listHeight = 300;
    const left = Math.max(8, Math.min(box.left, body.clientWidth - listWidth - 8));
    const below = box.top + box.height + 4;
    const above = below + listHeight > body.clientHeight && box.top > listHeight / 2;
    setSuggestBox({ left, top: above ? box.top - 4 : below, above });
  }, [triggerStart]);

  useLayoutEffect(() => {
    if (suggesting) placeSuggestions();
    else setSuggestBox(null);
  }, [placeSuggestions, suggesting]);

  const readCaret = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : null);
  }, []);

  const pickSuggestion = useCallback(
    (suggestion: CommandSuggestion) => {
      const element = textareaRef.current;
      if (!trigger || !element) return;
      let end = trigger.end;
      // Typing `{{bo}}` then picking: don't leave the old closing braces.
      if (trigger.form === "braces") {
        if (text.startsWith("}}", end)) end += 2;
        else if (text.startsWith("}", end)) end += 1;
      }
      const inserted = `{{${suggestion.token}}}`;
      onTextChange(`${text.slice(0, trigger.start)}${inserted}${text.slice(end)}`);
      const caretAfter = trigger.start + inserted.length;
      requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(caretAfter, caretAfter);
        setCaret(caretAfter);
      });
    },
    [onTextChange, text, trigger],
  );

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!suggesting || !trigger) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveSuggestion((current) => (current + step + suggestions.length) % suggestions.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      pickSuggestion(suggestions[Math.min(activeSuggestion, suggestions.length - 1)]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(trigger.start);
    }
  }

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
    await loadFile(file);
  }

  async function loadFile(file: File) {
    try {
      // The converter is only needed when a file is opened, so it loads then.
      const { readScriptFile } = await import("../lib/importScript");
      const imported = await readScriptFile(file, scriptCommands);
      if (!imported.text.trim()) {
        notify("warning", "Nothing to type in that file", `${file.name} has no text in it.`);
        return;
      }
      onTextChange(imported.text);
      const converted = imported.kind !== "text" && scriptCommands;
      notify(
        "success",
        "Script loaded",
        converted
          ? `${file.name} is on the stage, with its formatting turned into commands.`
          : `${file.name} is on the stage.`,
      );
    } catch (error) {
      notify(
        "warning",
        "Couldn't open that file",
        error instanceof Error ? error.message : "Try pasting its contents instead.",
      );
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
            label="Open a file (.txt, .md, .docx)"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isIdle}
          >
            <FolderOpen size={15} strokeWidth={1.8} />
          </IconButton>
          <input
            ref={fileInputRef}
            type="file"
            accept={SCRIPT_FILE_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void loadFile(file);
            }}
          />
          {scriptCommands ? (
            <CommandMenu
              disabled={!isIdle}
              onPick={(token) => insertAtCursor(`{{${token}}}`)}
            />
          ) : null}
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

      {isIdle && startAt !== null ? (
        <StartPoint
          text={text}
          startAt={startAt}
          onUseCursor={() => {
            const element = textareaRef.current;
            if (!element) return;
            const caret = element.selectionStart ?? 0;
            onStartAtChange(characterCount(text.slice(0, caret)));
          }}
          onShow={() => {
            const element = textareaRef.current;
            if (!element) return;
            const index = indexOfCodePoint(text, startAt);
            element.focus();
            element.setSelectionRange(index, index);
          }}
          onClear={() => onStartAtChange(null)}
        />
      ) : null}

      <div className="stage-body" ref={stageBodyRef}>
        {showHighlight && isIdle ? <ScriptHighlight ref={highlightRef} text={text} /> : null}
        <textarea
          ref={textareaRef}
          className="script-input"
          value={text}
          disabled={!isIdle}
          aria-label="Text to type"
          placeholder="Write or paste a script, or drop a .txt, .md or .docx file here."
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => {
            onTextChange(event.target.value);
            readCaret();
          }}
          onSelect={readCaret}
          onKeyDown={handleEditorKeyDown}
          onBlur={() => setCaret(null)}
          onScroll={() => {
            syncHighlight();
            if (suggesting) placeSuggestions();
          }}
        />

        {suggesting && suggestBox ? (
          <CommandSuggest
            suggestions={suggestions}
            active={Math.min(activeSuggestion, suggestions.length - 1)}
            left={suggestBox.left}
            top={suggestBox.top}
            above={suggestBox.above}
            onPick={pickSuggestion}
            onHover={setActiveSuggestion}
          />
        ) : null}

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
  hasScript: boolean;
  onTypingChange: (patch: Partial<TypingSettings>) => void;
  onFitTempo: (minutes: number) => void;
  onOpenSettings: () => void;
}

const Deck = memo(function Deck({
  typing,
  phase,
  liveWpm,
  hasScript,
  onTypingChange,
  onFitTempo,
  onOpenSettings,
}: DeckProps) {
  const [tempoDragging, setTempoDragging] = useState(false);
  const [fitMinutes, setFitMinutes] = useState(10);
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
            <NumberField
              className="tempo-bound-value"
              value={typing.minWpm}
              min={10}
              max={300}
              format={(value) => `${value}`}
              unit="wpm"
              ariaLabel="Minimum words per minute"
              disabled={!isIdle}
              onChange={(minWpm) =>
                onTypingChange({ minWpm, maxWpm: Math.max(minWpm, typing.maxWpm) })
              }
            />
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
            <NumberField
              className="tempo-bound-value"
              value={typing.maxWpm}
              min={10}
              max={300}
              format={(value) => `${value}`}
              unit="wpm"
              ariaLabel="Maximum words per minute"
              disabled={!isIdle}
              onChange={(maxWpm) =>
                onTypingChange({ maxWpm, minWpm: Math.min(maxWpm, typing.minWpm) })
              }
            />
            <span>Max</span>
          </div>
        </div>
        <div className="fit-row">
          <span className="control-name">
            Finish in
            <span className="control-hint">sets the tempo</span>
          </span>
          <NumberField
            className="control-value"
            value={fitMinutes}
            min={1}
            max={600}
            unit="min"
            format={(value) => `${value} min`}
            ariaLabel="Target length in minutes"
            disabled={!isIdle}
            onChange={setFitMinutes}
          />
          <button
            type="button"
            className="fit-btn"
            disabled={!isIdle || !hasScript}
            title={hasScript ? "Set the tempo so the script takes this long" : "Add a script first"}
            onClick={() => onFitTempo(fitMinutes)}
          >
            Fit
          </button>
        </div>
      </section>

      <section className="deck-section">
        <div className="control-row">
          <div className="control-top">
            <span className="control-name">
              Head start
              <span className="control-hint">before the first key</span>
            </span>
            <NumberField
              className="control-value"
              value={typing.startDelaySecs}
              min={1}
              max={30}
              unit="s"
              format={(value) => `${value}s`}
              ariaLabel="Start delay in seconds"
              disabled={!isIdle}
              onChange={(startDelaySecs) => onTypingChange({ startDelaySecs })}
            />
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
            <NumberField
              className="control-value"
              value={typing.randomness}
              min={0}
              max={100}
              unit="%"
              format={(value) => `${value}%`}
              ariaLabel="Keystroke randomness"
              disabled={!isIdle}
              onChange={(randomness) => onTypingChange({ randomness })}
            />
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
  /** Set when the next run carries on part way through the script. */
  startPercent: number | null;
  hotkeyStart: string;
  hotkeyPause: string;
  paletteKey: string;
  showScope: boolean;
  onStart: () => void;
  onStop: () => void;
  onPauseResume: () => void;
}

const Transport = memo(function Transport({
  engine,
  lastRun,
  typing,
  counts,
  startPercent,
  hotkeyStart,
  hotkeyPause,
  paletteKey,
  showScope,
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
  } else if (isPaused && engine.held) {
    statusTone = "is-warn";
    statusText = `Holding · press ${formatHotkey(hotkeyPause)} to carry on`;
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
                  <span className="start-btn-label">
                    {startPercent !== null ? "Carry on" : "Start typing"}
                  </span>
                  <span className="start-btn-sub">
                    {startPercent !== null
                      ? `from ${startPercent}%`
                      : `${typing.startDelaySecs}s head start`}
                  </span>
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

      <div className={cn("scope", !showScope && "is-hidden")}>
        <div className="scope-head">
          <span className={cn("scope-status", statusTone)} role="status">
            <span className={cn("led", `is-${phase}`)} />
            <span className="label">{statusText}</span>
          </span>
          <div className="scope-legend" aria-hidden="true" hidden={!showScope}>
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
        {showScope ? (
          <CadenceScope typing={typing} phase={phase} paletteKey={paletteKey} />
        ) : null}
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
  showScope,
  startAt,
  onStartAtChange,
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
  const scriptCommands = settings.scriptCommands;
  const counts = useMemo<ScriptCounts>(() => {
    // Commands aren't typed, so they don't count; pause commands add time.
    const typed = typedText(deferredText, scriptCommands);
    const seconds = estimateDurationSeconds(typed.text, typing);
    return {
      characters: characterCount(typed.text),
      words: wordCount(typed.text),
      seconds: seconds ? seconds + Math.round(typed.pauseMs / 1000) : 0,
    };
  }, [deferredText, scriptCommands, typing]);

  const handleFitTempo = useCallback(
    (minutes: number) => {
      const target = minutes * 60;
      const typed = typedText(text, scriptCommands);
      const result = fitTempoToDuration(typed.text, typed.pauseMs / 1000, typing, target);
      if (!result) {
        notify("info", "Nothing to time yet", "Add a script first, then fit the tempo to it.");
        return;
      }
      onTypingChange({ minWpm: result.minWpm, maxWpm: result.maxWpm });
      const range = `${result.minWpm}–${result.maxWpm} WPM`;
      const about = formatDuration(result.seconds);
      if (result.seconds > target * 1.1 + 15) {
        notify(
          "warning",
          "That's faster than MrTyper types",
          `Even at its top speed, ${range}, this script takes about ${about}.`,
        );
      } else if (result.seconds < target * 0.9 - 15) {
        notify(
          "warning",
          "That's slower than MrTyper types",
          `At its slowest, ${range}, this script takes about ${about}. Thinking pauses or {{pause}} commands can stretch it further.`,
        );
      } else {
        notify(
          "success",
          "Tempo set",
          `${range} finishes in about ${about}. Typos and bursts can shift it a little.`,
        );
      }
    },
    [notify, onTypingChange, scriptCommands, text, typing],
  );

  return (
    <div className="type-page" id="panel-type" role="tabpanel" aria-label="Type">
      <Stage
        text={text}
        phase={engine.phase}
        typed={engine.typed}
        total={engine.total}
        counts={counts}
        scriptCommands={scriptCommands}
        startAt={startAt}
        onStartAtChange={onStartAtChange}
        onTextChange={onTextChange}
        notify={notify}
      />
      <Deck
        typing={typing}
        phase={engine.phase}
        liveWpm={engine.wpm}
        hasScript={counts.characters > 0}
        onTypingChange={onTypingChange}
        onFitTempo={handleFitTempo}
        onOpenSettings={onOpenSettings}
      />
      <Transport
        engine={engine}
        lastRun={lastRun}
        typing={typing}
        counts={counts}
        startPercent={
          startAt !== null && engine.phase === "idle"
            ? Math.floor((startAt / Math.max(1, characterCount(text))) * 100)
            : null
        }
        hotkeyStart={settings.hotkeyStart}
        hotkeyPause={settings.hotkeyPause}
        paletteKey={paletteKey}
        showScope={showScope}
        onStart={onStart}
        onStop={onStop}
        onPauseResume={onPauseResume}
      />
    </div>
  );
});
