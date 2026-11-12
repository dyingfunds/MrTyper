import { useEffect, useRef } from "react";

/** ↑ ↑ ↓ ↓ ← → ← → B A, compared by event.key. */
const CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * A small easter egg: the Konami code, typed anywhere outside a text field,
 * calls `onUnlock`. Keys in the script editor or a value field never count.
 */
export function useKonamiCode(onUnlock: () => void): void {
  const position = useRef(0);
  const callback = useRef(onUnlock);
  callback.current = onUnlock;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.repeat) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === CODE[position.current]) {
        position.current += 1;
        if (position.current === CODE.length) {
          position.current = 0;
          callback.current();
        }
      } else {
        position.current = key === CODE[0] ? 1 : 0;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

/** Spin the title-bar logo once. Reduced motion skips the spin in CSS. */
export function celebrate(): void {
  const root = document.documentElement;
  root.classList.remove("is-celebrating");
  // Restart the animation if the code is entered twice in a row.
  void root.offsetWidth;
  root.classList.add("is-celebrating");
  window.setTimeout(() => root.classList.remove("is-celebrating"), 1400);
}
