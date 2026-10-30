import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Info,
  X,
} from "lucide-react";
import type { ToastMessage } from "../types";
import { springSnappy } from "../lib/motion";
import { cn } from "../lib/utils";

interface ToastHostProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

function ToastIcon({ kind }: { kind: ToastMessage["kind"] }) {
  const props = { size: 12, strokeWidth: 2 };
  switch (kind) {
    case "success":
      return <Check {...props} />;
    case "error":
      return <AlertCircle {...props} />;
    case "warning":
      return <AlertTriangle {...props} />;
    default:
      return <Info {...props} />;
  }
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            className={cn("toast", `is-${toast.kind}`)}
            role={toast.kind === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: 18, scale: 0.94, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(6px)" }}
            transition={springSnappy}
          >
            <span className="toast-icon">
              <ToastIcon kind={toast.kind} />
            </span>
            <span className="toast-copy">
              {toast.title ? <span className="toast-title">{toast.title}</span> : null}
              <span className="toast-message">{toast.message}</span>
            </span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(toast.id)}
            >
              <X size={10} strokeWidth={2} />
            </button>
            <span className="toast-progress" aria-hidden="true" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
