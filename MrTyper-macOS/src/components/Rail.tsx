import { motion } from "framer-motion";
import { Keyboard, Library, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { memo } from "react";
import { springSnappy } from "../lib/motion";
import { cn } from "../lib/utils";
import type { ResolvedTheme, TabId } from "../types";

export const TAB_ORDER: TabId[] = ["type", "presets", "settings"];

const tabs: Array<{ id: TabId; label: string; icon: typeof Keyboard }> = [
  { id: "type", label: "Type", icon: Keyboard },
  { id: "presets", label: "Presets", icon: Library },
  { id: "settings", label: "Setup", icon: SlidersHorizontal },
];

interface RailProps {
  active: TabId;
  theme: ResolvedTheme;
  onChange: (tab: TabId) => void;
  onToggleTheme: () => void;
}

export const Rail = memo(function Rail({
  active,
  theme,
  onChange,
  onToggleTheme,
}: RailProps) {
  return (
    <nav className="rail" aria-label="MrTyper sections">
      <div role="tablist" aria-orientation="vertical" className="contents">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              title={`${tab.label} (Ctrl+${index + 1})`}
              className={cn("rail-button", isActive && "is-active")}
              onClick={() => onChange(tab.id)}
            >
              {isActive ? (
                <motion.span
                  layoutId="rail-pill"
                  className="rail-pill"
                  transition={springSnappy}
                />
              ) : null}
              <Icon size={19} strokeWidth={1.7} />
              <span className="rail-label">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="rail-spacer" />

      <button
        type="button"
        className="rail-tool"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
        onClick={onToggleTheme}
      >
        {theme === "dark" ? (
          <Sun size={16} strokeWidth={1.8} />
        ) : (
          <Moon size={16} strokeWidth={1.8} />
        )}
      </button>
      <span className="rail-version">v{__APP_VERSION__.split(".").slice(0, 2).join(".")}</span>
    </nav>
  );
});
