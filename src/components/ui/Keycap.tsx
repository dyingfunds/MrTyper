import { splitHotkey } from "../../lib/utils";

export function Keycap({ children }: { children: React.ReactNode }) {
  return <kbd className="keycap">{children}</kbd>;
}

export function HotkeyKeycaps({ accelerator }: { accelerator: string }) {
  const parts = splitHotkey(accelerator);
  return (
    <>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {index > 0 ? <span className="hotkey-plus">+</span> : null}
          <Keycap>{part}</Keycap>
        </span>
      ))}
    </>
  );
}
