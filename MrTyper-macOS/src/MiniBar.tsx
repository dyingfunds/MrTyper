import { Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  bootstrap,
  getEngineStatus,
  onBackendEvent,
  pauseTyping,
  resumeTyping,
  stopTyping,
} from "./lib/bridge";
import { normalizeSettings } from "./lib/defaults";
import { applyPalette, paletteColors } from "./lib/palette";
import { STORAGE_KEY, loadUiPrefs } from "./lib/uiPrefs";
import { formatHotkey } from "./lib/utils";
import type { Phase, ResolvedTheme } from "./types";

interface MiniState {
  phase: Phase;
  held: boolean;
  countdown: number | null;
  typed: number;
  total: number;
  runId: number | null;
}

const IDLE: MiniState = {
  phase: "idle",
  held: false,
  countdown: null,
  typed: 0,
  total: 0,
  runId: null,
};

/**
 * The floating mini window. It runs in its own small webview and follows the
 * same engine events as the main window. It can't take keyboard focus, so its
 * buttons never pull focus away from the window being typed into.
 */
export function MiniBar() {
  const [state, setState] = useState<MiniState>(IDLE);
  const [hotkeyPause, setHotkeyPause] = useState("F9");
  const frame = useRef(0);
  const pending = useRef<{ typed: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        const snapshot = await bootstrap();
        const settings = normalizeSettings(snapshot.settings);
        if (!cancelled) {
          setHotkeyPause(settings.hotkeyPause);
          applyTheme(settings.theme === "system" ? null : settings.theme);
        }
        const status = await getEngineStatus();
        if (!cancelled) {
          setState({
            phase: status.phase,
            held: false,
            countdown: status.countdown,
            typed: status.typed,
            total: status.total,
            runId: status.runId,
          });
        }
      } catch {
        // Live events fill the bar in anyway.
      }

      const subscriptions = await Promise.all([
        onBackendEvent("typing-phase", (payload) => {
          setState((current) => ({
            ...(current.runId === payload.runId ? current : IDLE),
            phase: payload.phase,
            held: payload.phase === "paused" && Boolean(payload.held),
            countdown: payload.countdown,
            total: payload.total,
            runId: payload.runId,
          }));
        }),
        onBackendEvent("typing-progress", (payload) => {
          // At most one render per frame, like the main window.
          pending.current = { typed: payload.typed, total: payload.total };
          if (frame.current) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            const next = pending.current;
            pending.current = null;
            if (next) setState((current) => ({ ...current, ...next }));
          });
        }),
        onBackendEvent("typing-finished", (payload) => {
          setState((current) => ({
            ...current,
            phase: "idle",
            held: false,
            typed: payload.typed,
            total: payload.total,
          }));
        }),
      ]);
      if (cancelled) subscriptions.forEach((unsubscribe) => unsubscribe());
      else unlisteners.push(...subscriptions);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      unlisteners.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  // The palette is chosen in the main window; both share one storage, so a
  // change there arrives here as a storage event.
  useEffect(() => {
    const repaint = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const theme = document.documentElement.dataset.theme;
      applyTheme(theme === "light" || theme === "dark" ? theme : null);
    };
    window.addEventListener("storage", repaint);
    return () => window.removeEventListener("storage", repaint);
  }, []);

  const { phase, held, countdown, typed, total } = state;
  const progress = total > 0 ? Math.min(1, typed / total) : 0;
  const percent = Math.floor(progress * 100);

  let label = "Ready";
  if (phase === "countdown") label = `Starting in ${countdown ?? ""}`;
  else if (phase === "typing") label = "Typing";
  else if (phase === "paused") label = held ? `Holding · ${formatHotkey(hotkeyPause)} to go on` : "Paused";
  else if (total > 0) label = "Done";

  return (
    <div
      className={`mini is-${phase}${held ? " is-held" : ""}`}
      style={{ "--progress": progress } as CSSProperties}
    >
      <div className="mini-info" data-tauri-drag-region>
        <span className="mini-led" data-tauri-drag-region />
        <span className="mini-label" data-tauri-drag-region>
          {label}
        </span>
        <span className="mini-percent num" data-tauri-drag-region>
          {phase === "countdown" || total === 0 ? "" : `${percent}%`}
        </span>
      </div>
      <div className="mini-actions">
        <button
          type="button"
          className="mini-btn"
          disabled={phase !== "typing" && phase !== "paused"}
          title={`${phase === "paused" ? "Resume" : "Pause"} (${formatHotkey(hotkeyPause)})`}
          aria-label={phase === "paused" ? "Resume" : "Pause"}
          onClick={() => void (phase === "paused" ? resumeTyping() : pauseTyping()).catch(() => undefined)}
        >
          {phase === "paused" ? (
            <Play size={13} fill="currentColor" strokeWidth={0} />
          ) : (
            <Pause size={13} fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <button
          type="button"
          className="mini-btn is-stop"
          disabled={phase === "idle"}
          title="Stop"
          aria-label="Stop"
          onClick={() => void stopTyping().catch(() => undefined)}
        >
          <Square size={11} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      <div className="mini-track" aria-hidden="true">
        <div className="mini-fill" />
      </div>
    </div>
  );
}

function applyTheme(theme: ResolvedTheme | null) {
  const resolved =
    theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = resolved;
  const prefs = loadUiPrefs();
  applyPalette(paletteColors(prefs.palette, prefs.customColors), resolved);
}
