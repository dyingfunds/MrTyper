# Changelog

All notable changes to MrTyper. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Consolidated the platform layer.** The three apps now differ only in their designated platform files:
  - `src/lib/platform.ts` (UI wording and window-chrome flags);
  - `src-tauri/src/input.rs` (keystrokes and focus);
  - `src-tauri/Cargo.toml`, `Cargo.lock` and `tauri.conf.json`;
  - icons and `README.md`.

  Everything else is identical. `lib.rs` uses compile-time switches for the Windows backdrop and the macOS Dock reopen, and every `input.rs` exposes the same API, so `engine.rs` is shared.
- **Windows: launching MrTyper again now brings back the running window**, matching macOS and Linux (single-instance plugin).

### Added

- `scripts/check-platform-sync.mjs`: reports, or with `--fix` repairs, any drift between the root app and the macOS and Linux copies. It runs first in CI and gates releases.
- `scripts/cross-check.mjs`: type-checks or lints the macOS and Linux apps from any machine, Windows included.
- `AGENTS.md`: a hand-over guide to the repository for developers and AI assistants. `CLAUDE.md` points to it.

### Removed

- Dead code left over from 1.0: `smoothstep()` and `pluralize()`, the unused CSS classes `.hairline`, `.tag-danger` and `.sr-only` (Tailwind ships its own `sr-only`), and the unused `ghost` and `danger` button variants.

### Fixed

- Clippy warnings in the settings and store tests.

## [2.0.0] - 2026-11-09

The redesign release, and the first with macOS and Linux apps. Ready-made installers for every platform are on the [GitHub release](https://github.com/dyingfunds/MrTyper/releases/tag/v2.0.0).

### Added

- **MrTyper for macOS** (`MrTyper-macOS/`), for macOS 11+ on Apple Silicon and Intel:
  - **Keystrokes:** Quartz `CGEvent` with Unicode strings, via `enigo`.
  - **Permission:** an Accessibility check runs before the countdown and opens the system prompt if access is missing.
  - **Focus guard:** works per app, using the frontmost application.
  - **Window:** native traffic-light buttons; clicking the Dock icon reopens it.
  - **Package:** a universal `.app` and `.dmg`, ad-hoc signed.
- **MrTyper for Arch Linux** (`MrTyper-ArchLinux/`). It uses exactly one keystroke backend per session, because enigo sends through every backend it connects and two would type every key twice:
  - **X11:** XTest, with the focus guard reading `_NET_ACTIVE_WINDOW`.
  - **wlroots Wayland compositors:** `zwp_virtual_keyboard_v1`.
  - **GNOME and KDE on Wayland:** an XWayland fallback, with a "Limited typing mode" warning.

  Packaging: a PKGBUILD with a desktop entry and icons, plus AppImage, `.deb` and `.rpm`.
- **GitHub Actions** (`.github/workflows/build.yml`) builds and tests all three apps on real Windows, macOS and Ubuntu machines, and runs the PKGBUILD in an Arch container. Pushing a `v*` tag publishes a GitHub Release with every installer and a `SHA256SUMS.txt`.
- **Live script stage:** delivered text inks in behind a glowing caret, which flashes red on typos.
- **Tachometer:** shows the WPM range as a lit band; the needle follows the real effective speed while typing.
- **Cadence scope:** previews the rhythm the current settings will produce, then records every keystroke, typo and correction live.
- **Preset cards** are drawn from each preset's own simulated rhythm.
- **Four accent colours** (Volt, Ember, Ice, Orchid), plus light and dark themes.
- **A Motion setting** (System / Full / Reduced). It defaults to the OS reduced-motion preference.
- **Drag and drop** a text file onto the stage to load it.
- **Ctrl+1/2/3** switch tabs.
- **The elapsed clock keeps ticking** through long thinking pauses.
- **`scripts/build-release.mjs`** strips build-machine paths, and so the builder's user name, from release binaries. `pnpm tauri:build` runs it.

### Changed

- **Complete visual redesign.** The glass interface is replaced by a matte graphite "instrument" design:
  - a navigation rail, hardware-style faders and humanize keys;
  - new type (Geist, Geist Mono, Bricolage Grotesque);
  - a new logo (an M whose last stroke is a text cursor), app icons, installer artwork and README screenshots.
- **The Type page layout:** script stage, control deck and transport bar. A compact layout switches on for windows under 920 px tall, and the dial shrinks under 760 px.
- **Version 2.0.0** everywhere: manifests, the app UI, installer names and the README.

### Performance

- Keystroke events bypass React entirely. A tiny event bus feeds a canvas, so a 300 WPM session never re-renders the component tree.
- Progress events are coalesced to one React commit per animation frame.
- Removed every `backdrop-filter`, every blur transition and the always-running ambient animations. Decorative animation pauses while the window is hidden.
- Numbers animate by writing straight to the DOM, and sliders move by a CSS custom property, so neither re-renders its parent.
- Script statistics use a deferred value, so counting a long script never delays typing in the editor.

### Fixed

- A run started from the global hotkey or the tray now resets the readouts. Previously its events were ignored because of a stale run id.
- Light theme contrast: unlit tracks and thin accent marks were nearly invisible.
- The Ember accent made typo marks indistinguishable from normal keys; typos and Stop now use rose on Ember.
- At the minimum window size, the Start button label wrapped and the control deck had to scroll.

### Removed

- The glass components (`AmbientBackground`, `GlassCard`, `Tabs`) and the Inter font.

## [1.0.0]

Initial release: a Windows app with a liquid-glass interface, the human-cadence typing engine, presets, global hotkeys, the tray, and an NSIS installer.

[Unreleased]: https://github.com/dyingfunds/MrTyper/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/dyingfunds/MrTyper/releases/tag/v2.0.0
