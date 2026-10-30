import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
}

/**
 * A spring-damped numeric readout. Motion values update the DOM through React state,
 * but only while a parent value is actually changing.
 */
export function AnimatedNumber({
  value,
  format = (next) => Math.round(next).toString(),
  className,
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const formatRef = useRef(format);
  const [display, setDisplay] = useState(() => format(value));

  formatRef.current = format;

  useMotionValueEvent(motionValue, "change", (latest) => {
    setDisplay(formatRef.current(latest));
  });

  useEffect(() => {
    if (reducedMotion) {
      motionValue.set(value);
      setDisplay(formatRef.current(value));
      return;
    }
    const controls = animate(motionValue, value, {
      type: "spring",
      stiffness: 160,
      damping: 24,
      mass: 0.9,
    });
    return () => controls.stop();
  }, [motionValue, reducedMotion, value]);

  return <span className={className}>{display}</span>;
}
