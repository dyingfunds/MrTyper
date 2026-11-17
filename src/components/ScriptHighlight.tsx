import { forwardRef, memo, useMemo, type ReactNode } from "react";
import { resolveCommand } from "../lib/scriptCommands";

/** Candidate {{…}} commands; resolveCommand decides which ones are real. */
const CANDIDATE = /\{\{[^{}\n]{1,49}\}\}/g;

/**
 * Sits behind the script textarea and paints a soft chip under every command,
 * so `{{bold}}` and `{{pause 3}}` stand out from the text that gets typed. Its
 * own text is transparent; it only has to wrap exactly like the textarea.
 */
export const ScriptHighlight = memo(
  forwardRef<HTMLDivElement, { text: string }>(function ScriptHighlight({ text }, ref) {
    const content = useMemo(() => {
      const parts: ReactNode[] = [];
      let last = 0;
      for (const match of text.matchAll(CANDIDATE)) {
        const command = resolveCommand(match[0].slice(2, -2));
        if (!command) continue;
        const start = match.index ?? 0;
        if (start > last) parts.push(text.slice(last, start));
        parts.push(
          <mark key={start} className={`sh-cmd is-${command.kind}`}>
            {match[0]}
          </mark>,
        );
        last = start + match[0].length;
      }
      parts.push(text.slice(last));
      // A trailing newline needs something after it to take up its line.
      parts.push("​");
      return parts;
    }, [text]);

    return (
      <div ref={ref} className="script-highlight" aria-hidden="true">
        {content}
      </div>
    );
  }),
);
