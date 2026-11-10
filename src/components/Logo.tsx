interface LogoProps {
  className?: string;
  /** Blink the cursor stroke, used on the boot screen. */
  blink?: boolean;
}

/**
 * The MrTyper mark: an M whose last stroke is a text cursor. It is drawn in the
 * current accent colour so it always matches the rest of the instrument.
 */
export function Logo({ className, blink }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <path
        d="M14 46V20.5a2 2 0 0 1 3.5-1.3L27 30.4l9.5-11.2A2 2 0 0 1 40 20.5V46"
        stroke="var(--accent-ink)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        className={blink ? "logo-cursor" : undefined}
        x="46.5"
        y="15"
        width="6"
        height="34"
        rx="2"
        fill="var(--accent-ink)"
      />
    </svg>
  );
}
