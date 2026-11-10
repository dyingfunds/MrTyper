# MrTyper for macOS

The macOS build of [MrTyper](../README.md): paste a script, set a tempo, and let MrTyper type it into whatever app you focus, with human pauses, typos and corrections.

It is the same app as the Windows version: same interface, presets, humanize engine and settings file format. Only the parts that talk to the operating system differ, and the window uses the native traffic-light buttons.

**Requires macOS 11 Big Sur or later.** The app is a universal binary, so it runs natively on both Apple Silicon and Intel Macs.

## Install

1. Download `MrTyper_…_universal.dmg` from the **[latest release](https://github.com/dyingfunds/MrTyper/releases/latest)** and open it. It's ready to use, so you don't need to build anything.
2. Drag **MrTyper** into **Applications**.
3. The app is ad-hoc signed, not notarised by Apple, so the first launch is blocked. Either:
   - right-click (or Control-click) MrTyper in Applications, choose **Open**, then **Open** again; or
   - run `xattr -dr com.apple.quarantine /Applications/MrTyper.app` in Terminal.
4. **Grant Accessibility access.** The first time you start typing, macOS asks whether MrTyper may control your computer.
   - Open **System Settings → Privacy & Security → Accessibility** and turn **MrTyper** on.
   - Then press Start again.

macOS requires this permission for any app that types into other apps. MrTyper checks for it before the countdown starts, so you're never told to switch apps for nothing.

## Using MrTyper on macOS

- **Shortcuts.** F8 starts or stops, F9 pauses. On Mac keyboards the function keys control media by default, so hold **fn**, or rebind to a chord such as Ctrl + Shift + Space in Setup → Shortcuts. **Esc** is the emergency stop while a session runs.
- **Focus guard.** "Stop when focus leaves" stops a run when you switch to a different app. macOS doesn't let apps see other apps' windows without Screen Recording permission, so switching windows *inside* the same app is not detected.
- **Closing the window hides MrTyper** to the menu bar. Click its Dock icon, or the menu bar icon, to bring it back. Quit from the menu bar icon or with ⌘Q.
- Settings, presets and your script are saved to `~/Library/Application Support/com.mrtyper.desktop/mrtyper.json`.

## Build from source

You need a Mac with the Xcode Command Line Tools (`xcode-select --install`), [Rust](https://rustup.rs), Node.js 20.19+ and pnpm 10+.

```bash
pnpm install
```

```bash
pnpm tauri:build
```

The app lands in `src-tauri/target/release/bundle/macos/MrTyper.app`, with a `.dmg` beside it in `bundle/dmg/`. For a universal binary, add both Rust targets and build for `universal-apple-darwin`:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

```bash
pnpm tauri:build --target universal-apple-darwin
```

For UI work, `pnpm dev` serves a browser preview at `http://localhost:1420` that uses a mock engine and never sends keystrokes. Run the engine tests with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Troubleshooting

- **"MrTyper needs Accessibility access" even after allowing it:** macOS ties the permission to the exact app build. After installing a new version, remove MrTyper from the Accessibility list with the **–** button, then add it again.
- **"MrTyper is damaged and can't be opened":** that's the quarantine flag on an unnotarised download. Run the `xattr` command from step 3.

## How it differs from the Windows build

| | Windows | macOS |
| --- | --- | --- |
| Keystrokes | `SendInput` + `KEYEVENTF_UNICODE` | Quartz `CGEvent` with Unicode strings, via [enigo](https://crates.io/crates/enigo) |
| Permission | None (same privilege level as the target) | Accessibility access |
| Focus detection | Foreground window | Frontmost application |
| Window | Custom buttons, Mica backdrop | Native traffic lights, opaque |
| Packaging | NSIS installer | Universal `.app` and `.dmg` |
| Extras | — | Dock icon and relaunch reveal the hidden window |

The platform code lives in [src-tauri/src/input.rs](src-tauri/src/input.rs). Everything else matches the Windows app.
