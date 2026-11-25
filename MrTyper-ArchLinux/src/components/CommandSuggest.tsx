import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import type { CommandSuggestion } from "../lib/scriptCommands";

interface CommandSuggestProps {
  suggestions: CommandSuggestion[];
  active: number;
  /** Position inside the stage body, already flipped and clamped. */
  left: number;
  top: number;
  above: boolean;
  onPick: (suggestion: CommandSuggestion) => void;
  onHover: (index: number) => void;
}

/**
 * The list of commands offered while one is being typed in the script.
 * Keyboard control lives in the textarea (see Stage), so this never takes
 * focus: clicks are taken on mousedown, before the textarea would blur.
 */
export function CommandSuggest({
  suggestions,
  active,
  left,
  top,
  above,
  onPick,
  onHover,
}: CommandSuggestProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const item = listRef.current?.children[active] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={listRef}
      className={cn("command-suggest", above && "is-above")}
      style={{ left, top }}
      role="listbox"
      aria-label="Matching commands"
    >
      {suggestions.map((suggestion, index) => (
        <div
          key={suggestion.token}
          role="option"
          aria-selected={index === active}
          className={cn("command-suggest-item", index === active && "is-active")}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(suggestion);
          }}
          onMouseMove={() => {
            if (index !== active) onHover(index);
          }}
        >
          <span className="command-suggest-label">{suggestion.label}</span>
          <code>{suggestion.keys || `{{${suggestion.token}}}`}</code>
        </div>
      ))}
      <div className="command-suggest-hint" aria-hidden="true">
        ↑↓ choose · Enter or Tab insert · Esc close
      </div>
    </div>
  );
}
