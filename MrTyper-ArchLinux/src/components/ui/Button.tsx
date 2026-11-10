import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Variant = "default" | "primary" | "ghost" | "danger" | "danger-solid";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  children?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  icon: Icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        variant !== "default" && `btn-${variant}`,
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        className,
      )}
      {...props}
    >
      {Icon ? <Icon size={size === "sm" ? 13 : 15} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: "default" | "danger";
  tipSide?: "top" | "bottom";
  children?: ReactNode;
}

export function IconButton({
  label,
  tone = "default",
  tipSide = "bottom",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      data-tip-side={tipSide}
      className={cn("icon-btn", tone === "danger" && "is-danger", className)}
      {...props}
    >
      {children}
    </button>
  );
}
