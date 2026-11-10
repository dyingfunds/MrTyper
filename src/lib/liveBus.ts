import type { KeystrokePayload } from "../types";

export type StrokeKind = KeystrokePayload["kind"];

export interface Stroke {
  kind: StrokeKind;
  /** `performance.now()` at the moment the event reached the UI. */
  time: number;
}

type Listener = (stroke: Stroke) => void;

const listeners = new Set<Listener>();

/**
 * Keystrokes arrive up to ~25 times a second. Routing them through React state
 * would re-render the whole tree for every key, so they travel on this tiny bus
 * instead and are drawn imperatively by whoever is listening.
 */
export const liveBus = {
  emit(kind: StrokeKind): void {
    if (listeners.size === 0) return;
    const stroke: Stroke = { kind, time: performance.now() };
    for (const listener of listeners) listener(stroke);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
