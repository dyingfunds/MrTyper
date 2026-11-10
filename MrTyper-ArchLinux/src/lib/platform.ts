/** Platform facts for the Arch Linux build of MrTyper. */
export const PLATFORM = {
  id: "linux",
  /** Shown in the About section. */
  productLabel: "MrTyper for Arch Linux",
  /** What the OS calls itself in settings copy. */
  osName: "Linux",
  /** Where the window goes when closed. */
  hideTarget: "system tray",
  /** MrTyper draws its own minimize / maximize / close buttons. */
  nativeWindowControls: false,
} as const;
