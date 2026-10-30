import type { Transition } from "framer-motion";

export const springSoft: Transition = {
  type: "spring",
  stiffness: 210,
  damping: 26,
  mass: 0.9,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 440,
  damping: 32,
  mass: 0.7,
};

export const springBouncy: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 24,
  mass: 0.8,
};

export const springGentle: Transition = {
  type: "spring",
  stiffness: 130,
  damping: 22,
  mass: 1,
};

export const pageTransition: Transition = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.8,
};

export const overlayTransition: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 28,
  mass: 0.9,
};
