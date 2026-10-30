import { motion } from "framer-motion";
import { Maximize2, Minus, X } from "lucide-react";
import type { Phase } from "../types";
import { springSnappy } from "../lib/motion";
import { formatHotkey } from "../lib/utils";

interface TitleBarProps {
  phase: Phase;
  maximized: boolean;
  hotkeyStart: string;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

function statusCopy(phase: Phase): { label: string; dot: string } {
  switch (phase) {
    case "countdown":
      return { label: "Starting soon", dot: "is-counting" };
    case "typing":
      return { label: "Typing", dot: "is-live" };
    case "paused":
      return { label: "Paused", dot: "is-paused" };
    default:
      return { label: "Ready", dot: "" };
  }
}

function ControlButton({
  label,
  onClick,
  children,
  close,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  close?: boolean;
}) {
  return (
    <motion.button
      type="button"
      className={`window-control${close ? " is-close" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      transition={springSnappy}
    >
      {children}
    </motion.button>
  );
}

export function TitleBar({
  phase,
  maximized,
  hotkeyStart,
  onMinimize,
  onMaximize,
  onClose,
}: TitleBarProps) {
  const status = statusCopy(phase);

  return (
    <header className="titlebar">
      <div
        className="titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={onMaximize}
        aria-hidden="true"
      />
      <div className="titlebar-brand">
        <img className="brand-mark" src="/logo.svg" alt="" draggable={false} />
        <span className="brand-name">
          MrTyper <span>/</span>
        </span>
      </div>

      <div className="titlebar-center">
        <span className="titlebar-status">
          <span className={`status-dot ${status.dot}`} />
          {status.label}
        </span>
      </div>

      <div className="titlebar-actions">
        <div className="titlebar-shortcut">
          <span className="keycap">{formatHotkey(hotkeyStart)}</span>
          <span>anywhere</span>
        </div>
        <ControlButton label="Minimize" onClick={onMinimize}>
          <Minus size={13} strokeWidth={1.8} />
        </ControlButton>
        <ControlButton
          label={maximized ? "Restore" : "Maximize"}
          onClick={onMaximize}
        >
          {maximized ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4.4 2.2h5.4v5.4M7.6 9.8H2.2V4.4"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <Maximize2 size={12} strokeWidth={1.8} />
          )}
        </ControlButton>
        <ControlButton label="Hide to tray" onClick={onClose} close>
          <X size={13} strokeWidth={1.8} />
        </ControlButton>
      </div>
    </header>
  );
}
