/** Platform facts for the macOS build of MrTyper. */
export const PLATFORM = {
  id: "macos",
  /** Shown in the About section. */
  productLabel: "MrTyper for macOS",
  /** What the OS calls itself in settings copy. */
  osName: "macOS",
  /** Where the window goes when closed. */
  hideTarget: "menu bar",
  /** macOS draws the traffic-light buttons; MrTyper hides its own. */
  nativeWindowControls: true,
} as const;
