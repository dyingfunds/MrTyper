import { motion, type HTMLMotionProps } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { springBouncy, springSnappy } from "../../lib/motion";
import { cn } from "../../lib/utils";

type Variant = "default" | "danger" | "ghost" | "confirm";

interface GlassButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: "md" | "sm";
  icon?: LucideIcon;
  children?: ReactNode;
}

export function GlassButton({
  variant = "default",
  size = "md",
  icon: Icon,
  className,
  children,
  disabled,
  ...props
}: GlassButtonProps) {
  return (
    <motion.button
      type="button"
      className={cn(
        "btn",
        variant === "danger" && "btn-danger",
        variant === "ghost" && "btn-ghost",
        variant === "confirm" && "btn-confirm",
        size === "sm" && "btn-sm",
        className,
      )}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97, y: 0 }}
      transition={springSnappy}
      disabled={disabled}
      {...props}
    >
      {Icon ? <Icon size={size === "sm" ? 12 : 13} strokeWidth={1.8} /> : null}
      {children}
    </motion.button>
  );
}

interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  label: string;
  children?: ReactNode;
  tone?: "default" | "danger";
}

export function IconButton({
  label,
  children,
  className,
  tone = "default",
  ...props
}: IconButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      className={cn("icon-button", className)}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.92 }}
      transition={springSnappy}
      style={tone === "danger" ? { color: undefined } : undefined}
      {...props}
    >
      {children}
    </motion.button>
  );
}

interface StartButtonProps {
  onClick: () => void;
  disabled?: boolean;
  mode: "start" | "stop";
  label: string;
  icon: React.ReactNode;
}

export function StartButton({
  onClick,
  disabled,
  mode,
  label,
  icon,
}: StartButtonProps) {
  return (
    <div className="btn-start-wrap">
      <motion.div
        className="btn-start-aura"
        aria-hidden="true"
        animate={{ opacity: [0.4, 0.65, 0.4], scale: [0.98, 1.03, 0.98] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.button
        type="button"
        className={cn("btn-start", mode === "stop" && "is-stop")}
        disabled={disabled}
        onClick={onClick}
        whileHover={disabled ? undefined : { scale: 1.012 }}
        whileTap={
          disabled
            ? undefined
            : { scaleX: 1.025, scaleY: 0.94, transition: springBouncy }
        }
        transition={springSnappy}
      >
        <span className="btn-start-icon">{icon}</span>
        <span>{label}</span>
      </motion.button>
    </div>
  );
}
