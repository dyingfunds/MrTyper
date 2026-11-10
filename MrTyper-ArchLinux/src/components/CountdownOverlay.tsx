import { AnimatePresence, motion } from "framer-motion";
import { MousePointerClick, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { easeOut, springBouncy } from "../lib/motion";
import { Button } from "./ui/Button";

interface CountdownOverlayProps {
  open: boolean;
  countdown: number | null;
  /** The full head start, used to draw the sweep. */
  total: number;
  stopOnEsc: boolean;
  onCancel: () => void;
}

export const CountdownOverlay = memo(function CountdownOverlay({
  open,
  countdown,
  total,
  stopOnEsc,
  onCancel,
}: CountdownOverlayProps) {
  const display = Math.max(1, countdown ?? 1);
  const span = Math.max(1, total);
  // The sweep drains towards the moment the first key lands.
  const remaining = Math.min(1, Math.max(0, (display - 1) / span));

  // Start from a full ring, then let the CSS transition drain it second by second.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) {
      setArmed(false);
      return;
    }
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="countdown"
          role="dialog"
          aria-modal="true"
          aria-label="Typing starts soon"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={{ duration: 0.22 }}
        >
          <div className="countdown-rings" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <motion.span
            className="countdown-kicker label"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: easeOut, delay: 0.05 }}
          >
            <MousePointerClick size={14} strokeWidth={1.8} />
            Click into your target window
          </motion.span>

          <motion.div
            className="countdown-dial"
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={springBouncy}
          >
            <svg viewBox="0 0 320 320" aria-hidden="true">
              <circle className="countdown-dial-track" cx="160" cy="160" r="150" />
              <circle
                className="countdown-dial-sweep"
                cx="160"
                cy="160"
                r="150"
                pathLength={1000}
                style={{ strokeDashoffset: armed ? 1000 * (1 - remaining) : 0 }}
              />
            </svg>
            <AnimatePresence initial={false}>
              <motion.span
                key={display}
                className="countdown-number"
                initial={{ opacity: 0, y: 46, scale: 0.86 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: -46,
                  scale: 0.86,
                  transition: { duration: 0.18, ease: "easeIn" },
                }}
                transition={springBouncy}
                aria-live="assertive"
              >
                {display}
              </motion.span>
            </AnimatePresence>
          </motion.div>

          <motion.h2
            className="countdown-title"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: easeOut, delay: 0.1 }}
          >
            Pick your landing spot.
          </motion.h2>
          <motion.p
            className="countdown-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: easeOut, delay: 0.15 }}
          >
            MrTyper types into whichever window has focus when the count hits
            zero.{" "}
            {stopOnEsc
              ? "Press Esc at any time to stop instantly."
              : "Use your start shortcut or come back here to stop."}
          </motion.p>
          <motion.div
            className="countdown-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: easeOut, delay: 0.2 }}
          >
            <Button icon={X} onClick={onCancel}>
              Cancel
            </Button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
});
