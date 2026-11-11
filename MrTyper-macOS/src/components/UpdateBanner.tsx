import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { memo } from "react";
import { springSnappy } from "../lib/motion";
import { updateTitle, type UpdateState } from "../lib/updates";
import { Button } from "./ui/Button";

interface UpdateBannerProps {
  update: UpdateState;
  /** The available-update notice was closed with "Later". */
  dismissed: boolean;
  /** A typing session is running, so installing has to wait. */
  busy: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * Says a new version is out and installs it only when asked. While it
 * downloads and installs, it shows progress instead.
 */
export const UpdateBanner = memo(function UpdateBanner({
  update,
  dismissed,
  busy,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  const visible =
    (update.status === "available" && !dismissed) ||
    update.status === "downloading" ||
    update.status === "installed";
  const percent = update.status === "downloading" ? update.percent : null;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="update"
          className="update-banner"
          role="status"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={springSnappy}
        >
          <Download size={16} strokeWidth={1.9} className="update-banner-icon" />
          <div className="update-banner-copy">
            <strong>{updateTitle(update)}</strong>
            <span>
              {update.status === "available"
                ? busy
                  ? "You can update once this session ends."
                  : update.canInstall
                    ? "Install it now? MrTyper restarts when it's done."
                    : "Get it from the download page."
                : "MrTyper restarts by itself when it's done."}
            </span>
            {update.status === "downloading" ? (
              <div className="update-banner-bar" aria-hidden="true">
                <i
                  className={percent === null ? "is-indeterminate" : undefined}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
            ) : null}
          </div>
          {update.status === "available" ? (
            <div className="update-banner-actions">
              <Button variant="primary" onClick={onInstall} disabled={busy}>
                {update.canInstall ? "Update" : "Download"}
              </Button>
              <button
                type="button"
                className="update-banner-close"
                aria-label="Later"
                title="Later"
                onClick={onDismiss}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
});
