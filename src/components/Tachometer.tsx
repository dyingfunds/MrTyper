import { memo, useMemo, type CSSProperties } from "react";
import { clamp, cn, formatWpm } from "../lib/utils";
import { AnimatedNumber } from "./ui/AnimatedNumber";

interface TachometerProps {
  min: number;
  max: number;
  /** Live effective WPM while a session runs, otherwise null. */
  live: number | null;
  paused: boolean;
  dragging: boolean;
}

const SCALE_MIN = 10;
const SCALE_MAX = 300;
const START_ANGLE = -110;
const SWEEP = 220;
const CX = 130;
const CY = 126;
const RADIUS = 104;

function angleFor(value: number): number {
  const ratio = (clamp(value, SCALE_MIN, SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return START_ANGLE + SWEEP * ratio;
}

function polar(angle: number, radius: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [CX + radius * Math.sin(radians), CY - radius * Math.cos(radians)];
}

const ARC_PATH = (() => {
  const [x0, y0] = polar(START_ANGLE, RADIUS);
  const [x1, y1] = polar(START_ANGLE + SWEEP, RADIUS);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RADIUS} ${RADIUS} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
})();

const TICKS = Array.from({ length: 30 }, (_, index) => {
  const value = SCALE_MIN + index * 10;
  const major = value % 50 === 0 || value === SCALE_MIN;
  const angle = angleFor(value);
  const [x1, y1] = polar(angle, RADIUS - 11);
  const [x2, y2] = polar(angle, RADIUS - (major ? 20 : 16));
  return { value, major, x1, y1, x2, y2 };
});

const SCALE_LABELS = [10, 100, 200, 300].map((value) => {
  const [x, y] = polar(angleFor(value), RADIUS - 31);
  return { value, x, y };
});

/**
 * The speed dial. The lit band is the chosen WPM range; the needle rests on the
 * average and follows the real, effective speed once a session is live.
 */
export const Tachometer = memo(function Tachometer({
  min,
  max,
  live,
  paused,
  dragging,
}: TachometerProps) {
  const average = Math.round((min + max) / 2);
  const isLive = live !== null;
  const needle = isLive ? live : average;

  const band = useMemo(() => {
    const start = ((min - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 1000;
    const length = ((max - min) / (SCALE_MAX - SCALE_MIN)) * 1000;
    return {
      strokeDasharray: `${Math.max(0.01, length).toFixed(2)} 1000`,
      strokeDashoffset: (-start).toFixed(2),
    } satisfies CSSProperties;
  }, [max, min]);

  return (
    <div className={cn("tach", isLive && "is-live", dragging && "is-dragging")}>
      <svg viewBox="0 0 260 176" role="img" aria-label={`Speed range ${min} to ${max} words per minute`}>
        <path className="tach-track" d={ARC_PATH} />
        <path className="tach-band" d={ARC_PATH} pathLength={1000} style={band} />
        {TICKS.map((tick) => (
          <line
            key={tick.value}
            className={cn(
              "tach-tick",
              tick.major && "is-major",
              tick.value >= min && tick.value <= max && "is-lit",
            )}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        ))}
        {SCALE_LABELS.map((label) => (
          <text key={label.value} className="tach-scale" x={label.x} y={label.y}>
            {label.value}
          </text>
        ))}
        <g
          className="tach-needle"
          style={{ transform: `rotate(${angleFor(needle).toFixed(2)}deg)` }}
        >
          <path d={`M ${CX - 6} ${CY - RADIUS - 15} h 12 l -6 9 z`} />
          <line x1={CX} y1={CY - RADIUS - 6} x2={CX} y2={CY - RADIUS + 7} />
        </g>
      </svg>
      <div className="tach-readout">
        <AnimatedNumber
          className="tach-value"
          value={needle}
          format={isLive ? formatWpm : undefined}
        />
        <span className="tach-unit label">
          {isLive ? (
            <>
              <span className={cn("led", paused ? "is-paused" : "is-typing")} />
              {paused ? "WPM · held" : "WPM · live"}
            </>
          ) : (
            "WPM · average"
          )}
        </span>
      </div>
    </div>
  );
});
