import { motion } from "framer-motion";
import { springSnappy } from "../../lib/motion";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={springSnappy}
    >
      <motion.span
        className="toggle-knob"
        animate={{ x: checked ? 14 : 0 }}
        transition={springSnappy}
      />
    </motion.button>
  );
}
