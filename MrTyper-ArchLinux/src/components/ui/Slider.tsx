import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { clamp, cn } from "../../lib/utils";

interface BaseProps {
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  /** Short text shown in the bubble above a held thumb. */
  bubble?: (value: number) => string;
  /** Spoken value for assistive technology. */
  formatValue?: (value: number) => string;
  onDragChange?: (dragging: boolean) => void;
}

interface SliderProps extends BaseProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

interface RangeSliderProps extends BaseProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  ariaLabelLow?: string;
  ariaLabelHigh?: string;
}

type RangeThumb = "low" | "high";

/** Half the thumb width: the thumb never leaves the track's bounds. */
const THUMB_INSET = 7;

function percentage(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return ((value - min) / (max - min)) * 100;
}

function snap(value: number, min: number, max: number, step: number): number {
  const clamped = clamp(value, min, max);
  const stepped = Math.round((clamped - min) / step) * step + min;
  const decimals = (step.toString().split(".")[1] ?? "").length;
  return Number(clamp(stepped, min, max).toFixed(decimals));
}

function valueFromClientX(
  clientX: number,
  element: HTMLElement,
  min: number,
  max: number,
  step: number,
): number {
  const bounds = element.getBoundingClientRect();
  const usable = bounds.width - THUMB_INSET * 2;
  const ratio =
    usable <= 0 ? 0 : (clientX - bounds.left - THUMB_INSET) / usable;
  return snap(min + clamp(ratio, 0, 1) * (max - min), min, max, step);
}

function keyboardTarget(
  key: string,
  current: number,
  step: number,
  lowest: number,
  highest: number,
): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return current + step;
    case "ArrowLeft":
    case "ArrowDown":
      return current - step;
    case "PageUp":
      return current + step * 10;
    case "PageDown":
      return current - step * 10;
    case "Home":
      return lowest;
    case "End":
      return highest;
    default:
      return null;
  }
}

const defaultFormat = (value: number) => value.toString();

/**
 * A fader. Position is a CSS custom property, so dragging only ever touches
 * one inline style: no animation library, no layout thrash.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  ariaLabel,
  formatValue = defaultFormat,
  bubble,
  className,
  onDragChange,
}: SliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const percent = percentage(value, min, max);

  function setDrag(next: boolean) {
    setDragging(next);
    onDragChange?.(next);
  }

  function update(clientX: number) {
    if (!rootRef.current) return;
    const next = valueFromClientX(clientX, rootRef.current, min, max, step);
    if (next !== value) onChange(next);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    rootRef.current?.setPointerCapture?.(event.pointerId);
    setDrag(true);
    update(event.clientX);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging || disabled) return;
    update(event.clientX);
  }

  function endDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && rootRef.current?.hasPointerCapture?.(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
    if (dragging) setDrag(false);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const target = keyboardTarget(event.key, value, step, min, max);
    if (target === null) return;
    event.preventDefault();
    onChange(snap(target, min, max, step));
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "fader",
        dragging && "is-dragging",
        disabled && "is-disabled",
        className,
      )}
      style={{ "--p": percent } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => endDrag()}
    >
      <div className="fader-track">
        <div className="fader-fill" />
      </div>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        className={cn("fader-thumb", dragging && "is-active")}
        data-bubble={bubble ? bubble(value) : undefined}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

export function RangeSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  ariaLabelLow = "Minimum",
  ariaLabelHigh = "Maximum",
  formatValue = defaultFormat,
  bubble,
  className,
  onDragChange,
}: RangeSliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeThumb, setActiveThumb] = useState<RangeThumb | null>(null);
  const lastThumb = useRef<RangeThumb>("low");
  const [low, high] = value;
  const lowPercent = percentage(low, min, max);
  const highPercent = percentage(high, min, max);

  function setThumb(thumb: RangeThumb, next: number) {
    const snapped =
      thumb === "low"
        ? snap(Math.min(next, high), min, max, step)
        : snap(Math.max(next, low), min, max, step);
    if (thumb === "low" && snapped !== low) onChange([snapped, high]);
    if (thumb === "high" && snapped !== high) onChange([low, snapped]);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const next = valueFromClientX(event.clientX, event.currentTarget, min, max, step);
    let thumb: RangeThumb;
    if (low === high) {
      // Stacked thumbs: pick by direction so neither can get trapped.
      thumb = next < low ? "low" : next > high ? "high" : lastThumb.current;
    } else {
      thumb = Math.abs(next - low) <= Math.abs(next - high) ? "low" : "high";
    }
    lastThumb.current = thumb;
    setActiveThumb(thumb);
    onDragChange?.(true);
    rootRef.current?.setPointerCapture?.(event.pointerId);
    setThumb(thumb, next);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeThumb || disabled) return;
    setThumb(
      activeThumb,
      valueFromClientX(event.clientX, event.currentTarget, min, max, step),
    );
  }

  function endDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && rootRef.current?.hasPointerCapture?.(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
    if (activeThumb) {
      setActiveThumb(null);
      onDragChange?.(false);
    }
  }

  function handleKeyDown(
    thumb: RangeThumb,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (disabled) return;
    const current = thumb === "low" ? low : high;
    const target = keyboardTarget(
      event.key,
      current,
      step,
      thumb === "low" ? min : low,
      thumb === "low" ? high : max,
    );
    if (target === null) return;
    event.preventDefault();
    setThumb(thumb, target);
  }

  function renderThumb(thumb: RangeThumb) {
    const current = thumb === "low" ? low : high;
    return (
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={thumb === "low" ? ariaLabelLow : ariaLabelHigh}
        aria-valuemin={thumb === "low" ? min : low}
        aria-valuemax={thumb === "low" ? high : max}
        aria-valuenow={current}
        aria-valuetext={formatValue(current)}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        className={cn("fader-thumb", activeThumb === thumb && "is-active")}
        data-bubble={bubble ? bubble(current) : undefined}
        style={
          {
            "--p": thumb === "low" ? lowPercent : highPercent,
            zIndex: lastThumb.current === thumb ? 2 : 1,
          } as CSSProperties
        }
        onKeyDown={(event) => handleKeyDown(thumb, event)}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "fader",
        activeThumb && "is-dragging",
        disabled && "is-disabled",
        className,
      )}
      style={{ "--lo": lowPercent, "--hi": highPercent } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => endDrag()}
    >
      <div className="fader-track">
        <div className="fader-fill is-range" />
      </div>
      {renderThumb("low")}
      {renderThumb("high")}
    </div>
  );
}
