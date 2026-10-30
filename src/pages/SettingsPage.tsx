import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Command,
  Eye,
  Info,
  Keyboard,
  Lock,
  Monitor,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { GlassCard } from "../components/GlassCard";
import { Modal } from "../components/Modal";
import { GlassButton } from "../components/ui/Button";
import { HotkeyKeycaps, Keycap } from "../components/ui/Keycap";
import { Slider } from "../components/ui/Slider";
import { Toggle } from "../components/ui/Toggle";
import { springSoft } from "../lib/motion";
import {
  acceleratorFromKeyboardEvent,
  cn,
  formatHotkey,
  isEqualJson,
} from "../lib/utils";
import type {
  AppSettings,
  LiveEngineState,
  ThemeChoice,
  TypingSettings,
} from "../types";
import { DEFAULT_SETTINGS } from "../lib/defaults";

interface SettingsPageProps {
  settings: AppSettings;
  engine: LiveEngineState;
  onTypingChange: (patch: Partial<TypingSettings>) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onResetSettings: () => void;
  onEmergencyStop: () => void;
}

const themeOptions: Array<{
  id: ThemeChoice;
  label: string;
  icon: typeof Monitor;
}> = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

interface HotkeyRecorderProps {
  label: string;
  value: string;
  otherValue: string;
  onChange: (accelerator: string) => void;
}

function HotkeyRecorder({
  label,
  value,
  otherValue,
  onChange,
}: HotkeyRecorderProps) {
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!capturing) return;
    if (event.key === "Tab") {
      setCapturing(false);
      setHint(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setCapturing(false);
      setHint(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const accelerator = acceleratorFromKeyboardEvent(event);
    if (!accelerator) {
      if (!["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) {
        setHint("Use a function key or a modifier + key.");
      }
      return;
    }
    if (accelerator === otherValue) {
      setHint("That shortcut is already in use.");
      return;
    }
    onChange(accelerator);
    setCapturing(false);
    setHint(null);
  }

  return (
    <div className="hotkey-field">
      <span className="field-label">{label}</span>
      <button
        type="button"
        className={cn("hotkey-capture", capturing && "is-capturing")}
        onClick={() => {
          setCapturing(true);
          setHint(null);
        }}
        onBlur={() => {
          setCapturing(false);
          setHint(null);
        }}
        onKeyDown={handleKeyDown}
        aria-label={`${label}: ${formatHotkey(value)}. Click and press a new shortcut.`}
      >
        {capturing ? (
          <motion.span
            className="text-[9px] text-[var(--text-tertiary)]"
            animate={{ opacity: [0.42, 1, 0.42] }}
            transition={{ duration: 1.7, repeat: Infinity }}
          >
            Press a shortcut…
          </motion.span>
        ) : (
          <HotkeyKeycaps accelerator={value} />
        )}
      </button>
      <span className="hotkey-capture-hint">
        {hint ?? (capturing ? "Esc to cancel" : "Click to rebind")}
      </span>
    </div>
  );
}

interface BehaviorRowProps {
  title: string;
  description: string;
  enabled?: boolean;
  onToggle?: (value: boolean) => void;
  children?: React.ReactNode;
  first?: boolean;
}

function BehaviorRow({
  title,
  description,
  enabled,
  onToggle,
  children,
  first,
}: BehaviorRowProps) {
  const open = enabled === undefined || enabled;
  return (
    <div className={cn("behavior-row", first && "first")}>
      <div className="behavior-head">
        <div className="behavior-copy">
          <span className="behavior-name">{title}</span>
          <span className="behavior-description">{description}</span>
        </div>
        {onToggle !== undefined ? (
          <Toggle
            checked={Boolean(enabled)}
            onChange={onToggle}
            label={`${title} ${enabled ? "on" : "off"}`}
          />
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open && children ? (
          <motion.div
            className="behavior-control"
            initial={{ height: 0, opacity: 0, y: -4 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -4 }}
            transition={springSoft}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function BehaviorSlider({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="behavior-slider-row">
        <span>{label}</span>
        <span className="behavior-slider-value">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function SettingsPage({
  settings,
  engine,
  onTypingChange,
  onSettingsChange,
  onResetSettings,
  onEmergencyStop,
}: SettingsPageProps) {
  const typing = settings.typing;
  const reducedMotion = useReducedMotion();
  const [resetOpen, setResetOpen] = useState(false);
  const isDefault = isEqualJson(settings, DEFAULT_SETTINGS);
  const isRunning = engine.phase !== "idle";

  return (
    <div
      className="page"
      id="panel-settings"
      role="tabpanel"
      aria-label="Settings"
    >
      <div className="page-heading">
        <div className="page-heading-copy">
          <span className="eyebrow">Preferences</span>
          <h1 className="page-title">Shape it to your hand.</h1>
          <p className="page-subtitle">
            Every detail is local to this machine. Fine-tune the feel, choose
            your shortcuts, and keep the safety net exactly where you want it.
          </p>
        </div>
        <div className="heading-badges">
          <span className="stat-pill">
            <Sparkles size={11} strokeWidth={1.8} />
            {typing.minWpm}–{typing.maxWpm} WPM
          </span>
          <GlassButton
            icon={RotateCcw}
            onClick={() => setResetOpen(true)}
            disabled={isDefault}
          >
            Restore defaults
          </GlassButton>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-column">
          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Appearance</span>
                <h2 className="section-title">Look and feel.</h2>
              </div>
              <span className="editor-badge">LIVE</span>
            </div>

            <div className="settings-section">
              <div className="settings-section-heading">
                <span className="settings-label">Theme</span>
              </div>
              <div className="theme-switch" role="radiogroup" aria-label="Theme">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const active = settings.theme === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={cn("theme-option", active && "is-active")}
                      onClick={() => onSettingsChange({ theme: option.id })}
                    >
                      {active ? (
                        <motion.span
                          layoutId="theme-indicator"
                          className="theme-indicator"
                          transition={springSoft}
                        />
                      ) : null}
                      <Icon size={11} strokeWidth={1.8} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-section">
              <div className="setting-item">
                <div className="setting-item-copy">
                  <span className="setting-item-title">Always on top</span>
                  <span className="setting-item-description">
                    Keep MrTyper above your other windows while you work.
                  </span>
                </div>
                <Toggle
                  checked={settings.alwaysOnTop}
                  onChange={(checked) =>
                    onSettingsChange({ alwaysOnTop: checked })
                  }
                  label="Always on top"
                />
              </div>
            </div>

            <div className="about-footnote">
              <span className="inline-flex items-center gap-1.5">
                <Eye size={10} strokeWidth={1.8} />
                {reducedMotion ? "Reduce motion is on" : "Full motion is on"}
              </span>
              <span>Follows your system preference</span>
            </div>
          </GlassCard>

          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Shortcuts</span>
                <h2 className="section-title">Global controls.</h2>
              </div>
              <span className="stat-pill">
                <Command size={10} strokeWidth={1.8} />
                Anywhere
              </span>
            </div>

            <div className="hotkey-row mt-4">
              <HotkeyRecorder
                label="Start / stop"
                value={settings.hotkeyStart}
                otherValue={settings.hotkeyPause}
                onChange={(hotkeyStart) =>
                  onSettingsChange({ hotkeyStart })
                }
              />
              <HotkeyRecorder
                label="Pause / resume"
                value={settings.hotkeyPause}
                otherValue={settings.hotkeyStart}
                onChange={(hotkeyPause) =>
                  onSettingsChange({ hotkeyPause })
                }
              />
            </div>

            <div className="safety-banner mt-4">
              <span className="safety-banner-icon">
                <Keyboard size={13} strokeWidth={1.7} />
              </span>
              <div className="safety-banner-copy">
                <strong>They work while you are in another app.</strong>
                Use F-keys or a modifier combination. Escape is reserved for
                the emergency stop while typing.
              </div>
            </div>
          </GlassCard>

          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Safety</span>
                <h2 className="section-title">The kill switch.</h2>
              </div>
              <span className="stat-pill">
                <ShieldCheck size={10} strokeWidth={1.8} />
                Armed
              </span>
            </div>

            <div className="setting-list mt-4">
              <div className="setting-item">
                <div className="setting-item-copy">
                  <span className="setting-item-title">Escape stops instantly</span>
                  <span className="setting-item-description">
                    Registers Esc globally only while a session is running.
                  </span>
                </div>
                <Toggle
                  checked={settings.stopOnEsc}
                  onChange={(stopOnEsc) =>
                    onSettingsChange({ stopOnEsc })
                  }
                  label="Escape stops typing"
                />
              </div>
              <div className="setting-item">
                <div className="setting-item-copy">
                  <span className="setting-item-title">Stop when focus leaves</span>
                  <span className="setting-item-description">
                    Ends the run if you move to another window mid-session.
                  </span>
                </div>
                <Toggle
                  checked={settings.stopOnFocusLoss}
                  onChange={(stopOnFocusLoss) =>
                    onSettingsChange({ stopOnFocusLoss })
                  }
                  label="Stop when focus leaves target window"
                />
              </div>
            </div>

            <div className="safety-banner mt-3">
              <span className="safety-banner-icon">
                <AlertTriangle size={13} strokeWidth={1.7} />
              </span>
              <div className="safety-banner-copy">
                <strong>Emergency stop.</strong>
                Esc, F8, or the Stop button immediately cancels all queued
                keystrokes.
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isRunning ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springSoft}
                  style={{ overflow: "hidden" }}
                >
                  <GlassButton
                    variant="danger"
                    icon={Zap}
                    className="mt-3 w-full"
                    onClick={onEmergencyStop}
                  >
                    Stop the current session
                  </GlassButton>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </GlassCard>

          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">About</span>
                <h2 className="section-title">Small, private, precise.</h2>
              </div>
              <span className="editor-badge">V1.0</span>
            </div>
            <div className="setting-list mt-4">
              <div className="setting-item">
                <div className="setting-item-copy">
                  <span className="setting-item-title">MrTyper for Windows</span>
                  <span className="setting-item-description">
                    Tauri 2 · SendInput Unicode · no cloud, no accounts.
                  </span>
                </div>
                <Lock size={12} strokeWidth={1.7} className="faint" />
              </div>
              <div className="setting-item">
                <div className="setting-item-copy">
                  <span className="setting-item-title">Configuration</span>
                  <span className="setting-item-description">
                    Saved to a single JSON file in your local app config folder.
                  </span>
                </div>
                <Info size={12} strokeWidth={1.7} className="faint" />
              </div>
            </div>
            <div className="about-footnote">
              <span>Made for words that need a little patience.</span>
              <span className="inline-flex items-center gap-1">
                <Check size={9} strokeWidth={2} /> Local-first
              </span>
            </div>
          </GlassCard>
        </div>

        <div className="settings-column">
          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Human realism</span>
                <h2 className="section-title">The art of not quite perfect.</h2>
              </div>
              <span className="stat-pill">
                <span className="headline-dot" />
                Engine details
              </span>
            </div>

            <div className="mt-4">
              <BehaviorRow
                first
                title="Keystroke randomness"
                description="How widely individual key delays wander from the average."
              >
                <BehaviorSlider
                  label="Variance"
                  value={`${typing.randomness}%`}
                >
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={typing.randomness}
                    onChange={(randomness) =>
                      onTypingChange({ randomness })
                    }
                    ariaLabel="Keystroke randomness"
                  />
                </BehaviorSlider>
              </BehaviorRow>

              <BehaviorRow
                title="Punctuation pauses"
                description="A breath after terminal marks, a shorter beat after commas."
                enabled={typing.punctuationEnabled}
                onToggle={(punctuationEnabled) =>
                  onTypingChange({ punctuationEnabled })
                }
              >
                <BehaviorSlider
                  label="Pause intensity"
                  value={`${typing.punctuationFactor.toFixed(1)}×`}
                >
                  <Slider
                    min={1}
                    max={4}
                    step={0.1}
                    value={typing.punctuationFactor}
                    onChange={(punctuationFactor) =>
                      onTypingChange({ punctuationFactor })
                    }
                    ariaLabel="Punctuation pause intensity"
                    formatValue={(value) => `${value.toFixed(1)} times`}
                  />
                </BehaviorSlider>
              </BehaviorRow>

              <BehaviorRow
                title="Line-break pauses"
                description="A longer, human beat when the script changes line."
                enabled={typing.lineBreakEnabled}
                onToggle={(lineBreakEnabled) =>
                  onTypingChange({ lineBreakEnabled })
                }
              >
                <BehaviorSlider
                  label="Extra pause"
                  value={`${typing.lineBreakExtraMs} ms`}
                >
                  <Slider
                    min={80}
                    max={1500}
                    step={20}
                    value={typing.lineBreakExtraMs}
                    onChange={(lineBreakExtraMs) =>
                      onTypingChange({ lineBreakExtraMs })
                    }
                    ariaLabel="Line break pause in milliseconds"
                    formatValue={(value) => `${value} milliseconds`}
                  />
                </BehaviorSlider>
              </BehaviorRow>

              <BehaviorRow
                title="Thinking pauses"
                description="Occasional low-frequency breaks, as if gathering a thought."
                enabled={typing.thinkingEnabled}
                onToggle={(thinkingEnabled) =>
                  onTypingChange({ thinkingEnabled })
                }
              >
                <div className="behavior-grid">
                  <BehaviorSlider
                    label="Every"
                    value={`${typing.thinkingEveryChars} chars`}
                  >
                    <Slider
                      min={20}
                      max={400}
                      step={5}
                      value={typing.thinkingEveryChars}
                      onChange={(thinkingEveryChars) =>
                        onTypingChange({ thinkingEveryChars })
                      }
                      ariaLabel="Thinking pause frequency in characters"
                    />
                  </BehaviorSlider>
                  <BehaviorSlider
                    label="Up to"
                    value={`${(typing.thinkingPauseMaxMs / 1000).toFixed(1)}s`}
                  >
                    <Slider
                      min={300}
                      max={5000}
                      step={100}
                      value={typing.thinkingPauseMaxMs}
                      onChange={(thinkingPauseMaxMs) =>
                        onTypingChange({ thinkingPauseMaxMs })
                      }
                      ariaLabel="Maximum thinking pause duration"
                      formatValue={(value) => `${(value / 1000).toFixed(1)} seconds`}
                    />
                  </BehaviorSlider>
                </div>
              </BehaviorRow>

              <BehaviorRow
                title="Burst typing"
                description="Brief surges of momentum that settle back into the rhythm."
                enabled={typing.burstEnabled}
                onToggle={(burstEnabled) =>
                  onTypingChange({ burstEnabled })
                }
              >
                <BehaviorSlider
                  label="Surge intensity"
                  value={`${typing.burstIntensity}%`}
                >
                  <Slider
                    min={10}
                    max={100}
                    step={1}
                    value={typing.burstIntensity}
                    onChange={(burstIntensity) =>
                      onTypingChange({ burstIntensity })
                    }
                    ariaLabel="Burst typing intensity"
                  />
                </BehaviorSlider>
              </BehaviorRow>

              <BehaviorRow
                title="Typo simulation"
                description="A nearby QWERTY key, a short beat, a backspace, and the correction."
                enabled={typing.typosEnabled}
                onToggle={(typosEnabled) =>
                  onTypingChange({ typosEnabled })
                }
              >
                <BehaviorSlider
                  label="Chance per character"
                  value={`${typing.typoChance.toFixed(1)}%`}
                >
                  <Slider
                    min={0.5}
                    max={15}
                    step={0.5}
                    value={typing.typoChance}
                    onChange={(typoChance) =>
                      onTypingChange({ typoChance })
                    }
                    ariaLabel="Typo chance"
                    formatValue={(value) => `${value.toFixed(1)} percent`}
                  />
                </BehaviorSlider>
                <p className="control-caption mt-1.5">
                  Only letters with a neighbouring key on a US QWERTY layout can
                  produce a typo.
                </p>
              </BehaviorRow>

              <BehaviorRow
                title="Fatigue drift"
                description="Let the pace tire gently as a long script unfolds."
                enabled={typing.fatigueEnabled}
                onToggle={(fatigueEnabled) =>
                  onTypingChange({ fatigueEnabled })
                }
              >
                <BehaviorSlider
                  label="Slow-down across the script"
                  value={`+${typing.fatigueDrift}%`}
                >
                  <Slider
                    min={0}
                    max={40}
                    step={1}
                    value={typing.fatigueDrift}
                    onChange={(fatigueDrift) =>
                      onTypingChange({ fatigueDrift })
                    }
                    ariaLabel="Fatigue drift percentage"
                  />
                </BehaviorSlider>
              </BehaviorRow>
            </div>
          </GlassCard>

          <GlassCard className="card-pad">
            <div className="card-heading-row">
              <div className="card-heading-copy">
                <span className="card-heading-kicker">Now in effect</span>
                <h2 className="section-title">A quick read.</h2>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {[
                `${typing.minWpm}–${typing.maxWpm} WPM`,
                `${typing.randomness}% randomness`,
                typing.punctuationEnabled
                  ? `${typing.punctuationFactor.toFixed(1)}× punctuation`
                  : "flat punctuation",
                typing.thinkingEnabled
                  ? `think every ${typing.thinkingEveryChars}`
                  : "no thinking pauses",
                typing.typosEnabled
                  ? `${typing.typoChance.toFixed(1)}% typos`
                  : "zero typos",
                typing.fatigueEnabled
                  ? `+${typing.fatigueDrift}% fatigue`
                  : "no fatigue",
              ].map((label) => (
                <span className="preset-trait" key={label}>
                  {label}
                </span>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Start from a clean slate?"
        description="This restores every preference to its default — theme, shortcuts, safety, and all human-realism settings. Your saved presets and script are untouched."
      >
        <div className="safety-banner mt-4">
          <span className="safety-banner-icon">
            <Keycap>F8</Keycap>
          </span>
          <div className="safety-banner-copy">
            <strong>Current shortcuts</strong>
            {formatHotkey(settings.hotkeyStart)} to start or stop,{" "}
            {formatHotkey(settings.hotkeyPause)} to pause.
          </div>
        </div>
        <div className="modal-actions">
          <GlassButton onClick={() => setResetOpen(false)}>Cancel</GlassButton>
          <GlassButton
            variant="confirm"
            onClick={() => {
              onResetSettings();
              setResetOpen(false);
            }}
          >
            Restore defaults
          </GlassButton>
        </div>
      </Modal>
    </div>
  );
}
