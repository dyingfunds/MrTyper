import { AnimatePresence, motion } from "framer-motion";
import { MousePointer2, X } from "lucide-react";
import { springSoft } from "../lib/motion";
import { GlassButton } from "./ui/Button";

interface CountdownOverlayProps {
  open: boolean;
  countdown: number | null;
  stopOnEsc: boolean;
  onCancel: () => void;
}

export function CountdownOverlay({
  open,
  countdown,
  stopOnEsc,
  onCancel,
}: CountdownOverlayProps) {
  const display = Math.max(1, countdown ?? 1);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="countdown-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <motion.div
            className="countdown-inner"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={springSoft}
          >
            <span className="countdown-kicker">
              <MousePointer2 size={10} strokeWidth={1.8} />
              Click into your target window
            </span>

            <div className="countdown-number-wrap">
              <div className="countdown-halo" aria-hidden="true" />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={display}
                  className="countdown-number"
                  initial={{ opacity: 0, scale: 0.72, filter: "blur(16px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 1.14, filter: "blur(8px)" }}
                  transition={springSoft}
                  aria-live="polite"
                >
                  {display}
                </motion.span>
              </AnimatePresence>
            </div>

            <h2 className="countdown-title">Pick your landing spot.</h2>
            <p className="countdown-copy">
              MrTyper begins typing into the window you focus.{" "}
              {stopOnEsc
                ? "Press Esc any time to stop immediately."
                : "Use your start shortcut or return to MrTyper to stop."}
            </p>
            <GlassButton
              className="countdown-cancel"
              icon={X}
              onClick={onCancel}
            >
              Cancel
            </GlassButton>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
