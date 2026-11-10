import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { memo } from "react";
import { springSnappy } from "../lib/motion";
import { cn } from "../lib/utils";
import type { ToastMessage } from "../types";

interface ToastHostProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

function ToastIcon({ kind }: { kind: ToastMessage["kind"] }) {
  const props = { size: 16, strokeWidth: 2 };
  switch (kind) {
    case "success":
      return <CheckCircle2 {...props} />;
    case "error":
      return <XCircle {...props} />;
    case "warning":
      return <AlertTriangle {...props} />;
    default:
      return <Info {...props} />;
  }
}

export const ToastHost = memo(function ToastHost({
  toasts,
  onDismiss,
}: ToastHostProps) {
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            className={cn("toast", `is-${toast.kind}`)}
            role={toast.kind === "error" ? "alert" : "status"}
            initial={{ opacity: 0, x: 48, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{
              opacity: 0,
              x: 32,
              scale: 0.96,
              transition: { duration: 0.16, ease: "easeIn" },
            }}
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
              <X size={13} strokeWidth={2} />
            </button>
            <span className="toast-timer" aria-hidden="true" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});
