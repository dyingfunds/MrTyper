import { AnimatePresence, motion as m } from "framer-motion";
import {
  AlertTriangle,
  Globe,
  Info,
  Leaf,
  Monitor,
  Moon,
  OctagonX,
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
import { Slider } from "../components/ui/Slider";
import { Toggle } from "../components/ui/Toggle";
import { DEFAULT_SETTINGS } from "../lib/defaults";
import { springSnappy, springSoft } from "../lib/motion";
import { PLATFORM } from "../lib/platform";
import { ACCENTS, type Accent, type MotionPref } from "../lib/uiPrefs";
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
  systemReducesMotion: boolean;
  onAccentChange: (accent: Accent) => void;
  onMotionChange: (motion: MotionPref) => void;
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

function EngineFader({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="engine-fader">
      <span className="engine-fader-label">{label}</span>
      {children}
      <span className="engine-fader-value">{value}</span>
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
  systemReducesMotion,
  onAccentChange,
  onMotionChange,
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
    typing.thinkingEnabled ? `think every ${typing.thinkingEveryChars}` : "no thinking pauses",
    typing.burstEnabled ? `${typing.burstIntensity}% bursts` : "no bursts",
    typing.typosEnabled ? `${typing.typoChance.toFixed(1)}% typos` : "zero typos",
    typing.fatigueEnabled ? `+${typing.fatigueDrift}% fatigue` : "no fatigue",
  ];

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
                  ? "Your desktop asks for reduced motion, so motion is reduced. Pick Full to animate anyway."
                  : "Following your desktop: animations are on."
                : motion === "full"
                  ? "Every transition plays, whatever your desktop says."
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
          <div className="setting-note">
            <Info size={15} strokeWidth={1.9} />
            <span>
              <strong>X11 sessions get system-wide shortcuts.</strong> On Wayland,
              desktops only deliver them while an X11 (XWayland) app has focus,
              so use the Stop button, or click back into MrTyper, which stops a
              running session instantly.
            </span>
          </div>
        </Section>

        <Section
          index={3}
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
          index={4}
          title="Humanize engine"
          description="The art of not quite perfect. Each layer adds a different kind of human texture."
        >
          <EngineRow
            title="Keystroke randomness"
            description="How far each key wanders from the average pace."
          >
            <EngineFader label="Variance" value={`${typing.randomness}%`}>
              <Slider
                min={0}
                max={100}
                step={1}
                value={typing.randomness}
                onChange={(randomness) => onTypingChange({ randomness })}
                ariaLabel="Keystroke randomness"
                formatValue={(value) => `${value} percent`}
              />
            </EngineFader>
          </EngineRow>

          <EngineRow
            title="Punctuation pauses"
            description="A breath after full stops, a shorter beat after commas."
            enabled={typing.punctuationEnabled}
            onToggle={(punctuationEnabled) => onTypingChange({ punctuationEnabled })}
          >
            <EngineFader label="Intensity" value={`${typing.punctuationFactor.toFixed(1)}×`}>
              <Slider
                min={1}
                max={4}
                step={0.1}
                value={typing.punctuationFactor}
                onChange={(punctuationFactor) => onTypingChange({ punctuationFactor })}
                ariaLabel="Punctuation pause intensity"
                formatValue={(value) => `${value.toFixed(1)} times`}
                disabled={!typing.punctuationEnabled}
              />
            </EngineFader>
          </EngineRow>

          <EngineRow
            title="Line-break pauses"
            description="A longer beat whenever the script starts a new line."
            enabled={typing.lineBreakEnabled}
            onToggle={(lineBreakEnabled) => onTypingChange({ lineBreakEnabled })}
          >
            <EngineFader label="Extra" value={`${typing.lineBreakExtraMs} ms`}>
              <Slider
                min={80}
                max={1500}
                step={20}
                value={typing.lineBreakExtraMs}
                onChange={(lineBreakExtraMs) => onTypingChange({ lineBreakExtraMs })}
                ariaLabel="Line break pause in milliseconds"
                formatValue={(value) => `${value} milliseconds`}
                disabled={!typing.lineBreakEnabled}
              />
            </EngineFader>
          </EngineRow>

          <EngineRow
            title="Thinking pauses"
            description="Occasional longer breaks, as if gathering a thought."
            enabled={typing.thinkingEnabled}
            onToggle={(thinkingEnabled) => onTypingChange({ thinkingEnabled })}
          >
            <EngineFader label="Every" value={`${typing.thinkingEveryChars} ch`}>
              <Slider
                min={20}
                max={400}
                step={5}
                value={typing.thinkingEveryChars}
                onChange={(thinkingEveryChars) => onTypingChange({ thinkingEveryChars })}
                ariaLabel="Thinking pause frequency in characters"
                formatValue={(value) => `every ${value} characters`}
                disabled={!typing.thinkingEnabled}
              />
            </EngineFader>
            <EngineFader
              label="Up to"
              value={`${(typing.thinkingPauseMaxMs / 1000).toFixed(1)} s`}
            >
              <Slider
                min={300}
                max={5000}
                step={100}
                value={typing.thinkingPauseMaxMs}
                onChange={(thinkingPauseMaxMs) => onTypingChange({ thinkingPauseMaxMs })}
                ariaLabel="Maximum thinking pause duration"
                formatValue={(value) => `${(value / 1000).toFixed(1)} seconds`}
                disabled={!typing.thinkingEnabled}
              />
            </EngineFader>
          </EngineRow>

          <EngineRow
            title="Burst typing"
            description="Short surges of momentum that settle back into rhythm."
            enabled={typing.burstEnabled}
            onToggle={(burstEnabled) => onTypingChange({ burstEnabled })}
          >
            <EngineFader label="Surge" value={`${typing.burstIntensity}%`}>
              <Slider
                min={10}
                max={100}
                step={1}
                value={typing.burstIntensity}
                onChange={(burstIntensity) => onTypingChange({ burstIntensity })}
                ariaLabel="Burst typing intensity"
                formatValue={(value) => `${value} percent`}
                disabled={!typing.burstEnabled}
              />
            </EngineFader>
          </EngineRow>

          <EngineRow
            title="Typo simulation"
            description="A neighbouring QWERTY key, a beat, a backspace, then the fix."
            enabled={typing.typosEnabled}
            onToggle={(typosEnabled) => onTypingChange({ typosEnabled })}
          >
            <EngineFader label="Chance" value={`${typing.typoChance.toFixed(1)}%`}>
              <Slider
                min={0.5}
                max={15}
                step={0.5}
                value={typing.typoChance}
                onChange={(typoChance) => onTypingChange({ typoChance })}
                ariaLabel="Typo chance per character"
                formatValue={(value) => `${value.toFixed(1)} percent`}
                disabled={!typing.typosEnabled}
              />
            </EngineFader>
          </EngineRow>

          <EngineRow
            title="Fatigue drift"
            description="Let the pace tire gently as a long script unfolds."
            enabled={typing.fatigueEnabled}
            onToggle={(fatigueEnabled) => onTypingChange({ fatigueEnabled })}
          >
            <EngineFader label="Slow-down" value={`+${typing.fatigueDrift}%`}>
              <Slider
                min={0}
                max={40}
                step={1}
                value={typing.fatigueDrift}
                onChange={(fatigueDrift) => onTypingChange({ fatigueDrift })}
                ariaLabel="Fatigue drift percentage"
                formatValue={(value) => `${value} percent`}
                disabled={!typing.fatigueEnabled}
              />
            </EngineFader>
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
          index={5}
          title="About"
          description="Small, private, precise."
          badge={<span className="tag num">v2.0.0</span>}
        >
          <Row
            title={PLATFORM.productLabel}
            description="Tauri 2 with a native Rust engine. Keys are sent as real Unicode input."
          />
          <Row
            title="Local only"
            description="No accounts, no analytics, no network calls. Settings live in a single JSON file in your app config folder."
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
