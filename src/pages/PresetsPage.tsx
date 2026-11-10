import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Modal } from "../components/Modal";
import { Button, IconButton } from "../components/ui/Button";
import { simulateCadence } from "../lib/cadence";
import { springSoft } from "../lib/motion";
import { cn, formatDuration, presetTraits, relativeTime } from "../lib/utils";
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

const VIZ_BARS = 46;

function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface PresetCardProps {
  preset: Preset;
  active: boolean;
  index: number;
  onLoad: (preset: Preset) => void;
  onRename: (preset: Preset) => void;
  onDelete: (preset: Preset) => void;
}

const PresetCard = memo(function PresetCard({
  preset,
  active,
  index,
  onLoad,
  onRename,
  onDelete,
}: PresetCardProps) {
  // The picture is the preset: a real sketch of the rhythm it will produce.
  const bars = useMemo(
    () => simulateCadence(preset.typing, VIZ_BARS, seedFrom(preset.id)),
    [preset.id, preset.typing],
  );
  const traits = presetTraits(preset.typing);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { ...springSoft, delay: Math.min(index, 8) * 0.045 },
      }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
      transition={springSoft}
    >
      <article className={cn("preset-card", active && "is-active")}>
        <div className="preset-viz" aria-hidden="true">
          {bars.map((bar, barIndex) => (
            <i
              key={barIndex}
              className={
                bar.kind === "typo" ? "is-typo" : bar.kind === "pause" ? "is-pause" : undefined
              }
              style={{ "--h": bar.level.toFixed(3), "--i": barIndex } as CSSProperties}
            />
          ))}
          {active ? (
            <span className="tag tag-accent preset-flag">
              <Check size={11} strokeWidth={2.4} />
              Active
            </span>
          ) : null}
        </div>

        <div className="preset-body">
          <div>
            <h2 className="preset-name" title={preset.name}>
              {preset.name}
            </h2>
            <p className="preset-meta">
              {formatDuration(preset.typing.startDelaySecs)} head start · updated{" "}
              {relativeTime(preset.updatedAt)}
            </p>
          </div>
          <div className="preset-speed">
            <strong>
              {preset.typing.minWpm}–{preset.typing.maxWpm}
            </strong>
            <span>wpm</span>
          </div>
          <div className="preset-tags">
            {traits.map((trait) => (
              <span className="tag" key={trait}>
                {trait}
              </span>
            ))}
            <span className="tag">{preset.typing.randomness}% random</span>
          </div>
        </div>

        <div className="preset-foot">
          <Button
            size="sm"
            className="preset-load"
            icon={ArrowUpRight}
            onClick={() => onLoad(preset)}
          >
            {active ? "Loaded" : "Load preset"}
          </Button>
          <IconButton
            label="Rename"
            tipSide="top"
            aria-label={`Rename ${preset.name}`}
            onClick={() => onRename(preset)}
          >
            <Pencil size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton
            label="Delete"
            tipSide="top"
            tone="danger"
            aria-label={`Delete ${preset.name}`}
            onClick={() => onDelete(preset)}
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      </article>
    </motion.div>
  );
});

export const PresetsPage = memo(function PresetsPage({
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

  const currentSignature = useMemo(
    () => JSON.stringify(settings.typing),
    [settings.typing],
  );

  const openRename = useMemo(
    () => (preset: Preset) => setDialog({ type: "rename", preset }),
    [],
  );
  const openDelete = useMemo(
    () => (preset: Preset) => setDialog({ type: "delete", preset }),
    [],
  );

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

  const typing = settings.typing;

  return (
    <div className="page-scroll" id="panel-presets" role="tabpanel" aria-label="Presets">
      <div className="page-inner">
        <header className="page-head rise">
          <div>
            <span className="page-kicker label">
              {presets.length} {presets.length === 1 ? "preset" : "presets"} saved
            </span>
            <h1 className="page-title">A rhythm for every room.</h1>
            <p className="page-sub">
              Each card is drawn from the preset itself: bar height is speed,
              gaps are pauses, red marks are typos. Load one and it takes over
              the deck.
            </p>
          </div>
          <div className="page-head-actions">
            <Button
              variant="primary"
              size="lg"
              icon={BookmarkPlus}
              onClick={() => setDialog({ type: "save" })}
            >
              Save current rhythm
            </Button>
          </div>
        </header>

        {presets.length === 0 ? (
          <div className="empty rise" style={{ "--i": 1 } as CSSProperties}>
            <h2 className="empty-title">Nothing saved yet.</h2>
            <p className="empty-copy">
              Dial in a rhythm on the Type tab, then save it here. You can keep
              as many voices as you like and switch between them in one click.
            </p>
            <div className="empty-actions">
              <Button
                variant="primary"
                icon={BookmarkPlus}
                onClick={() => setDialog({ type: "save" })}
              >
                Save current rhythm
              </Button>
              <Button icon={SlidersHorizontal} onClick={onStartFresh}>
                Back to the deck
              </Button>
            </div>
          </div>
        ) : (
          <div className="preset-grid">
            <AnimatePresence>
              {presets.map((preset, index) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  index={index}
                  active={JSON.stringify(preset.typing) === currentSignature}
                  onLoad={onLoadPreset}
                  onRename={openRename}
                  onDelete={openDelete}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        <p className="page-note">
          Presets store the performance only: tempo, head start, and every
          humanize setting. Theme, shortcuts, and safety stay as you set them.
        </p>
      </div>

      <Modal
        open={dialog?.type === "save"}
        onClose={() => setDialog(null)}
        title="Save this rhythm."
        description="Give the current deck settings a name. You can load, rename, or delete it later."
      >
        <div className="modal-body">
          <label className="field">
            <span className="label">Preset name</span>
            <input
              className="text-field"
              value={name}
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
          <div className="modal-stats">
            <div className="modal-stat">
              <span className="label">WPM</span>
              <strong>
                {typing.minWpm}–{typing.maxWpm}
              </strong>
            </div>
            <div className="modal-stat">
              <span className="label">Random</span>
              <strong>{typing.randomness}%</strong>
            </div>
            <div className="modal-stat">
              <span className="label">Typos</span>
              <strong>
                {typing.typosEnabled ? `${typing.typoChance.toFixed(1)}%` : "off"}
              </strong>
            </div>
            <div className="modal-stat">
              <span className="label">Delay</span>
              <strong>{typing.startDelaySecs}s</strong>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submitSave()}
            disabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : "Save preset"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={dialog?.type === "rename"}
        onClose={() => setDialog(null)}
        title="Rename preset."
        description="A new name, the same rhythm."
      >
        <div className="modal-body">
          <label className="field">
            <span className="label">Preset name</span>
            <input
              className="text-field"
              value={name}
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
        </div>
        <div className="modal-actions">
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submitRename()}
            disabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : "Rename"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={dialog?.type === "delete"}
        onClose={() => setDialog(null)}
        title="Delete this preset?"
        description={
          dialog?.type === "delete"
            ? `“${dialog.preset.name}” will be removed from this device. Your current deck settings are not affected.`
            : undefined
        }
      >
        <div className="modal-actions">
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Keep it
          </Button>
          <Button
            variant="danger-solid"
            onClick={() => void submitDelete()}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete preset"}
          </Button>
        </div>
      </Modal>
    </div>
  );
});
