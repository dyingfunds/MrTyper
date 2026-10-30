import {
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/utils";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}

/**
 * A frosted panel with a cursor-tracking specular bloom. The bloom is updated
 * through CSS custom properties so pointer movement never triggers React renders.
 */
export function GlassCard({
  children,
  className,
  innerClassName,
  onPointerMove,
  ...props
}: GlassCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const node = ref.current;
    if (node) {
      const bounds = node.getBoundingClientRect();
      node.style.setProperty("--mouse-x", `${event.clientX - bounds.left}px`);
      node.style.setProperty("--mouse-y", `${event.clientY - bounds.top}px`);
    }
    onPointerMove?.(event);
  }

  return (
    <div
      ref={ref}
      className={cn("glass-panel", className)}
      onPointerMove={handlePointerMove}
      {...props}
    >
      <div className="glass-cursor-glow" aria-hidden="true" />
      <div className={cn("glass-content", innerClassName)}>{children}</div>
    </div>
  );
}
