import { motion } from "framer-motion";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { springSnappy, springSoft } from "../../lib/motion";
import { clamp, cn } from "../../lib/utils";

interface BaseProps {
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

interface SliderProps extends BaseProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  formatValue?: (value: number) => string;
  ticks?: [string, string];
}

interface RangeSliderProps extends BaseProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  ariaLabelLow?: string;
  ariaLabelHigh?: string;
  formatValue?: (value: number) => string;
  showTicks?: boolean;
}

type Thumb = "single" | "low" | "high";

function percentage(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return ((value - min) / (max - min)) * 100;
}

function snap(value: number, min: number, max: number, step: number): number {
  const clamped = clamp(value, min, max);
  const stepped = Math.round((clamped - min) / step) * step + min;
  const decimals = (step.toString().split(".")[1] ?? "").length;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
}

function valueFromClientX(
  clientX: number,
  element: HTMLElement,
  min: number,
  max: number,
  step: number,
): number {
  const bounds = element.getBoundingClientRect();
  const ratio = bounds.width === 0 ? 0 : (clientX - bounds.left) / bounds.width;
  return snap(min + clamp(ratio, 0, 1) * (max - min), min, max, step);
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  ariaLabel,
  formatValue = (next) => next.toString(),
  ticks,
  className,
}: SliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const percent = percentage(value, min, max);

  const update = useCallback(
    (clientX: number) => {
      if (!rootRef.current) return;
      onChange(valueFromClientX(clientX, rootRef.current, min, max, step));
    },
    [max, min, onChange, step],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    rootRef.current?.setPointerCapture?.(event.pointerId);
    setActive(true);
    setDragging(true);
    update(event.clientX);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active || disabled) return;
    update(event.clientX);
  }

  function endDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && rootRef.current?.hasPointerCapture?.(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
    setActive(false);
    setDragging(false);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    let next = value;
    const big = step * 10;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = value + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = value - step;
        break;
      case "PageUp":
        next = value + big;
        break;
      case "PageDown":
        next = value - big;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(snap(next, min, max, step));
  }

  return (
    <div className={cn("slider-group", className)}>
      <div
        ref={rootRef}
        className={cn("slider", disabled && "is-disabled")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          setActive(false);
          setDragging(false);
        }}
      >
        <div className="slider-track">
          <motion.div
            className="slider-fill"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={dragging ? { duration: 0.04 } : springSoft}
          />
        </div>
        <motion.div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={formatValue(value)}
          aria-orientation="horizontal"
          className={cn("slider-thumb", active && "is-active")}
          initial={false}
          animate={{
            left: `${percent}%`,
            scaleX: active ? 1.24 : 1,
            scaleY: active ? 0.9 : 1,
          }}
          transition={dragging ? springSnappy : springSoft}
          onKeyDown={handleKeyDown}
          style={{ touchAction: "none" }}
        />
      </div>
      {ticks ? (
        <div className="slider-ticks" aria-hidden="true">
          <span>{ticks[0]}</span>
          <span>{ticks[1]}</span>
        </div>
      ) : null}
      <span id={`${id}-hint`} className="sr-only">
        Use the arrow keys to adjust. Press Home or End for the minimum or maximum.
      </span>
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
  formatValue = (next) => next.toString(),
  showTicks,
  className,
}: RangeSliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeThumb, setActiveThumb] = useState<"low" | "high" | null>(null);
  const lowPercent = percentage(value[0], min, max);
  const highPercent = percentage(value[1], min, max);
  const [low, high] = value;

  const setThumb = useCallback(
    (thumb: "low" | "high", next: number) => {
      if (thumb === "low") {
        onChange([snap(Math.min(next, high), min, max, step), high]);
      } else {
        onChange([low, snap(Math.max(next, low), min, max, step)]);
      }
    },
    [high, low, max, min, onChange, step],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const next = valueFromClientX(event.clientX, event.currentTarget, min, max, step);
    const lowDistance = Math.abs(next - low);
    const highDistance = Math.abs(next - high);
    let thumb: "low" | "high";
    if (low === high) {
      thumb = activeThumb === "low" ? "high" : "low";
    } else {
      thumb = lowDistance <= highDistance ? "low" : "high";
    }
    setActiveThumb(thumb);
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
    setActiveThumb(null);
  }

  function handleKeyDown(
    thumb: "low" | "high",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (disabled) return;
    const current = thumb === "low" ? low : high;
    const big = step * 10;
    let next = current;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = current - step;
        break;
      case "PageUp":
        next = current + big;
        break;
      case "PageDown":
        next = current - big;
        break;
      case "Home":
        next = thumb === "low" ? min : low;
        break;
      case "End":
        next = thumb === "low" ? high : max;
        break;
      default:
        return;
    }
    event.preventDefault();
    setThumb(thumb, next);
  }

  function thumbHandlers(thumb: "low" | "high") {
    return {
      role: "slider" as const,
      tabIndex: disabled ? -1 : 0,
      "aria-label": thumb === "low" ? ariaLabelLow : ariaLabelHigh,
      "aria-valuemin": thumb === "low" ? min : low,
      "aria-valuemax": thumb === "low" ? high : max,
      "aria-valuenow": thumb === "low" ? low : high,
      "aria-valuetext": formatValue(thumb === "low" ? low : high),
      "aria-orientation": "horizontal" as const,
      className: cn("slider-thumb", activeThumb === thumb && "is-active"),
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) =>
        handleKeyDown(thumb, event),
      style: { touchAction: "none" as const },
    };
  }

  return (
    <div className={cn("slider-group", className)}>
      <div
        ref={rootRef}
        className={cn("slider", disabled && "is-disabled")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => setActiveThumb(null)}
      >
        <div className="slider-track">
          <motion.div
            className="slider-fill"
            initial={false}
            animate={{
              left: `${lowPercent}%`,
              width: `${Math.max(0, highPercent - lowPercent)}%`,
            }}
            transition={activeThumb ? { duration: 0.04 } : springSoft}
          />
        </div>
        <motion.div
          {...thumbHandlers("low")}
          initial={false}
          animate={{
            left: `${lowPercent}%`,
            scaleX: activeThumb === "low" ? 1.24 : 1,
            scaleY: activeThumb === "low" ? 0.9 : 1,
          }}
          transition={activeThumb === "low" ? springSnappy : springSoft}
        />
        <motion.div
          {...thumbHandlers("high")}
          initial={false}
          animate={{
            left: `${highPercent}%`,
            scaleX: activeThumb === "high" ? 1.24 : 1,
            scaleY: activeThumb === "high" ? 0.9 : 1,
          }}
          transition={activeThumb === "high" ? springSnappy : springSoft}
        />
      </div>
      {showTicks ? (
        <div className="slider-ticks" aria-hidden="true">
          <span>{min} WPM</span>
          <span>{max} WPM</span>
        </div>
      ) : null}
    </div>
  );
}
