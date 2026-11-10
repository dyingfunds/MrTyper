import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CountdownOverlay } from "./components/CountdownOverlay";
import { Logo } from "./components/Logo";
import { Rail, TAB_ORDER } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { ToastHost } from "./components/ToastHost";
import {
  bootstrap,
  deletePreset,
  emergencyStop,
  friendlyError,
  getEngineStatus,
  hideWindow,
  isTauri,
  isWindowMaximized,
  minimizeWindow,
  onBackendEvent,
  onWindowGeometryChange,
  onWindowMaximizeChange,
  pauseTyping,
  readWindowBounds,
  renamePreset,
  resumeTyping,
  saveLastText,
  savePreset,
  saveSettings,
  saveWindowBounds,
  setAlwaysOnTop,
  setBackdropTheme,
  showWindow,
  startTyping,
  stopTyping,
  toggleMaximizeWindow,
} from "./lib/bridge";
import {
  DEFAULT_SETTINGS,
  makeDefaultPresets,
  normalizeSettings,
} from "./lib/defaults";
import { liveBus } from "./lib/liveBus";
import { pageEnter, pageExit, springSoft } from "./lib/motion";
import {
  REDUCED_MOTION_QUERY,
  applyAccent,
  applyReducedMotion,
  loadUiPrefs,
  saveUiPrefs,
  shouldReduceMotion,
  type Accent,
  type MotionPref,
  type UiPrefs,
} from "./lib/uiPrefs";
import { characterCount, formatWpm } from "./lib/utils";
import { PresetsPage } from "./pages/PresetsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TypePage } from "./pages/TypePage";
import type {
  AppSettings,
  BackendEvents,
  FinishReason,
  LiveEngineState,
  Preset,
  ProgressPayload,
  ResolvedTheme,
  SessionSummary,
  TabId,
  ToastMessage,
  ToastPayload,
  TypingSettings,
} from "./types";

const EMPTY_ENGINE: LiveEngineState = {
  phase: "idle",
  countdown: null,
  typed: 0,
  total: 0,
  wpm: 0,
  etaSecs: null,
  elapsedMs: 0,
  runId: null,
};

type Notify = (
  kind: ToastPayload["kind"],
  title: string,
  message: string,
) => void;

const FINISH_TITLES: Record<FinishReason, string> = {
  completed: "Delivered",
  stopped: "Session stopped",
  escape: "Emergency stop",
  focusLost: "Focus left the target",
  error: "Typing interrupted",
};

const TOAST_TITLES: Record<ToastPayload["kind"], string> = {
  info: "Heads up",
  success: "Done",
  warning: "A small snag",
  error: "Something went wrong",
};

const BOOT_WORD = "MrTyper";

/** Pages slide along the rail's axis, in the direction you travelled. */
const pageVariants = {
  enter: (direction: number) => ({ opacity: 0, y: direction * 20 }),
  center: { opacity: 1, y: 0, transition: pageEnter },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction * -12,
    transition: pageExit,
  }),
};

function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [text, setText] = useState("");
  const [tab, setTabState] = useState<TabId>("type");
  const [direction, setDirection] = useState(1);
  const [engine, setEngine] = useState<LiveEngineState>(EMPTY_ENGINE);
  const [lastRun, setLastRun] = useState<SessionSummary | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [maximized, setMaximized] = useState(false);
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(loadUiPrefs);
  const [systemReducesMotion, setSystemReducesMotion] = useState(
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const skipSettingsSave = useRef(true);
  const skipTextSave = useRef(true);
  const activeRunId = useRef<number | null>(null);
  const toastId = useRef(0);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const lastToast = useRef<{ signature: string; time: number } | null>(null);
  const pendingProgress = useRef<ProgressPayload | null>(null);
  const progressFrame = useRef(0);
  const enginePhaseRef = useRef(engine.phase);
  const settingsRef = useRef(settings);
  const textRef = useRef(text);
  const tabRef = useRef(tab);

  enginePhaseRef.current = engine.phase;
  settingsRef.current = settings;
  textRef.current = text;
  tabRef.current = tab;

  const resolvedTheme: ResolvedTheme =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  const { accent, motion: motionPref } = uiPrefs;
  const reduceMotion = shouldReduceMotion(motionPref, systemReducesMotion);
  const paletteKey = `${resolvedTheme}:${accent}`;

  const setTab = useCallback((next: TabId) => {
    const from = TAB_ORDER.indexOf(tabRef.current);
    const to = TAB_ORDER.indexOf(next);
    if (from === to) return;
    setDirection(to > from ? 1 : -1);
    setTabState(next);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Toasts                                                            */
  /* ---------------------------------------------------------------- */

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>((kind, title, message) => {
    const signature = `${kind}:${title}:${message}`;
    const now = Date.now();
    if (
      lastToast.current &&
      lastToast.current.signature === signature &&
      now - lastToast.current.time < 1400
    ) {
      return;
    }
    lastToast.current = { signature, time: now };
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, kind, title, message }]);
    const timer = setTimeout(() => {
      toastTimers.current.delete(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4800);
    toastTimers.current.set(id, timer);
  }, []);

  const notifyBackendToast = useCallback(
    (payload: ToastPayload) => {
      notify(payload.kind, payload.title ?? TOAST_TITLES[payload.kind], payload.message);
    },
    [notify],
  );

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await bootstrap();
        if (cancelled) return;
        setSettings(normalizeSettings(snapshot.settings));
        setPresets(snapshot.presets);
        setText(snapshot.lastText);
        try {
          const status = await getEngineStatus();
          if (!cancelled && status.phase !== "idle") {
            activeRunId.current = status.runId;
            setEngine({
              phase: status.phase,
              countdown: status.countdown,
              typed: status.typed,
              total: status.total,
              wpm: status.wpm,
              etaSecs: status.etaSecs,
              elapsedMs: status.elapsedMs,
              runId: status.runId,
            });
          }
        } catch {
          // A status read is optional; live events will populate the UI.
        }
        if (!cancelled) setReady(true);
      } catch (error) {
        if (cancelled) return;
        setSettings(DEFAULT_SETTINGS);
        setPresets(makeDefaultPresets());
        setReady(true);
        notify("error", "Couldn't load preferences", friendlyError(error));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      void showWindow();
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  /* ---------------------------------------------------------------- */
  /* Native event stream                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    function dropPendingProgress() {
      pendingProgress.current = null;
      if (progressFrame.current) {
        cancelAnimationFrame(progressFrame.current);
        progressFrame.current = 0;
      }
    }

    // Progress can arrive faster than the display refreshes. Keep only the
    // newest sample and commit it once per frame; a hidden window commits none.
    function flushProgress() {
      progressFrame.current = 0;
      const payload = pendingProgress.current;
      pendingProgress.current = null;
      if (!payload) return;
      setEngine((current) => {
        if (current.runId !== null && current.runId !== payload.runId) return current;
        return {
          ...current,
          runId: payload.runId,
          typed: payload.typed,
          total: payload.total,
          wpm: payload.wpm,
          etaSecs: payload.etaSecs,
          elapsedMs: payload.elapsedMs,
        };
      });
    }

    const handlers: {
      [K in keyof BackendEvents]: (payload: BackendEvents[K]) => void;
    } = {
      "typing-phase": (payload) => {
        if (payload.phase === "idle") {
          activeRunId.current = null;
          dropPendingProgress();
          setEngine((current) =>
            current.phase === "idle"
              ? current
              : { ...current, phase: "idle", countdown: null },
          );
          return;
        }
        // A run can also begin from the global hotkey or the tray, so a new
        // run id always resets the readouts instead of being ignored.
        if (activeRunId.current !== payload.runId) {
          activeRunId.current = payload.runId;
          dropPendingProgress();
          setLastRun(null);
        }
        setEngine((current) => {
          if (current.runId !== null && payload.runId < current.runId) return current;
          const base = current.runId === payload.runId ? current : EMPTY_ENGINE;
          return {
            ...base,
            phase: payload.phase,
            countdown: payload.countdown,
            runId: payload.runId,
            total: payload.total,
          };
        });
      },
      "typing-progress": (payload) => {
        if (activeRunId.current !== null && activeRunId.current !== payload.runId) return;
        pendingProgress.current = payload;
        if (!progressFrame.current) {
          progressFrame.current = requestAnimationFrame(flushProgress);
        }
      },
      "typing-keystroke": (payload) => {
        if (activeRunId.current !== null && activeRunId.current !== payload.runId) return;
        // Deliberately not React state: see lib/liveBus.
        liveBus.emit(payload.kind);
      },
      "typing-finished": (payload) => {
        if (activeRunId.current !== null && activeRunId.current !== payload.runId) {
          return;
        }
        activeRunId.current = null;
        dropPendingProgress();
        setLastRun({
          reason: payload.reason,
          typed: payload.typed,
          total: payload.total,
          elapsedMs: payload.elapsedMs,
          wpm: payload.wpm,
          message: payload.message,
        });
        setEngine((current) => ({
          ...current,
          phase: "idle",
          countdown: null,
          runId: payload.runId,
          typed: payload.typed,
          total: payload.total,
          wpm: payload.wpm,
          elapsedMs: payload.elapsedMs,
          etaSecs: 0,
        }));

        switch (payload.reason) {
          case "completed":
            notify(
              "success",
              FINISH_TITLES.completed,
              `${payload.typed.toLocaleString()} characters delivered${
                payload.wpm > 0 ? ` at ${formatWpm(payload.wpm)} WPM` : ""
              }.`,
            );
            break;
          case "escape":
            notify("warning", FINISH_TITLES.escape, "All keystrokes were killed instantly.");
            break;
          case "focusLost":
            notify(
              "warning",
              FINISH_TITLES.focusLost,
              "MrTyper stopped because another window took focus.",
            );
            break;
          case "stopped":
            notify(
              payload.typed > 0 ? "info" : "warning",
              FINISH_TITLES.stopped,
              payload.typed > 0
                ? `${payload.typed.toLocaleString()} characters were delivered.`
                : "No keystrokes were sent.",
            );
            break;
          default:
            notify(
              "error",
              FINISH_TITLES.error,
              payload.message ?? "MrTyper stopped before finishing.",
            );
        }
      },
      "mrtyper-toast": notifyBackendToast,
    };

    async function subscribe() {
      try {
        const unsubscribers = await Promise.all(
          (Object.keys(handlers) as Array<keyof BackendEvents>).map((event) =>
            onBackendEvent(event, handlers[event] as never),
          ),
        );
        if (cancelled) {
          unsubscribers.forEach((unsubscribe) => unsubscribe());
        } else {
          unlisteners.push(...unsubscribers);
        }
      } catch (error) {
        notify("error", "Live updates unavailable", friendlyError(error));
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      dropPendingProgress();
      unlisteners.forEach((unsubscribe) => unsubscribe());
    };
  }, [notify, notifyBackendToast]);

  /* ---------------------------------------------------------------- */
  /* Persistence & appearance                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    if (skipSettingsSave.current) {
      skipSettingsSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void saveSettings(settings).catch((error) => {
        notify("error", "Preferences weren't saved", friendlyError(error));
      });
    }, 550);
    return () => clearTimeout(timer);
  }, [notify, ready, settings]);

  useEffect(() => {
    if (!ready) return;
    if (skipTextSave.current) {
      skipTextSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void saveLastText(text).catch(() => {
        // The script is also saved when a session starts; a transient write
        // error here should not interrupt the writer's flow.
      });
    }, 550);
    return () => clearTimeout(timer);
  }, [ready, text]);

  // Layout effects, so children that read computed colours (the canvas scope)
  // always see the new palette in their own effects.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useLayoutEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useLayoutEffect(() => {
    applyReducedMotion(reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    saveUiPrefs(uiPrefs);
  }, [uiPrefs]);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setSystemReducesMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    meta?.setAttribute("content", resolvedTheme === "dark" ? "#08090a" : "#e4e3dc");
    void setBackdropTheme(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    if (!ready) return;
    void setAlwaysOnTop(settings.alwaysOnTop).catch(() => {
      notify(
        "warning",
        "Couldn't change always-on-top",
        "Windows did not accept the window setting.",
      );
    });
  }, [notify, ready, settings.alwaysOnTop]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Freeze decorative animation while the window is hidden in the tray.
  useEffect(() => {
    const update = () =>
      document.documentElement.classList.toggle("is-backgrounded", document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let cleanupGeometry: (() => void) | undefined;
    let cleanupMaximize: (() => void) | undefined;

    void (async () => {
      try {
        const [maximizedNow, cleanupGeometryFn, cleanupMaximizeFn] = await Promise.all([
          isWindowMaximized(),
          onWindowGeometryChange(() => {
            void (async () => {
              try {
                if (await isWindowMaximized()) return;
                const bounds = await readWindowBounds();
                if (bounds) await saveWindowBounds(bounds);
              } catch {
                // Window geometry is best-effort persistence.
              }
            })();
          }),
          onWindowMaximizeChange(setMaximized),
        ]);
        if (disposed) {
          cleanupGeometryFn();
          cleanupMaximizeFn();
          return;
        }
        setMaximized(maximizedNow);
        cleanupGeometry = cleanupGeometryFn;
        cleanupMaximize = cleanupMaximizeFn;
      } catch {
        // Browser previews and unsupported window managers simply skip this.
      }
    })();

    return () => {
      disposed = true;
      cleanupGeometry?.();
      cleanupMaximize?.();
    };
  }, [ready]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleStart = useCallback(async () => {
    if (enginePhaseRef.current !== "idle") return;
    const script = textRef.current;
    if (!script.trim()) {
      notify(
        "warning",
        "Nothing to type yet",
        "Paste a script or write a few words first.",
      );
      return;
    }

    setLastRun(null);
    setEngine({
      ...EMPTY_ENGINE,
      phase: "countdown",
      countdown: settingsRef.current.typing.startDelaySecs,
      total: characterCount(script),
    });

    try {
      await startTyping({ text: script, settings: settingsRef.current });
    } catch (error) {
      setEngine((current) =>
        current.phase === "countdown" && current.runId === null ? EMPTY_ENGINE : current,
      );
      notify("error", "Couldn't start typing", friendlyError(error));
    }
  }, [notify]);

  const handleStop = useCallback(async () => {
    try {
      await stopTyping();
    } catch (error) {
      notify("error", "Couldn't stop typing", friendlyError(error));
    }
  }, [notify]);

  const handleEmergencyStop = useCallback(async () => {
    try {
      await emergencyStop();
    } catch (error) {
      notify("error", "Couldn't stop typing", friendlyError(error));
    }
  }, [notify]);

  const handlePauseResume = useCallback(async () => {
    try {
      if (enginePhaseRef.current === "paused") {
        await resumeTyping();
      } else if (enginePhaseRef.current === "typing") {
        await pauseTyping();
      }
    } catch (error) {
      notify("error", "Pause toggle failed", friendlyError(error));
    }
  }, [notify]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!settingsRef.current.stopOnEsc) return;
        if (enginePhaseRef.current === "idle") return;
        event.preventDefault();
        void emergencyStop().catch(() => undefined);
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        const index = ["1", "2", "3"].indexOf(event.key);
        if (index !== -1) {
          event.preventDefault();
          setTab(TAB_ORDER[index]);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setTab]);

  const updateTyping = useCallback((patch: Partial<TypingSettings>) => {
    setSettings((current) => ({
      ...current,
      typing: { ...current.typing, ...patch },
    }));
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const handleAccentChange = useCallback((next: Accent) => {
    setUiPrefs((current) => ({ ...current, accent: next }));
  }, []);

  const handleMotionChange = useCallback((next: MotionPref) => {
    setUiPrefs((current) => ({ ...current, motion: next }));
  }, []);

  const handleToggleTheme = useCallback(() => {
    const dark = document.documentElement.dataset.theme !== "light";
    setSettings((current) => ({ ...current, theme: dark ? "light" : "dark" }));
  }, []);

  const handleResetSettings = useCallback(() => {
    setSettings({
      ...DEFAULT_SETTINGS,
      typing: { ...DEFAULT_SETTINGS.typing },
    });
    notify(
      "success",
      "Back to the beginning",
      "Every preference has been restored to its default.",
    );
  }, [notify]);

  const handleSavePreset = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const preset = await savePreset(name, settingsRef.current.typing);
        setPresets((current) => [preset, ...current]);
        notify("success", "Preset saved", `“${preset.name}” is ready whenever you need it.`);
        return true;
      } catch (error) {
        notify("error", "Couldn't save preset", friendlyError(error));
        return false;
      }
    },
    [notify],
  );

  const handleRenamePreset = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      try {
        const renamed = await renamePreset(id, name);
        setPresets((current) =>
          current.map((preset) => (preset.id === id ? renamed : preset)),
        );
        notify("success", "Preset renamed", `Now called “${renamed.name}”.`);
        return true;
      } catch (error) {
        notify("error", "Couldn't rename preset", friendlyError(error));
        return false;
      }
    },
    [notify],
  );

  const handleDeletePreset = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await deletePreset(id);
        setPresets((current) => current.filter((preset) => preset.id !== id));
        notify("info", "Preset deleted", "It has been removed from this device.");
        return true;
      } catch (error) {
        notify("error", "Couldn't delete preset", friendlyError(error));
        return false;
      }
    },
    [notify],
  );

  const handleLoadPreset = useCallback(
    (preset: Preset) => {
      if (enginePhaseRef.current !== "idle") {
        notify(
          "warning",
          "A session is running",
          "Finish or stop it before changing presets.",
        );
        return;
      }
      setSettings((current) => ({ ...current, typing: preset.typing }));
      setTab("type");
      notify("success", "Preset loaded", `“${preset.name}” is now setting the rhythm.`);
    },
    [notify, setTab],
  );

  const openType = useCallback(() => setTab("type"), [setTab]);
  const openSettings = useCallback(() => setTab("settings"), [setTab]);

  const handleMinimize = useCallback(() => {
    void minimizeWindow();
  }, []);

  const handleMaximize = useCallback(() => {
    void toggleMaximizeWindow()
      .then(setMaximized)
      .catch(() => undefined);
  }, []);

  const handleClose = useCallback(() => {
    void (async () => {
      try {
        const bounds = await readWindowBounds();
        if (bounds) await saveWindowBounds(bounds);
      } catch {
        // Geometry persistence is best effort.
      }
      await hideWindow();
      if (!isTauri) {
        notify(
          "info",
          "Running in preview",
          "In the desktop app this button hides MrTyper to the system tray.",
        );
      }
    })();
  }, [notify]);

  const isRunning = engine.phase !== "idle";
  const isCounting = ready && engine.phase === "countdown";
  const progressPercent =
    isRunning && engine.total > 0
      ? Math.min(100, Math.floor((engine.typed / engine.total) * 100))
      : 0;

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "never"} transition={springSoft}>
      <div className={`frame${maximized ? " is-maximized" : ""}`}>
        <TitleBar
          phase={engine.phase}
          progress={progressPercent}
          maximized={maximized}
          hotkeyStart={settings.hotkeyStart}
          hotkeyPause={settings.hotkeyPause}
          stopOnEsc={settings.stopOnEsc}
          onMinimize={handleMinimize}
          onMaximize={handleMaximize}
          onClose={handleClose}
        />

        {ready ? (
          <div className="shell">
            <Rail
              active={tab}
              theme={resolvedTheme}
              onChange={setTab}
              onToggleTheme={handleToggleTheme}
            />
            <main className="main">
              <AnimatePresence initial={false} custom={direction}>
                <motion.div
                  key={tab}
                  className="page"
                  custom={direction}
                  variants={pageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {tab === "type" ? (
                    <TypePage
                      settings={settings}
                      text={text}
                      engine={engine}
                      lastRun={lastRun}
                      paletteKey={paletteKey}
                      onTextChange={setText}
                      onTypingChange={updateTyping}
                      onStart={handleStart}
                      onStop={handleStop}
                      onPauseResume={handlePauseResume}
                      onOpenSettings={openSettings}
                      notify={notify}
                    />
                  ) : null}
                  {tab === "presets" ? (
                    <PresetsPage
                      presets={presets}
                      settings={settings}
                      onSavePreset={handleSavePreset}
                      onRenamePreset={handleRenamePreset}
                      onDeletePreset={handleDeletePreset}
                      onLoadPreset={handleLoadPreset}
                      onStartFresh={openType}
                      notify={notify}
                    />
                  ) : null}
                  {tab === "settings" ? (
                    <SettingsPage
                      settings={settings}
                      running={isRunning}
                      accent={accent}
                      motion={motionPref}
                      systemReducesMotion={systemReducesMotion}
                      onAccentChange={handleAccentChange}
                      onMotionChange={handleMotionChange}
                      onTypingChange={updateTyping}
                      onSettingsChange={updateSettings}
                      onResetSettings={handleResetSettings}
                      onEmergencyStop={handleEmergencyStop}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        ) : (
          <div />
        )}

        <AnimatePresence>
          {ready ? null : (
            <motion.div
              key="boot"
              className="boot"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <Logo className="boot-mark" blink />
              <span className="boot-word" aria-label="Loading MrTyper">
                {Array.from(BOOT_WORD).map((letter, index) => (
                  <span key={index} style={{ "--i": index } as CSSProperties}>
                    {letter}
                  </span>
                ))}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <CountdownOverlay
          open={isCounting}
          countdown={engine.countdown}
          total={settings.typing.startDelaySecs}
          stopOnEsc={settings.stopOnEsc}
          onCancel={handleStop}
        />
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
        <div id="overlay-root" />
      </div>
    </MotionConfig>
  );
}

export default App;
