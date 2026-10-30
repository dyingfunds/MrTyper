import { motion } from "framer-motion";
import { Layers3, Settings2, Type } from "lucide-react";
import type { TabId } from "../types";
import { springSoft } from "../lib/motion";

const tabs: Array<{ id: TabId; label: string; icon: typeof Type }> = [
  { id: "type", label: "Type", icon: Type },
  { id: "presets", label: "Presets", icon: Layers3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

interface TabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function Tabs({ active, onChange }: TabsProps) {
  return (
    <div className="tabs-shell" role="tablist" aria-label="MrTyper sections">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            className={`tab-button${isActive ? " is-active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {isActive ? (
              <motion.span
                layoutId="tab-indicator"
                className="tab-indicator"
                transition={springSoft}
              />
            ) : null}
            <Icon size={12} strokeWidth={isActive ? 2 : 1.7} />
            <span className="relative z-[2]">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
