import { Minus, Square, X } from "lucide-react";
import { memo, type ReactNode } from "react";
import type { Phase } from "../types";
import { cn, formatHotkey } from "../lib/utils";
import { Keycap } from "./ui/Keycap";
import { Logo } from "./Logo";
import { PLATFORM } from "../lib/platform";

interface TitleBarProps {
  phase: Phase;
  /** 0–100 while a session is typing. */
  progress: number;
  maximized: boolean;
  hotkeyStart: string;
  hotkeyPause: string;
  stopOnEsc: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

function statusLabel(phase: Phase, progress: number): string {
  switch (phase) {
    case "countdown":
      return "Get ready";
    case "typing":
      return `Typing ${progress}%`;
    case "paused":
      return `Paused ${progress}%`;
    default:
      return "Ready";
  }
}

function ControlButton({
  label,
  onClick,
  close,
  children,
}: {
  label: string;
  onClick: () => void;
  close?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn("window-control", close && "is-close")}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const TitleBar = memo(function TitleBar({
  phase,
  progress,
  maximized,
  hotkeyStart,
  hotkeyPause,
  stopOnEsc,
  onMinimize,
  onMaximize,
  onClose,
}: TitleBarProps) {
  return (
    <header className="titlebar">
      <div
        className="titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={onMaximize}
        aria-hidden="true"
      />
      <div className="brand">
        <Logo className="brand-mark" />
        <span className="brand-name">
          Mr<em>Typer</em>
        </span>
      </div>

      <div
        className={cn("titlebar-status", `is-${phase}`)}
        role="status"
        aria-live="polite"
      >
        <span className={cn("led", `is-${phase}`)} />
        {statusLabel(phase, progress)}
      </div>

      <div className="titlebar-right">
        <div className="titlebar-hints" aria-hidden="true">
          <span className="titlebar-hint">
            <Keycap>{formatHotkey(hotkeyStart)}</Keycap> start / stop
          </span>
          <span className="titlebar-hint">
            <Keycap>{formatHotkey(hotkeyPause)}</Keycap> pause
          </span>
          {stopOnEsc ? (
            <span className="titlebar-hint">
              <Keycap>Esc</Keycap> panic
            </span>
          ) : null}
        </div>
        {PLATFORM.nativeWindowControls ? null : (
          <>
        <ControlButton label="Minimize" onClick={onMinimize}>
          <Minus size={15} strokeWidth={1.6} />
        </ControlButton>
        <ControlButton
          label={maximized ? "Restore" : "Maximize"}
          onClick={onMaximize}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M3.5 3.5V1.5h7v7h-2M1.5 3.5h7v7h-7z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <Square size={12} strokeWidth={1.7} />
          )}
        </ControlButton>
        <ControlButton label="Hide to tray" onClick={onClose} close>
          <X size={16} strokeWidth={1.6} />
        </ControlButton>
          </>
        )}
      </div>
    </header>
  );
});
