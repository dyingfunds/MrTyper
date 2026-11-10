import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { liveBus } from "../lib/liveBus";
import { cn } from "../lib/utils";
import type { Phase } from "../types";

interface LiveScriptProps {
  /** The script exactly as the engine sees it (newlines normalised). */
  text: string;
  /** Characters delivered so far, counted in Unicode code points. */
  typed: number;
  phase: Phase;
}

interface ScriptModel {
  lines: string[];
  /** Code-point offset at which each line begins. */
  starts: Uint32Array;
  astral: boolean;
}

const ZERO_WIDTH_SPACE = "​";
const SURROGATE = /[\uD800-\uDFFF]/;

function buildModel(text: string): ScriptModel {
  const lines = text.split("\n");
  const astral = SURROGATE.test(text);
  const starts = new Uint32Array(lines.length);
  let position = 0;
  for (let index = 0; index < lines.length; index += 1) {
    starts[index] = position;
    const line = lines[index];
    position += (astral && SURROGATE.test(line) ? Array.from(line).length : line.length) + 1;
  }
  return { lines, starts, astral };
}

/** Largest line index whose start is at or before `typed`. */
function lineAt(starts: Uint32Array, typed: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= typed) low = middle;
    else high = middle - 1;
  }
  return low;
}

function joinLines(lines: string[], from: number, to: number): string {
  let output = "";
  for (let index = from; index < to; index += 1) {
    if (index > from) output += "\n";
    // An empty line needs something to hold its height open.
    output += lines[index] || ZERO_WIDTH_SPACE;
  }
  return output;
}

/**
 * The script as a live stage: delivered text is inked in, a glowing caret marks
 * the engine's position, and the view follows it. Only the line being typed
 * re-renders per keystroke; everything above and below is updated per line.
 */
export const LiveScript = memo(function LiveScript({
  text,
  typed,
  phase,
}: LiveScriptProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const model = useMemo(() => buildModel(text), [text]);

  const lineIndex = lineAt(model.starts, typed);
  const column = Math.max(0, typed - model.starts[lineIndex]);

  const before = useMemo(
    () => joinLines(model.lines, 0, lineIndex),
    [lineIndex, model],
  );
  const after = useMemo(
    () => joinLines(model.lines, lineIndex + 1, model.lines.length),
    [lineIndex, model],
  );
  const glyphs = useMemo(() => {
    const line = model.lines[lineIndex] ?? "";
    return model.astral && SURROGATE.test(line) ? Array.from(line) : null;
  }, [lineIndex, model]);

  const line = model.lines[lineIndex] ?? "";
  const cut = Math.min(column, glyphs ? glyphs.length : line.length);
  const settled = glyphs ? glyphs.slice(0, Math.max(0, cut - 1)).join("") : line.slice(0, Math.max(0, cut - 1));
  const fresh = cut > 0 ? (glyphs ? glyphs[cut - 1] : line.charAt(cut - 1)) : "";
  const pending = glyphs ? glyphs.slice(cut).join("") : line.slice(cut);

  // Keep the caret comfortably in view without fighting the reader.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const caret = caretRef.current;
    if (!scroller || !caret) return;
    const top = caret.offsetTop;
    const viewTop = scroller.scrollTop;
    const viewHeight = scroller.clientHeight;
    if (top < viewTop + 24 || top > viewTop + viewHeight - 96) {
      scroller.scrollTo({ top: Math.max(0, top - viewHeight * 0.38) });
    }
  }, [lineIndex, cut]);

  // A typo flashes the caret red until its correction lands.
  useEffect(() => {
    let timer = 0;
    const clear = () => caretRef.current?.classList.remove("is-typo");
    const unsubscribe = liveBus.subscribe((stroke) => {
      if (stroke.kind === "typo") {
        caretRef.current?.classList.add("is-typo");
        window.clearTimeout(timer);
        timer = window.setTimeout(clear, 900);
      } else {
        window.clearTimeout(timer);
        clear();
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={scrollerRef}
      className={cn("live-script", phase !== "typing" && "is-waiting")}
      aria-hidden="true"
    >
      {lineIndex > 0 ? <div className="ls-block ls-done">{before}</div> : null}
      <div className="ls-block">
        <span className="ls-done">{settled}</span>
        {fresh ? (
          <span key={typed} className="ls-done ls-fresh">
            {fresh}
          </span>
        ) : null}
        <span ref={caretRef} className="ls-caret" />
        <span className="ls-todo">{pending || ZERO_WIDTH_SPACE}</span>
      </div>
      {lineIndex < model.lines.length - 1 ? (
        <div className="ls-block ls-todo">{after}</div>
      ) : null}
    </div>
  );
});
