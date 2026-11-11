import { AnimatePresence, motion as m } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Globe,
  Info,
  Leaf,
  Monitor,
  Moon,
  OctagonX,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react";
import {
  memo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui/Button";
import { HotkeyKeycaps } from "../components/ui/Keycap";
import { NumberField } from "../components/ui/NumberField";
import { Slider } from "../components/ui/Slider";
import { Toggle } from "../components/ui/Toggle";
import { DEFAULT_SETTINGS } from "../lib/defaults";
import { springSnappy, springSoft } from "../lib/motion";
import { PLATFORM, type PlatformNote } from "../lib/platform";
import { COMMAND_GROUPS } from "../lib/scriptCommands";
import {
  ACCENTS,
  EDITOR_SIZE_MAX,
  EDITOR_SIZE_MIN,
  type Accent,
  type EditorFont,
  type MotionPref,
  type UiPrefs,
} from "../lib/uiPrefs";
import { updateDescription, updateTitle, type UpdateState } from "../lib/updates";
import {
  acceleratorFromKeyboardEvent,
  cn,
  formatHotkey,
  isEqualJson,
} from "../lib/utils";
import type { AppSettings, ThemeChoice, TypingSettings } from "../types";

interface SettingsPageProps {
  settings: AppSettings;
  running: boolean;
  accent: Accent;
  motion: MotionPref;
  editorFont: EditorFont;
  editorSize: number;
  showScope: boolean;
  systemReducesMotion: boolean;
  update: UpdateState;
  onAccentChange: (accent: Accent) => void;
  onMotionChange: (motion: MotionPref) => void;
  onUiPrefsChange: (patch: Partial<UiPrefs>) => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onTypingChange: (patch: Partial<TypingSettings>) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onResetSettings: () => void;
  onEmergencyStop: () => void;
}

const themeOptions: Array<{ id: ThemeChoice; label: string; icon: typeof Monitor }> = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

const motionOptions: Array<{ id: MotionPref; label: string; icon: typeof Monitor }> = [
  { id: "system", label: "System", icon: Monitor },
  { id: "full", label: "Full", icon: Zap },
  { id: "reduced", label: "Reduced", icon: Leaf },
];

const editorFontOptions: Array<{ id: EditorFont; label: string }> = [
  { id: "mono", label: "Mono" },
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
];

type TypoKindKey = "typoNeighbor" | "typoSwap" | "typoDouble" | "typoSkip";

const TYPO_KINDS: Array<{ key: TypoKindKey; label: string; hint: string }> = [
  { key: "typoNeighbor", label: "Wrong key", hint: "A neighbouring key: thw for the" },
  { key: "typoSwap", label: "Swapped", hint: "Two letters swapped: teh for the" },
  { key: "typoDouble", label: "Doubled", hint: "A letter pressed twice: thhe for the" },
  { key: "typoSkip", label: "Skipped", hint: "A letter left out: te for the" },
];

/** Swatches show each accent as it appears in the dark theme. */
const ACCENT_SWATCH: Record<Accent, string> = {
  volt: "#c8ff2e",
  ember: "#ff6a2a",
  ice: "#4fe3ff",
  orchid: "#ff62d0",
};

/* ------------------------------------------------------------------ */
/*  Building blocks                                                    */
/* ------------------------------------------------------------------ */

function Section({
  index,
  title,
  description,
  badge,
  children,
}: {
  index: number;
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section rise" style={{ "--i": index } as CSSProperties}>
      <div className="settings-aside">
        <h2>{title}</h2>
        <p>{description}</p>
        {badge}
      </div>
      <div className="settings-body">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-title">{title}</span>
        {description ? <span className="setting-desc">{description}</span> : null}
      </div>
      {children}
    </div>
  );
}

function EngineRow({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  enabled?: boolean;
  onToggle?: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("engine-row", enabled === false && "is-off")}>
      <div className="setting-copy">
        <span className="setting-title">{title}</span>
        <span className="setting-desc">{description}</span>
      </div>
      <div className="engine-controls">{children}</div>
      <div className="engine-toggle">
        {onToggle ? (
          <Toggle
            checked={Boolean(enabled)}
            onChange={onToggle}
            label={`${title} ${enabled ? "on" : "off"}`}
          />
        ) : null}
      </div>
    </div>
  );
}

interface ValueFaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Decimal places the value keeps. */
  decimals?: number;
  /** Unit shown while typing a value. */
  unit?: string;
  format: (value: number) => string;
  /** The value read aloud by screen readers. */
  spoken: (value: number) => string;
  toInput?: (value: number) => number;
  fromInput?: (input: number) => number;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** A labelled fader whose value can be dragged, or clicked and typed. */
function ValueFader({
  label,
  value,
  min,
  max,
  step,
  decimals = 0,
  unit,
  format,
  spoken,
  toInput,
  fromInput,
  ariaLabel,
  disabled,
  onChange,
}: ValueFaderProps) {
  return (
    <div className="engine-fader">
      <span className="engine-fader-label">{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        formatValue={spoken}
        disabled={disabled}
      />
      <NumberField
        className="engine-fader-value"
        value={value}
        min={min}
        max={max}
        decimals={decimals}
        unit={unit}
        format={format}
        toInput={toInput}
        fromInput={fromInput}
        ariaLabel={ariaLabel}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function PlatformNoteRow({ note }: { note: PlatformNote }) {
  return (
    <div className="setting-note">
      <Info size={15} strokeWidth={1.9} />
      <span>
        <strong>{note.title}</strong> {note.body}
      </span>
    </div>
  );
}

function HotkeyRecorder({
  label,
  value,
  otherValue,
  onChange,
}: {
  label: string;
  value: string;
  otherValue: string;
  onChange: (accelerator: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stop() {
    setCapturing(false);
    setError(null);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!capturing) return;
    if (event.key === "Tab") {
      stop();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stop();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const accelerator = acceleratorFromKeyboardEvent(event);
    if (!accelerator) {
      if (!["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) {
        setError("Use an F-key, or a modifier plus a key.");
      }
      return;
    }
    if (accelerator === otherValue) {
      setError("That shortcut is already taken.");
      return;
    }
    onChange(accelerator);
    stop();
  }

  return (
    <Row
      title={label}
      description={
        <span className={cn("hotkey-hint", error && "is-error")}>
          {error ?? (capturing ? "Press the new shortcut. Esc cancels." : "Click the key to rebind.")}
        </span>
      }
    >
      <button
        type="button"
        className={cn("hotkey-capture", capturing && "is-capturing")}
        onClick={() => {
          setCapturing(true);
          setError(null);
        }}
        onBlur={stop}
        onKeyDown={handleKeyDown}
        aria-label={`${label}: ${formatHotkey(value)}. Activate, then press a new shortcut.`}
      >
        {capturing ? (
          <span className="hotkey-capture-prompt">Listening…</span>
        ) : (
          <HotkeyKeycaps accelerator={value} />
        )}
      </button>
    </Row>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export const SettingsPage = memo(function SettingsPage({
  settings,
  running,
  accent,
  motion,
  editorFont,
  editorSize,
  showScope,
  systemReducesMotion,
  update,
  onAccentChange,
  onMotionChange,
  onUiPrefsChange,
  onCheckUpdates,
  onInstallUpdate,
  onTypingChange,
  onSettingsChange,
  onResetSettings,
  onEmergencyStop,
}: SettingsPageProps) {
  const typing = settings.typing;
  const [resetOpen, setResetOpen] = useState(false);
  const isDefault = isEqualJson(settings, DEFAULT_SETTINGS);

  const summary = [
    `${typing.minWpm}–${typing.maxWpm} wpm`,
    `${typing.randomness}% randomness`,
    typing.punctuationEnabled
      ? `${typing.punctuationFactor.toFixed(1)}× punctuation`
      : "flat punctuation",
    typing.lineBreakEnabled ? `+${typing.lineBreakExtraMs} ms line breaks` : "no line pauses",
    typing.paragraphEnabled
      ? `+${(typing.paragraphExtraMs / 1000).toFixed(1)} s paragraphs`
      : "no paragraph pauses",
    typing.wordPauseEnabled ? `+${typing.wordPauseMs} ms word gaps` : null,
    typing.capitalEnabled ? `+${typing.capitalExtraMs} ms capitals` : null,
    typing.thinkingEnabled ? `think every ${typing.thinkingEveryChars}` : "no thinking pauses",
    typing.burstEnabled ? `${typing.burstIntensity}% bursts` : "no bursts",
    typing.typosEnabled ? `${typing.typoChance.toFixed(1)}% typos` : "zero typos",
    typing.typosEnabled && typing.lateNoticeChance > 0
      ? `${typing.lateNoticeChance}% noticed late`
      : null,
    typing.warmupEnabled ? `warm-up over ${typing.warmupChars}` : null,
    typing.fatigueEnabled ? `+${typing.fatigueDrift}% fatigue` : "no fatigue",
  ].filter((label): label is string => label !== null);

  return (
    <div className="page-scroll" id="panel-settings" role="tabpanel" aria-label="Settings">
      <div className="page-inner">
        <header className="page-head rise">
          <div>
            <span className="page-kicker label">Setup</span>
            <h1 className="page-title">Shape it to your hand.</h1>
            <p className="page-sub">
              Everything here stays on this machine. Tune the engine, pick your
              shortcuts, and keep the safety net exactly where you want it.
            </p>
          </div>
          <div className="page-head-actions">
            <Button icon={RotateCcw} onClick={() => setResetOpen(true)} disabled={isDefault}>
              Restore defaults
            </Button>
          </div>
        </header>

        <Section
          index={1}
          title="Appearance"
          description="How the instrument looks. Changes apply instantly."
        >
          <Row title="Theme" description={`Follow ${PLATFORM.osName}, or pin one.`}>
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const active = settings.theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cn("segmented-option", active && "is-active")}
                    onClick={() => onSettingsChange({ theme: option.id })}
                  >
                    {active ? (
                      <m.span
                        layoutId="theme-pill"
                        className="segmented-pill"
                        transition={springSnappy}
                      />
                    ) : null}
                    <Icon size={14} strokeWidth={1.9} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </Row>
          <Row
            title="Motion"
            description={
              motion === "system"
                ? systemReducesMotion
                  ? PLATFORM.motion.systemReduced
                  : PLATFORM.motion.systemFull
                : motion === "full"
                  ? PLATFORM.motion.forcedFull
                  : "Movement is kept to simple fades."
            }
          >
            <div className="segmented" role="radiogroup" aria-label="Motion">
              {motionOptions.map((option) => {
                const Icon = option.icon;
                const active = motion === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cn("segmented-option", active && "is-active")}
                    onClick={() => onMotionChange(option.id)}
                  >
                    {active ? (
                      <m.span
                        layoutId="motion-pill"
                        className="segmented-pill"
                        transition={springSnappy}
                      />
                    ) : null}
                    <Icon size={14} strokeWidth={1.9} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </Row>
          <Row title="Accent" description="The one loud colour.">
            <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={accent === option.id}
                  aria-label={option.label}
                  title={option.label}
                  className="accent-swatch"
                  style={{ "--swatch": ACCENT_SWATCH[option.id] } as CSSProperties}
                  onClick={() => onAccentChange(option.id)}
                />
              ))}
            </div>
          </Row>
          <Row title="Script font" description="The typeface of the script editor.">
            <div className="segmented" role="radiogroup" aria-label="Script font">
              {editorFontOptions.map((option) => {
                const active = editorFont === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cn("segmented-option", active && "is-active")}
                    onClick={() => onUiPrefsChange({ editorFont: option.id })}
                  >
                    {active ? (
                      <m.span
                        layoutId="editor-font-pill"
                        className="segmented-pill"
                        transition={springSnappy}
                      />
                    ) : null}
                    <span className={`font-sample is-${option.id}`}>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </Row>
          <Row title="Script text size" description="How large the script reads on the stage.">
            <div className="row-fader">
              <Slider
                min={EDITOR_SIZE_MIN}
                max={EDITOR_SIZE_MAX}
                step={0.5}
                value={editorSize}
                onChange={(next) => onUiPrefsChange({ editorSize: next })}
                ariaLabel="Script text size"
                formatValue={(value) => `${value} pixels`}
              />
              <NumberField
                className="engine-fader-value"
                value={editorSize}
                min={EDITOR_SIZE_MIN}
                max={EDITOR_SIZE_MAX}
                decimals={1}
                unit="px"
                format={(value) => `${value} px`}
                ariaLabel="Script text size"
                onChange={(next) => onUiPrefsChange({ editorSize: next })}
              />
            </div>
          </Row>
          <Row
            title="Cadence scope"
            description="The live rhythm graph in the transport bar. Hide it for a calmer screen."
          >
            <Toggle
              checked={showScope}
              onChange={(next) => onUiPrefsChange({ showScope: next })}
              label="Show the cadence scope"
            />
          </Row>
          <Row
            title="Always on top"
            description="Keep MrTyper above your other windows while you work."
          >
            <Toggle
              checked={settings.alwaysOnTop}
              onChange={(alwaysOnTop) => onSettingsChange({ alwaysOnTop })}
              label="Always on top"
            />
          </Row>
        </Section>

        <Section
          index={2}
          title="Shortcuts"
          description="Global keys that work while MrTyper is in the background."
          badge={
            <span className="tag">
              <Globe size={11} strokeWidth={2} />
              System-wide
            </span>
          }
        >
          <HotkeyRecorder
            label="Start / stop"
            value={settings.hotkeyStart}
            otherValue={settings.hotkeyPause}
            onChange={(hotkeyStart) => onSettingsChange({ hotkeyStart })}
          />
          <HotkeyRecorder
            label="Pause / resume"
            value={settings.hotkeyPause}
            otherValue={settings.hotkeyStart}
            onChange={(hotkeyPause) => onSettingsChange({ hotkeyPause })}
          />
          {PLATFORM.shortcutsNote ? <PlatformNoteRow note={PLATFORM.shortcutsNote} /> : null}
        </Section>

        <Section
          index={3}
          title="Script commands"
          description="Formatting and pauses from inside your script, made for Google Docs."
          badge={<span className="tag">Google Docs</span>}
        >
          <Row
            title="Run {{…}} commands"
            description="Write {{bold}}, {{h1}} or {{pause 2}} in a script and MrTyper presses the shortcut or waits instead of typing it. Turn this off to type double braces as written."
          >
            <Toggle
              checked={settings.scriptCommands}
              onChange={(scriptCommands) => onSettingsChange({ scriptCommands })}
              label="Run script commands"
            />
          </Row>
          <div className={cn("command-sheet", !settings.scriptCommands && "is-off")}>
            {COMMAND_GROUPS.map((group) => (
              <div className="command-sheet-group" key={group.label}>
                <span className="label">{group.label}</span>
                <ul>
                  {group.options.map((option) => (
                    <li key={option.token}>
                      <code>{`{{${option.token}}}`}</code>
                      <span>{option.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="setting-note">
            <Info size={15} strokeWidth={1.9} />
            <span>
              <strong>Toggles work like the keyboard.</strong> {"{{bold}}"} turns bold on, and the
              next {"{{bold}}"} turns it off. Any shortcut works too:{" "}
              {"{{ctrl+shift+k}}"}, {"{{mod+b}}"} (mod is {PLATFORM.id === "macos" ? "⌘" : "Ctrl"}),{" "}
              {"{{enter}}"}, {"{{tab}}"}, {"{{left}}"}. Braces that aren't a command are typed as written.
              Insert commands from the {"{ }"} button above the script.
            </span>
          </div>
        </Section>

        <Section
          index={4}
          title="Safety"
          description="Ways to stop a session the instant something looks wrong."
          badge={
            <span className="tag tag-accent">
              <ShieldCheck size={11} strokeWidth={2} />
              Armed
            </span>
          }
        >
          <Row
            title="Escape stops instantly"
            description="Esc is registered system-wide only while a session is running."
          >
            <Toggle
              checked={settings.stopOnEsc}
              onChange={(stopOnEsc) => onSettingsChange({ stopOnEsc })}
              label="Escape stops typing"
            />
          </Row>
          <Row
            title="Stop when focus leaves"
            description="End the run if another window takes focus mid-session."
          >
            <Toggle
              checked={settings.stopOnFocusLoss}
              onChange={(stopOnFocusLoss) => onSettingsChange({ stopOnFocusLoss })}
              label="Stop when focus leaves target window"
            />
          </Row>
          {PLATFORM.permissionNote ? <PlatformNoteRow note={PLATFORM.permissionNote} /> : null}
          <div className="setting-note is-warn">
            <AlertTriangle size={15} strokeWidth={1.9} />
            <span>
              <strong>Emergency stop.</strong> Esc, {formatHotkey(settings.hotkeyStart)},
              or the Stop button cancels every queued keystroke immediately.
            </span>
          </div>
          <AnimatePresence initial={false}>
            {running ? (
              <m.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springSoft}
                style={{ overflow: "hidden" }}
              >
                <div className="setting-row" style={{ borderTop: "1px solid var(--line)" }}>
                  <div className="setting-copy">
                    <span className="setting-title">A session is running</span>
                    <span className="setting-desc">Kill it from here without switching tabs.</span>
                  </div>
                  <Button variant="danger-solid" icon={OctagonX} onClick={onEmergencyStop}>
                    Stop now
                  </Button>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </Section>

        <Section
          index={5}
          title="Humanize engine"
          description="The art of not quite perfect. Each layer adds a different kind of human texture. Click any value to type it."
        >
          <EngineRow
            title="Keystroke randomness"
            description="How far each key wanders from the average pace."
          >
            <ValueFader
              label="Variance"
              value={typing.randomness}
              min={0}
              max={100}
              step={1}
              unit="%"
              format={(value) => `${value}%`}
              spoken={(value) => `${value} percent`}
              ariaLabel="Keystroke randomness"
              onChange={(randomness) => onTypingChange({ randomness })}
            />
          </EngineRow>

          <EngineRow
            title="Punctuation pauses"
            description="A breath after full stops, a shorter beat after commas."
            enabled={typing.punctuationEnabled}
            onToggle={(punctuationEnabled) => onTypingChange({ punctuationEnabled })}
          >
            <ValueFader
              label="Intensity"
              value={typing.punctuationFactor}
              min={1}
              max={4}
              step={0.1}
              decimals={1}
              unit="×"
              format={(value) => `${value.toFixed(1)}×`}
              spoken={(value) => `${value.toFixed(1)} times`}
              ariaLabel="Punctuation pause intensity"
              disabled={!typing.punctuationEnabled}
              onChange={(punctuationFactor) => onTypingChange({ punctuationFactor })}
            />
          </EngineRow>

          <EngineRow
            title="Line-break pauses"
            description="A longer beat whenever the script starts a new line."
            enabled={typing.lineBreakEnabled}
            onToggle={(lineBreakEnabled) => onTypingChange({ lineBreakEnabled })}
          >
            <ValueFader
              label="Extra"
              value={typing.lineBreakExtraMs}
              min={80}
              max={1500}
              step={20}
              unit="ms"
              format={(value) => `${value} ms`}
              spoken={(value) => `${value} milliseconds`}
              ariaLabel="Line break pause in milliseconds"
              disabled={!typing.lineBreakEnabled}
              onChange={(lineBreakExtraMs) => onTypingChange({ lineBreakExtraMs })}
            />
          </EngineRow>

          <EngineRow
            title="Paragraph pauses"
            description="A longer breath at a blank line, as if starting a new thought."
            enabled={typing.paragraphEnabled}
            onToggle={(paragraphEnabled) => onTypingChange({ paragraphEnabled })}
          >
            <ValueFader
              label="Extra"
              value={typing.paragraphExtraMs}
              min={100}
              max={6000}
              step={50}
              unit="s"
              decimals={0}
              toInput={(value) => value / 1000}
              fromInput={(value) => value * 1000}
              format={(value) => `${(value / 1000).toFixed(1)} s`}
              spoken={(value) => `${(value / 1000).toFixed(1)} seconds`}
              ariaLabel="Paragraph pause"
              disabled={!typing.paragraphEnabled}
              onChange={(paragraphExtraMs) => onTypingChange({ paragraphExtraMs })}
            />
          </EngineRow>

          <EngineRow
            title="Word gaps"
            description="A small beat after each space, between words."
            enabled={typing.wordPauseEnabled}
            onToggle={(wordPauseEnabled) => onTypingChange({ wordPauseEnabled })}
          >
            <ValueFader
              label="Gap"
              value={typing.wordPauseMs}
              min={5}
              max={500}
              step={5}
              unit="ms"
              format={(value) => `${value} ms`}
              spoken={(value) => `${value} milliseconds`}
              ariaLabel="Pause between words"
              disabled={!typing.wordPauseEnabled}
              onChange={(wordPauseMs) => onTypingChange({ wordPauseMs })}
            />
          </EngineRow>

          <EngineRow
            title="Capital letters"
            description="Extra time to reach for Shift before a capital."
            enabled={typing.capitalEnabled}
            onToggle={(capitalEnabled) => onTypingChange({ capitalEnabled })}
          >
            <ValueFader
              label="Reach"
              value={typing.capitalExtraMs}
              min={5}
              max={400}
              step={5}
              unit="ms"
              format={(value) => `+${value} ms`}
              spoken={(value) => `${value} milliseconds`}
              ariaLabel="Extra time before a capital letter"
              disabled={!typing.capitalEnabled}
              onChange={(capitalExtraMs) => onTypingChange({ capitalExtraMs })}
            />
          </EngineRow>

          <EngineRow
            title="Thinking pauses"
            description="Occasional longer breaks, as if gathering a thought."
            enabled={typing.thinkingEnabled}
            onToggle={(thinkingEnabled) => onTypingChange({ thinkingEnabled })}
          >
            <ValueFader
              label="Every"
              value={typing.thinkingEveryChars}
              min={20}
              max={400}
              step={5}
              unit="ch"
              format={(value) => `${value} ch`}
              spoken={(value) => `every ${value} characters`}
              ariaLabel="Thinking pause frequency in characters"
              disabled={!typing.thinkingEnabled}
              onChange={(thinkingEveryChars) => onTypingChange({ thinkingEveryChars })}
            />
            <ValueFader
              label="Up to"
              value={typing.thinkingPauseMaxMs}
              min={300}
              max={5000}
              step={100}
              unit="s"
              toInput={(value) => value / 1000}
              fromInput={(value) => value * 1000}
              format={(value) => `${(value / 1000).toFixed(1)} s`}
              spoken={(value) => `${(value / 1000).toFixed(1)} seconds`}
              ariaLabel="Maximum thinking pause duration"
              disabled={!typing.thinkingEnabled}
              onChange={(thinkingPauseMaxMs) => onTypingChange({ thinkingPauseMaxMs })}
            />
          </EngineRow>

          <EngineRow
            title="Burst typing"
            description="Short surges of momentum that settle back into rhythm."
            enabled={typing.burstEnabled}
            onToggle={(burstEnabled) => onTypingChange({ burstEnabled })}
          >
            <ValueFader
              label="Surge"
              value={typing.burstIntensity}
              min={10}
              max={100}
              step={1}
              unit="%"
              format={(value) => `${value}%`}
              spoken={(value) => `${value} percent`}
              ariaLabel="Burst typing intensity"
              disabled={!typing.burstEnabled}
              onChange={(burstIntensity) => onTypingChange({ burstIntensity })}
            />
          </EngineRow>

          <EngineRow
            title="Warm-up"
            description="Start a little slow and settle into full speed."
            enabled={typing.warmupEnabled}
            onToggle={(warmupEnabled) => onTypingChange({ warmupEnabled })}
          >
            <ValueFader
              label="Over"
              value={typing.warmupChars}
              min={20}
              max={1000}
              step={10}
              unit="ch"
              format={(value) => `${value} ch`}
              spoken={(value) => `over ${value} characters`}
              ariaLabel="Warm-up length in characters"
              disabled={!typing.warmupEnabled}
              onChange={(warmupChars) => onTypingChange({ warmupChars })}
            />
          </EngineRow>

          <EngineRow
            title="Typo simulation"
            description="A slip, a beat, then backspaces and the fix. Pick which slips can happen."
            enabled={typing.typosEnabled}
            onToggle={(typosEnabled) => onTypingChange({ typosEnabled })}
          >
            <ValueFader
              label="Chance"
              value={typing.typoChance}
              min={0.5}
              max={15}
              step={0.5}
              decimals={1}
              unit="%"
              format={(value) => `${value.toFixed(1)}%`}
              spoken={(value) => `${value.toFixed(1)} percent`}
              ariaLabel="Typo chance per character"
              disabled={!typing.typosEnabled}
              onChange={(typoChance) => onTypingChange({ typoChance })}
            />
            <div className="engine-fader">
              <span className="engine-fader-label">Kinds</span>
              <div className="chip-row" role="group" aria-label="Kinds of typo">
                {TYPO_KINDS.map((kind) => {
                  const on = typing[kind.key];
                  const onlyOne = on && TYPO_KINDS.filter((other) => typing[other.key]).length === 1;
                  return (
                    <button
                      key={kind.key}
                      type="button"
                      className={cn("chip", on && "is-on")}
                      aria-pressed={on}
                      title={onlyOne ? "At least one kind stays on" : kind.hint}
                      disabled={!typing.typosEnabled}
                      onClick={() => {
                        if (!onlyOne) onTypingChange({ [kind.key]: !on });
                      }}
                    >
                      {kind.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ValueFader
              label="Late"
              value={typing.lateNoticeChance}
              min={0}
              max={60}
              step={1}
              unit="%"
              format={(value) => `${value}%`}
              spoken={(value) => `${value} percent of typos noticed a few keys late`}
              ariaLabel="Typos noticed late"
              disabled={!typing.typosEnabled}
              onChange={(lateNoticeChance) => onTypingChange({ lateNoticeChance })}
            />
            <ValueFader
              label="Notice"
              value={typing.typoReactionMs}
              min={40}
              max={1500}
              step={10}
              unit="ms"
              format={(value) => `${value} ms`}
              spoken={(value) => `${value} milliseconds before fixing`}
              ariaLabel="Pause before fixing a typo"
              disabled={!typing.typosEnabled}
              onChange={(typoReactionMs) => onTypingChange({ typoReactionMs })}
            />
            <ValueFader
              label="Backspace"
              value={typing.backspaceMs}
              min={30}
              max={400}
              step={5}
              unit="ms"
              format={(value) => `${value} ms`}
              spoken={(value) => `${value} milliseconds per backspace`}
              ariaLabel="Time per backspace"
              disabled={!typing.typosEnabled}
              onChange={(backspaceMs) => onTypingChange({ backspaceMs })}
            />
          </EngineRow>

          <EngineRow
            title="Fatigue drift"
            description="Let the pace tire gently as a long script unfolds."
            enabled={typing.fatigueEnabled}
            onToggle={(fatigueEnabled) => onTypingChange({ fatigueEnabled })}
          >
            <ValueFader
              label="Slow-down"
              value={typing.fatigueDrift}
              min={0}
              max={40}
              step={1}
              unit="%"
              format={(value) => `+${value}%`}
              spoken={(value) => `${value} percent`}
              ariaLabel="Fatigue drift percentage"
              disabled={!typing.fatigueEnabled}
              onChange={(fatigueDrift) => onTypingChange({ fatigueDrift })}
            />
          </EngineRow>

          <div className="summary-tags" style={{ borderTop: "1px solid var(--line)" }}>
            {summary.map((label) => (
              <span className="tag" key={label}>
                {label}
              </span>
            ))}
          </div>
        </Section>

        <Section
          index={6}
          title="Updates"
          description="New versions come from the MrTyper releases on GitHub."
          badge={<span className="tag num">v{__APP_VERSION__}</span>}
        >
          <Row title="Check when MrTyper opens" description="Asks GitHub for the latest version. Nothing is installed until you say so.">
            <Toggle
              checked={settings.checkUpdates}
              onChange={(checkUpdates) => onSettingsChange({ checkUpdates })}
              label="Check for updates when MrTyper opens"
            />
          </Row>
          <Row title={updateTitle(update)} description={updateDescription(update)}>
            {update.status === "available" ? (
              <Button variant="primary" icon={Download} onClick={onInstallUpdate}>
                {update.canInstall ? `Update to ${update.version}` : "Open download page"}
              </Button>
            ) : (
              <Button
                icon={RefreshCw}
                onClick={onCheckUpdates}
                disabled={
                  update.status === "checking" ||
                  update.status === "downloading" ||
                  update.status === "installed" ||
                  update.status === "unsupported"
                }
              >
                {update.status === "checking" ? "Checking…" : "Check now"}
              </Button>
            )}
          </Row>
        </Section>

        <Section
          index={7}
          title="About"
          description="Small, private, precise."
        >
          <Row
            title={PLATFORM.productLabel}
            description="Tauri 2 with a native Rust engine. Keys are sent as real Unicode input."
          />
          <Row
            title="Private"
            description="No accounts and no analytics. The update check is the only network request, and you can turn it off above. Settings live in a single JSON file in your app config folder."
          />
        </Section>

        <div className="about-line">
          <span>Made for words that need a little patience.</span>
          <span className="num">Ctrl+1 · Ctrl+2 · Ctrl+3 switch tabs</span>
        </div>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Restore every default?"
        description="Theme, shortcuts, safety, and all humanize settings go back to factory values. Saved presets and your script are untouched."
      >
        <div className="modal-actions">
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            icon={RotateCcw}
            onClick={() => {
              onResetSettings();
              setResetOpen(false);
            }}
          >
            Restore defaults
          </Button>
        </div>
      </Modal>
    </div>
  );
});
