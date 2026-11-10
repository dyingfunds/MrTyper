import { memo, useEffect, useRef } from "react";
import { levelForWpm, simulateCadence, type CadenceBar } from "../lib/cadence";
import { liveBus, type StrokeKind } from "../lib/liveBus";
import type { Phase, TypingSettings } from "../types";

interface CadenceScopeProps {
  typing: TypingSettings;
  phase: Phase;
  /** Changes whenever theme or accent changes, so colours are re-read. */
  paletteKey: string;
}

interface LiveBar {
  level: number;
  kind: StrokeKind;
  born: number;
}

interface Palette {
  accent: string;
  danger: string;
  warn: string;
  ghost: string;
  pause: string;
  base: string;
}

type Mode = "preview" | "live" | "recording";

const BAR_WIDTH = 3;
const BAR_PITCH = 6;
const MAX_BARS = 400;
const MORPH_MS = 380;
const GROW_MS = 170;
const SLIDE_MS = 130;
/** Keep drawing briefly after the last key so entrance animations finish. */
const SETTLE_MS = 420;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function readPalette(node: HTMLElement): Palette {
  const styles = getComputedStyle(node);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const light = document.documentElement.dataset.theme === "light";
  return {
    accent: read(light ? "--accent-text" : "--accent", "#c8ff2e"),
    danger: read("--danger", "#ff5340"),
    warn: read("--warn", "#ffb224"),
    ghost: read("--text-3", "#72756d"),
    pause: read("--text-4", "#4a4d47"),
    base: read("--line-2", "rgba(255,255,255,.13)"),
  };
}

/**
 * The rhythm display. Idle, it sketches the cadence the current settings will
 * produce. Live, it records every real keystroke as it lands. It is a canvas
 * fed directly by the keystroke bus, so a 300 WPM session never re-renders React.
 */
export const CadenceScope = memo(function CadenceScope({
  typing,
  phase,
  paletteKey,
}: CadenceScopeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const typingRef = useRef(typing);
  const phaseRef = useRef(phase);
  const api = useRef<{
    setPreview: (typing: TypingSettings) => void;
    setMode: (mode: Mode) => void;
    resetLive: () => void;
    hasRecording: () => boolean;
    repaint: () => void;
    refreshPalette: () => void;
  } | null>(null);

  typingRef.current = typing;
  phaseRef.current = phase;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let palette = readPalette(wrap);
    let mode: Mode = "preview";
    let frame = 0;

    let previewFrom: CadenceBar[] = [];
    let previewTo: CadenceBar[] = [];
    let morphStart = -Infinity;

    const liveBars: LiveBar[] = [];
    let lastStrokeAt = 0;
    let lastShiftAt = -Infinity;
    let lastActivity = -Infinity;

    const slots = () => Math.max(8, Math.floor((width + (BAR_PITCH - BAR_WIDTH)) / BAR_PITCH));

    function drawBar(x: number, level: number, color: string, alpha: number) {
      const usable = height - 3;
      const barHeight = Math.max(2, usable * level);
      context!.globalAlpha = alpha;
      context!.fillStyle = color;
      context!.beginPath();
      context!.roundRect(x, height - 3 - barHeight, BAR_WIDTH, barHeight, 1.5);
      context!.fill();
    }

    function drawBaseline(count: number) {
      context!.globalAlpha = 1;
      context!.fillStyle = palette.base;
      for (let index = 0; index < count; index += 1) {
        context!.fillRect(index * BAR_PITCH, height - 1.5, BAR_WIDTH, 1.5);
      }
    }

    function draw(now: number): boolean {
      context!.clearRect(0, 0, width, height);
      const count = slots();
      drawBaseline(count);
      let animating = false;

      if (mode === "preview") {
        const t = easeOutCubic((now - morphStart) / MORPH_MS);
        animating = t < 1;
        for (let index = 0; index < count; index += 1) {
          const target = previewTo[index];
          if (!target) continue;
          const origin = previewFrom[index] ?? target;
          const level = origin.level + (target.level - origin.level) * t;
          const color =
            target.kind === "typo"
              ? palette.danger
              : target.kind === "pause"
                ? palette.pause
                : palette.ghost;
          drawBar(index * BAR_PITCH, level, color, target.kind === "typo" ? 0.75 : 0.5);
        }
      } else {
        const slide =
          mode === "live" ? (1 - easeOutCubic((now - lastShiftAt) / SLIDE_MS)) * BAR_PITCH : 0;
        const dimmed = mode === "recording" || phaseRef.current === "paused";
        const first = Math.max(0, liveBars.length - count - 1);
        for (let index = liveBars.length - 1; index >= first; index -= 1) {
          const bar = liveBars[index];
          const fromRight = liveBars.length - 1 - index;
          const x = width - BAR_WIDTH - fromRight * BAR_PITCH + slide;
          if (x < -BAR_WIDTH) break;
          const grow = mode === "live" ? easeOutCubic((now - bar.born) / GROW_MS) : 1;
          const fade = mode === "live" ? 1 - Math.pow(fromRight / count, 1.6) * 0.82 : 1;
          const color =
            bar.kind === "typo"
              ? palette.danger
              : bar.kind === "correction"
                ? palette.warn
                : palette.accent;
          drawBar(x, bar.level * grow, color, (dimmed ? 0.55 : 1) * fade);
        }
        animating = mode === "live" && now - lastActivity < SETTLE_MS;
      }

      context!.globalAlpha = 1;
      return animating;
    }

    function loop(now: number) {
      frame = 0;
      if (draw(now)) frame = requestAnimationFrame(loop);
    }

    function kick() {
      if (!frame) frame = requestAnimationFrame(loop);
    }

    function resize() {
      const bounds = wrap!.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (mode === "preview") {
        previewTo = simulateCadence(typingRef.current, slots());
        previewFrom = previewTo;
      }
      draw(performance.now());
    }

    api.current = {
      setPreview(next) {
        const now = performance.now();
        const count = slots();
        const t = easeOutCubic((now - morphStart) / MORPH_MS);
        // Morph from whatever is on screen right now, even mid-transition.
        previewFrom = previewTo.map((target, index) => {
          const origin = previewFrom[index] ?? target;
          return { kind: target.kind, level: origin.level + (target.level - origin.level) * t };
        });
        previewTo = simulateCadence(next, count);
        morphStart = now;
        kick();
      },
      setMode(next) {
        if (mode === next) return;
        mode = next;
        if (next === "preview") {
          previewTo = simulateCadence(typingRef.current, slots());
          previewFrom = previewTo.map((bar) => ({ ...bar, level: 0.05 }));
          morphStart = performance.now();
        }
        lastActivity = performance.now();
        kick();
      },
      resetLive() {
        liveBars.length = 0;
        lastStrokeAt = 0;
        kick();
      },
      hasRecording: () => liveBars.length > 0,
      repaint: kick,
      refreshPalette() {
        palette = readPalette(wrap!);
        kick();
      },
    };

    const unsubscribe = liveBus.subscribe((stroke) => {
      const interval = lastStrokeAt ? stroke.time - lastStrokeAt : 0;
      lastStrokeAt = stroke.time;
      const settings = typingRef.current;
      const wpm = interval > 0 ? 12000 / interval : (settings.minWpm + settings.maxWpm) / 2;
      liveBars.push({ level: levelForWpm(wpm), kind: stroke.kind, born: stroke.time });
      if (liveBars.length > MAX_BARS) liveBars.splice(0, liveBars.length - MAX_BARS);
      lastShiftAt = stroke.time;
      lastActivity = stroke.time;
      if (mode === "live") kick();
    });

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    return () => {
      unsubscribe();
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      api.current = null;
    };
  }, []);

  // A finished run stays on screen as a recording until the recipe changes.
  const recordingStale = useRef(true);

  useEffect(() => {
    const scope = api.current;
    if (!scope) return;
    if (phase === "countdown") {
      scope.resetLive();
      recordingStale.current = false;
      scope.setMode("live");
    } else if (phase === "typing" || phase === "paused") {
      recordingStale.current = false;
      scope.setMode("live");
      scope.repaint();
    } else if (!recordingStale.current && scope.hasRecording()) {
      scope.setMode("recording");
    } else {
      scope.setMode("preview");
    }
  }, [phase]);

  const firstTyping = useRef(true);
  useEffect(() => {
    if (firstTyping.current) {
      firstTyping.current = false;
      return;
    }
    const scope = api.current;
    if (!scope || phaseRef.current !== "idle") return;
    recordingStale.current = true;
    scope.setMode("preview");
    scope.setPreview(typing);
  }, [typing]);

  useEffect(() => {
    api.current?.refreshPalette();
  }, [paletteKey]);

  return (
    <div ref={wrapRef} className="scope-canvas-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="scope-canvas" />
    </div>
  );
});
