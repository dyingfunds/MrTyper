import type { ReactNode } from "react";
import { splitHotkey } from "../../lib/utils";

export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function HotkeyKeycaps({ accelerator }: { accelerator: string }) {
  const parts = splitHotkey(accelerator);
  return (
    <span className="hotkey">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="hotkey">
          {index > 0 ? <span className="kbd-plus">+</span> : null}
          <Keycap>{part}</Keycap>
        </span>
      ))}
    </span>
  );
}
