import type { Transition } from "framer-motion";

/** Shared easing: a fast start that settles without overshoot. */
export const easeOut = [0.22, 1, 0.36, 1] as const;

export const springSoft: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7,
};

export const springBouncy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 22,
  mass: 0.8,
};

export const pageEnter: Transition = { duration: 0.32, ease: easeOut };
export const pageExit: Transition = { duration: 0.14, ease: "easeIn" };

export const overlayTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.8,
};
