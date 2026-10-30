import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Layers3,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { GlassCard } from "../components/GlassCard";
import { Modal } from "../components/Modal";
import { GlassButton, IconButton } from "../components/ui/Button";
import { springSoft } from "../lib/motion";
import {
  cn,
  formatDuration,
  presetTraits,
  relativeTime,
} from "../lib/utils";
import type { AppSettings, Preset } from "../types";

type Notify = (
  kind: "info" | "success" | "warning" | "error",
  title: string,
  message: string,
) => void;

interface PresetsPageProps {
  presets: Preset[];
  settings: AppSettings;
  onSavePreset: (name: string) => Promise<boolean>;
  onRenamePreset: (id: string, name: string) => Promise<boolean>;
  onDeletePreset: (id: string) => Promise<boolean>;
  onLoadPreset: (preset: Preset) => void;
  onStartFresh: () => void;
  notify: Notify;
}

type Dialog =
  | { type: "save" }
  | { type: "rename"; preset: Preset }
  | { type: "delete"; preset: Preset }
  | null;

function barHeights(seed: string): number[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: 32 }, (_, index) => {
    const mixed = Math.abs(Math.sin(hash + index * 1.73)) * 100;
    return 9 + (mixed % 34);
  });
}

export function PresetsPage({
  presets,
  settings,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  onLoadPreset,
  onStartFresh,
  notify,
}: PresetsPageProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog) return;
    setName(dialog.type === "save" ? "" : dialog.preset.name);
    setBusy(false);
  }, [dialog]);

  const currentSignature = JSON.stringify(settings.typing);

  async function submitSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      notify("warning", "Name your preset", "A short, memorable name works best.");
      return;
    }
    setBusy(true);
    const ok = await onSavePreset(trimmed);
    setBusy(false);
    if (ok) setDialog(null);
  }

  async function submitRename() {
    if (!dialog || dialog.type !== "rename") return;
    const trimmed = name.trim();
    if (!trimmed) {
      notify("warning", "Name your preset", "A preset needs a name.");
      return;
    }
    setBusy(true);
    const ok = await onRenamePreset(dialog.preset.id, trimmed);
    setBusy(false);
    if (ok) setDialog(null);
  }

  async function submitDelete() {
    if (!dialog || dialog.type !== "delete") return;
    setBusy(true);
    const ok = await onDeletePreset(dialog.preset.id);
    setBusy(false);
    if (ok) setDialog(null);
  }

  function submitDialog() {
    if (!dialog) return;
    if (dialog.type === "save") void submitSave();
    if (dialog.type === "rename") void submitRename();
    if (dialog.type === "delete") void submitDelete();
  }

  return (
    <div className="page" id="panel-presets" role="tabpanel" aria-label="Presets">
      <div className="page-heading">
        <div className="page-heading-copy">
          <span className="eyebrow">Your repertoire</span>
          <h1 className="page-title">A voice for every occasion.</h1>
          <p className="page-subtitle">
            Save the pacing, pauses, and little imperfections you like. Load a
            preset whenever the room calls for a different energy.
          </p>
        </div>
        <div className="heading-badges">
          <span className="stat-pill">
            <Layers3 size={11} strokeWidth={1.8} />
            {presets.length} saved
          </span>
          <GlassButton
            variant="confirm"
            icon={BookmarkPlus}
            onClick={() => setDialog({ type: "save" })}
          >
            Save current
          </GlassButton>
        </div>
      </div>

      {presets.length === 0 ? (
        <GlassCard>
          <div className="empty-state">
            <span className="empty-icon">
              <Layers3 size={23} strokeWidth={1.3} />
            </span>
            <h2 className="section-title">No presets on the shelf yet.</h2>
            <p className="section-hint mt-2 max-w-[320px]">
              Save the current rhythm as your first preset. You can rename it,
              tweak it, and keep a whole collection of voices.
            </p>
            <div className="mt-5 flex gap-2">
              <GlassButton
                variant="confirm"
                icon={Plus}
                onClick={() => setDialog({ type: "save" })}
              >
                Save current
              </GlassButton>
              <GlassButton icon={Sparkles} onClick={onStartFresh}>
                Build a new one
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      ) : (
        <motion.div layout className="preset-grid">
          <AnimatePresence initial={false}>
            {presets.map((preset) => {
              const isCurrent = JSON.stringify(preset.typing) === currentSignature;
              const heights = barHeights(preset.id + preset.name);
              const traits = presetTraits(preset.typing);
              return (
                <motion.div
                  key={preset.id}
                  layout
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95, filter: "blur(6px)" }}
                  transition={springSoft}
                >
                  <GlassCard className="card-pad preset-card">
                    <div className="preset-art">
                      <div className="preset-wave" aria-hidden="true">
                        {heights.map((height, index) => (
                          <span
                            key={index}
                            style={{ height, opacity: 0.3 + (height / 60) }}
                          />
                        ))}
                      </div>
                      <span className="preset-wpm">
                        {preset.typing.minWpm}–{preset.typing.maxWpm} WPM
                      </span>
                    </div>

                    <div className="preset-card-header">
                      <div className="min-w-0">
                        <h2 className="preset-name">{preset.name}</h2>
                        <p className="preset-meta">
                          {formatDuration(preset.typing.startDelaySecs)} head
                          start · updated {relativeTime(preset.updatedAt)}
                        </p>
                      </div>
                      {isCurrent ? (
                        <span className="preset-current">
                          <Check size={8} strokeWidth={2} className="mr-1" />
                          Current
                        </span>
                      ) : null}
                    </div>

                    <div className="preset-traits">
                      {traits.map((trait) => (
                        <span className="preset-trait" key={trait}>
                          {trait}
                        </span>
                      ))}
                      <span className="preset-trait">
                        {preset.typing.randomness}% random
                      </span>
                    </div>

                    <div className="preset-footer">
                      <GlassButton
                        size="sm"
                        icon={ArrowUpRight}
                        onClick={() => onLoadPreset(preset)}
                      >
                        Use preset
                      </GlassButton>
                      <div className="preset-actions">
                        <IconButton
                          label={`Rename ${preset.name}`}
                          onClick={() => setDialog({ type: "rename", preset })}
                        >
                          <Pencil size={12} strokeWidth={1.7} />
                        </IconButton>
                        <IconButton
                          label={`Delete ${preset.name}`}
                          onClick={() => setDialog({ type: "delete", preset })}
                        >
                          <Trash2 size={12} strokeWidth={1.7} />
                        </IconButton>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}

      <p className="mt-5 px-1 text-[9px] leading-relaxed text-[var(--text-faint)]">
        Presets save your performance settings — cadence, human texture, and head
        start. Appearance and shortcuts stay just the way you set them.
      </p>

      <Modal
        open={dialog?.type === "save"}
        onClose={() => setDialog(null)}
        title="Save this rhythm."
        description="Give this performance a name. You can load or revise it at any time."
      >
        <label className="modal-field">
          <span className="field-label">Preset name</span>
          <input
            className="text-field"
            value={name}
            autoFocus
            maxLength={42}
            placeholder="e.g. Late-night reply"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitSave();
              }
            }}
          />
        </label>
        <div className="modal-preview">
          <div className="modal-preview-stat">
            <strong>
              {settings.typing.minWpm}–{settings.typing.maxWpm}
            </strong>
            <span>WPM</span>
          </div>
          <div className="modal-preview-stat">
            <strong>{settings.typing.randomness}%</strong>
            <span>Random</span>
          </div>
          <div className="modal-preview-stat">
            <strong>{settings.typing.typoChance.toFixed(1)}%</strong>
            <span>Typos</span>
          </div>
          <div className="modal-preview-stat">
            <strong>{settings.typing.startDelaySecs}s</strong>
            <span>Delay</span>
          </div>
        </div>
        <div className="modal-actions">
          <GlassButton onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </GlassButton>
          <GlassButton
            variant="confirm"
            onClick={() => void submitSave()}
            disabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : "Save preset"}
          </GlassButton>
        </div>
      </Modal>

      <Modal
        open={dialog?.type === "rename"}
        onClose={() => setDialog(null)}
        title="Rename this preset."
        description="A new name, same cadence."
      >
        <label className="modal-field">
          <span className="field-label">Preset name</span>
          <input
            className="text-field"
            value={name}
            autoFocus
            maxLength={42}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitRename();
              }
            }}
          />
        </label>
        <div className="modal-actions">
          <GlassButton onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </GlassButton>
          <GlassButton
            variant="confirm"
            onClick={() => void submitRename()}
            disabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : "Rename"}
          </GlassButton>
        </div>
      </Modal>

      <Modal
        open={dialog?.type === "delete"}
        onClose={() => setDialog(null)}
        title="Remove this preset?"
        description={
          dialog?.type === "delete"
            ? `“${dialog.preset.name}” will be removed from this device. Your current session settings are untouched.`
            : undefined
        }
      >
        <div className="modal-actions">
          <GlassButton onClick={() => setDialog(null)} disabled={busy}>
            Keep it
          </GlassButton>
          <GlassButton
            variant="confirm"
            className="is-delete"
            onClick={() => void submitDelete()}
            disabled={busy}
          >
            {busy ? "Removing…" : "Delete preset"}
          </GlassButton>
        </div>
      </Modal>
    </div>
  );
}
