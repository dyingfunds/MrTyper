import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { clamp, cn } from "../../lib/utils";

interface NumberFieldProps {
  /** The stored value. */
  value: number;
  /** Bounds of the stored value. */
  min: number;
  max: number;
  /** Decimal places the stored value keeps (0 for whole numbers). */
  decimals?: number;
  onChange: (value: number) => void;
  /** What the field shows when it isn't being edited, e.g. "380 ms". */
  format: (value: number) => string;
  /** Stored value → number shown while editing (e.g. ms → seconds). */
  toInput?: (value: number) => number;
  /** Number typed → stored value. */
  fromInput?: (input: number) => number;
  /** Unit shown beside the input while editing. */
  unit?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

const identity = (value: number) => value;

function trimmed(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/**
 * A value read-out that turns into a text box when clicked, so any slider's
 * value can also be typed. Enter or leaving the field applies it; Esc cancels.
 * Out-of-range numbers are clamped to the slider's range.
 */
export function NumberField({
  value,
  min,
  max,
  decimals = 0,
  onChange,
  format,
  toInput = identity,
  fromInput = identity,
  unit,
  ariaLabel,
  disabled,
  className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (disabled) setDraft(null);
  }, [disabled]);

  function open() {
    if (disabled) return;
    cancelled.current = false;
    setDraft(trimmed(toInput(value)));
  }

  function commit() {
    if (draft === null) return;
    const text = draft.trim().replace(",", ".");
    setDraft(null);
    if (cancelled.current || text === "") return;
    const typed = Number(text);
    if (!Number.isFinite(typed)) return;
    const factor = 10 ** decimals;
    const next = clamp(Math.round(fromInput(typed) * factor) / factor, min, max);
    if (next !== value) onChange(next);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // Keep these keys away from the app's own shortcuts (Esc stops a session).
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      inputRef.current?.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelled.current = true;
      inputRef.current?.blur();
    }
  }

  if (editing) {
    return (
      <span className={cn("num-field is-editing", className)}>
        <input
          ref={inputRef}
          className="num-field-input"
          type="text"
          inputMode="decimal"
          autoFocus
          spellCheck={false}
          aria-label={`${ariaLabel}${unit ? ` (${unit})` : ""}`}
          value={draft}
          size={Math.max(2, draft.length)}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d.,-]/g, ""))}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
        {unit ? <span className="num-field-unit">{unit}</span> : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={cn("num-field", className)}
      disabled={disabled}
      aria-label={`${ariaLabel}: ${format(value)}. Click to type a value.`}
      title={disabled ? undefined : "Click to type a value"}
      onClick={open}
    >
      {format(value)}
    </button>
  );
}
