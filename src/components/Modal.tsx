import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { overlayTransition } from "../lib/motion";
import { GlassCard } from "./GlassCard";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, description, children }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const preferred = panelRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled])",
      );
      const focusable = preferred ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      focusable?.focus();
    }, 80);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  const host =
    typeof document === "undefined"
      ? null
      : document.getElementById("overlay-root") ?? document.body;
  if (!host) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.94, y: 14, filter: "blur(9px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, y: 8, filter: "blur(5px)" }}
            transition={overlayTransition}
            style={{ width: "min(408px, 100%)" }}
          >
            <GlassCard
              className="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descriptionId : undefined}
              style={{ width: "100%" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id={titleId} className="modal-title">
                    {title}
                  </h2>
                  {description ? (
                    <p id={descriptionId} className="modal-copy">
                      {description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="icon-button shrink-0"
                  aria-label="Close dialog"
                  onClick={onClose}
                >
                  <X size={13} strokeWidth={1.8} />
                </button>
              </div>
              {children}
            </GlassCard>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    host,
  );
}
