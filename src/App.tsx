import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientBackground } from "./components/AmbientBackground";
import { CountdownOverlay } from "./components/CountdownOverlay";
import { Keycap } from "./components/ui/Keycap";
import { Tabs } from "./components/Tabs";
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
import { pageTransition, springSoft } from "./lib/motion";
import {
  characterCount,
  formatHotkey,
  formatWpm,
} from "./lib/utils";
import { PresetsPage } from "./pages/PresetsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TypePage } from "./pages/TypePage";
import type {
  AppSettings,
  BackendEvents,
  FinishReason,
  LiveEngineState,
  Preset,
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
  strokes: 0,
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

function App() {
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<TabId>("type");
  const [engine, setEngine] = useState<LiveEngineState>(EMPTY_ENGINE);
  const [lastRun, setLastRun] = useState<SessionSummary | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [maximized, setMaximized] = useState(false);
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const skipSettingsSave = useRef(true);
  const skipTextSave = useRef(true);
  const activeRunId = useRef<number | null>(null);
  const toastId = useRef(0);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const lastToast = useRef<{ signature: string; time: number } | null>(null);
  const enginePhaseRef = useRef(engine.phase);
  const settingsRef = useRef(settings);
  const scrollRef = useRef<HTMLDivElement>(null);

  enginePhaseRef.current = engine.phase;
  settingsRef.current = settings;

  const resolvedTheme = useMemo(() => {
    if (settings.theme === "system") return systemDark ? "dark" : "light";
    return settings.theme;
  }, [settings.theme, systemDark]);

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
    setToasts((current) => [
      ...current.slice(-2),
      { id, kind, title, message },
    ]);
    const timer = setTimeout(() => {
      toastTimers.current.delete(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4800);
    toastTimers.current.set(id, timer);
  }, []);

  const notifyBackendToast = useCallback(
    (payload: ToastPayload) => {
      notify(
        payload.kind,
        payload.title ?? TOAST_TITLES[payload.kind],
        payload.message,
      );
    },
    [notify],
  );

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
              strokes: 0,
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
        notify(
          "error",
          "Couldn't load preferences",
          friendlyError(error),
        );
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

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Native event stream                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const handlers: {
      [K in keyof BackendEvents]: (payload: BackendEvents[K]) => void;
    } = {
      "typing-phase": (payload) => {
        if (payload.phase === "idle") {
          activeRunId.current = null;
          setEngine((current) => ({ ...current, phase: "idle" }));
          return;
        }
        activeRunId.current = payload.runId;
        setEngine((current) => {
          if (current.runId !== null && current.runId !== payload.runId) {
            return current;
          }
          return {
            ...current,
            phase: payload.phase,
            countdown: payload.countdown,
            runId: payload.runId,
            total: payload.total,
            elapsedMs:
              payload.phase === "typing" ? current.elapsedMs : current.elapsedMs,
          };
        });
      },
      "typing-progress": (payload) => {
        setEngine((current) => {
          if (current.runId !== null && current.runId !== payload.runId) {
            return current;
          }
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
      },
      "typing-keystroke": (payload) => {
        setEngine((current) => {
          if (current.runId !== null && current.runId !== payload.runId) {
            return current;
          }
          return { ...current, strokes: current.strokes + 1 };
        });
      },
      "typing-finished": (payload) => {
        if (
          activeRunId.current !== null &&
          activeRunId.current !== payload.runId
        ) {
          return;
        }
        activeRunId.current = null;
        const summary: SessionSummary = {
          reason: payload.reason,
          typed: payload.typed,
          total: payload.total,
          elapsedMs: payload.elapsedMs,
          wpm: payload.wpm,
          message: payload.message,
        };
        setLastRun(summary);
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
            notify(
              "warning",
              FINISH_TITLES.escape,
              "All keystrokes were killed instantly.",
            );
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
        notify(
          "error",
          "Live updates unavailable",
          friendlyError(error),
        );
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
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
        notify(
          "error",
          "Preferences weren't saved",
          friendlyError(error),
        );
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

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    meta?.setAttribute(
      "content",
      resolvedTheme === "dark" ? "#080b16" : "#edf0ff",
    );
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

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let cleanupGeometry: (() => void) | undefined;
    let cleanupMaximize: (() => void) | undefined;

    void (async () => {
      try {
        const [maximizedNow, cleanupGeometryFn, cleanupMaximizeFn] =
          await Promise.all([
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

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: 0,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [reducedMotion, tab]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleStart = useCallback(async () => {
    if (enginePhaseRef.current !== "idle") return;
    if (!text.trim()) {
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
      total: characterCount(text),
    });

    try {
      await startTyping({ text, settings: settingsRef.current });
    } catch (error) {
      setEngine((current) =>
        current.phase === "countdown" ? EMPTY_ENGINE : current,
      );
      notify("error", "Couldn't start typing", friendlyError(error));
    }
  }, [notify, text]);

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
      if (event.key !== "Escape") return;
      if (!settingsRef.current.stopOnEsc) return;
      if (enginePhaseRef.current === "idle") return;
      event.preventDefault();
      void emergencyStop().catch(() => undefined);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const updateTyping = useCallback((patch: Partial<TypingSettings>) => {
    setSettings((current) => ({
      ...current,
      typing: { ...current.typing, ...patch },
    }));
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
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
        notify(
          "success",
          "Preset saved",
          `“${preset.name}” is ready whenever you need it.`,
        );
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
        notify("info", "Preset removed", "The shelf has a little more room.");
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
          "Finish or stop this performance before changing presets.",
        );
        return;
      }
      setSettings((current) => ({ ...current, typing: preset.typing }));
      setTab("type");
      notify(
        "success",
        "Preset loaded",
        `“${preset.name}” is now setting the rhythm.`,
      );
    },
    [notify],
  );

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
          "The title bar is non-destructive here — in the desktop app, MrTyper hides to the system tray.",
        );
      }
    })();
  }, [notify]);

  const isCounting = ready && engine.phase === "countdown";

  return (
    <MotionConfig
      reducedMotion="user"
      transition={springSoft}
    >
      <motion.div
        className={`window-frame${maximized ? " is-maximized" : ""}`}
        initial={{ opacity: 0, scale: 0.96, filter: "blur(16px)" }}
        animate={
          ready
            ? { opacity: 1, scale: 1, filter: "blur(0px)" }
            : { opacity: 0, scale: 0.96, filter: "blur(16px)" }
        }
        transition={{ type: "spring", stiffness: 180, damping: 24, mass: 0.95 }}
      >
        <AmbientBackground />

        <div className="app-content-layer">
          <TitleBar
            phase={engine.phase}
            maximized={maximized}
            hotkeyStart={settings.hotkeyStart}
            onMinimize={handleMinimize}
            onMaximize={handleMaximize}
            onClose={handleClose}
          />

          {ready ? (
            <>
              <div className="top-nav">
                <Tabs active={tab} onChange={setTab} />
                <div className="nav-meta">
                  <span className="inline-flex items-center gap-1.5">
                    <Keycap>{formatHotkey(settings.hotkeyStart)}</Keycap>
                    start / stop
                  </span>
                  <span className="nav-meta-sep" />
                  <span className="inline-flex items-center gap-1.5">
                    <Keycap>{formatHotkey(settings.hotkeyPause)}</Keycap>
                    pause
                  </span>
                  <span className="nav-meta-sep" />
                  <span className="inline-flex items-center gap-1.5">
                    <Keycap>Esc</Keycap>
                    panic
                  </span>
                </div>
              </div>

              <div className="app-scroll" ref={scrollRef}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -6, filter: "blur(5px)" }}
                    transition={pageTransition}
                  >
                    {tab === "type" ? (
                      <TypePage
                        settings={settings}
                        text={text}
                        engine={engine}
                        lastRun={lastRun}
                        onTextChange={setText}
                        onTypingChange={updateTyping}
                        onStart={() => void handleStart()}
                        onStop={() => void handleStop()}
                        onPauseResume={() => void handlePauseResume()}
                        onOpenSettings={() => setTab("settings")}
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
                        onStartFresh={() => setTab("type")}
                        notify={notify}
                      />
                    ) : null}
                    {tab === "settings" ? (
                      <SettingsPage
                        settings={settings}
                        engine={engine}
                        onTypingChange={updateTyping}
                        onSettingsChange={updateSettings}
                        onResetSettings={handleResetSettings}
                        onEmergencyStop={() => void handleEmergencyStop()}
                      />
                    ) : null}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="boot-screen">
              <motion.img
                src="/logo.svg"
                alt=""
                className="boot-mark"
                animate={
                  reducedMotion
                    ? undefined
                    : { opacity: [0.65, 1, 0.65], scale: [0.985, 1.015, 0.985] }
                }
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              />
              <span className="boot-copy">Warming up the keys</span>
            </div>
          )}
        </div>

        <CountdownOverlay
          open={isCounting}
          countdown={engine.countdown}
          stopOnEsc={settings.stopOnEsc}
          onCancel={() => void handleStop()}
        />
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
        <div id="overlay-root" />
      </motion.div>
    </MotionConfig>
  );
}

export default App;
