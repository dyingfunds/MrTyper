import { animate, useReducedMotionConfig } from "framer-motion";
import { useEffect, useRef } from "react";

interface AnimatedNumberProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
}

const defaultFormat = (value: number) => Math.round(value).toString();

/**
 * A spring-damped numeric readout. Frames are written straight to the text node,
 * so a counting number never re-renders its parent.
 */
export function AnimatedNumber({
  value,
  format = defaultFormat,
  className,
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotionConfig();
  const nodeRef = useRef<HTMLSpanElement>(null);
  const currentRef = useRef(value);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (reducedMotion || currentRef.current === value) {
      currentRef.current = value;
      node.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(currentRef.current, value, {
      type: "spring",
      stiffness: 190,
      damping: 28,
      mass: 0.8,
      onUpdate: (latest) => {
        currentRef.current = latest;
        node.textContent = formatRef.current(latest);
      },
    });
    return () => controls.stop();
  }, [reducedMotion, value]);

  return (
    <span ref={nodeRef} className={className}>
      {format(currentRef.current)}
    </span>
  );
}
