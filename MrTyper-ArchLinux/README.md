# MrTyper for Arch Linux

The Linux build of [MrTyper](../README.md): paste a script, set a tempo, and let MrTyper type it into whatever window you focus, with human pauses, typos and corrections.

It is the same app as the Windows version: same interface, presets, humanize engine and settings file format. Only the parts that talk to the operating system differ.

## What works where

| | X11 session | Wayland: Hyprland, Sway, river, other wlroots | Wayland: GNOME, KDE Plasma |
| --- | --- | --- | --- |
| Typing into apps | ✅ All apps, full Unicode | ✅ All apps, full Unicode | ⚠️ X11 (XWayland) apps only |
| Focus guard (stop when focus leaves) | ✅ Per window | ⚠️ Stops when you click back into MrTyper | ⚠️ Stops when you click back into MrTyper |
| Global shortcuts (F8 / F9 / Esc) | ✅ | ⚠️ Only while an XWayland app has focus | ⚠️ Only while an XWayland app has focus |

**Why the Wayland limits?** Wayland deliberately stops apps from seeing which window is focused, typing into other apps, or grabbing keys system-wide.
- **wlroots compositors** offer a virtual-keyboard protocol, which MrTyper uses.
- **GNOME and KDE** only allow this through a remote-desktop portal that asks for permission on every session, so MrTyper falls back to XWayland and shows a "Limited typing mode" notice.

For the full experience on GNOME or KDE, pick the X11 session ("GNOME on Xorg" / "Plasma (X11)") on the login screen.

On Wayland, the reliable ways to stop a run are the **Stop** button, or **clicking back into MrTyper**, which ends the run instantly.

## Install

### With the PKGBUILD (recommended)

```bash
git clone https://github.com/dyingfunds/MrTyper.git
```

```bash
cd MrTyper/MrTyper-ArchLinux/packaging/arch
```

```bash
makepkg -si
```

`makepkg -s` installs the build dependencies (`rust`, `nodejs`, `pnpm`) and the runtime libraries:
- `webkit2gtk-4.1`
- `gtk3`
- `libayatana-appindicator`
- `libxkbcommon`

It then builds MrTyper, runs the engine tests, and installs `mrtyper` with a desktop launcher and icons. Uninstall with `sudo pacman -R mrtyper`.

### AppImage

The [GitHub Actions build](../.github/workflows/build.yml) also produces an AppImage, a `.deb` and an `.rpm` for other distributions. Download them from the latest run's **Artifacts**.

## Build from source by hand

```bash
sudo pacman -S --needed base-devel rust nodejs pnpm webkit2gtk-4.1 gtk3 libayatana-appindicator libxkbcommon
```

```bash
pnpm install
```

```bash
pnpm tauri:build
```

The binary lands in `src-tauri/target/release/mrtyper`, with AppImage, `.deb` and `.rpm` bundles under `src-tauri/target/release/bundle/`. For UI work, `pnpm dev` serves a browser preview at `http://localhost:1420` that uses a mock engine and never sends keystrokes.

Run the engine tests with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Using MrTyper on Linux

- **Closing the window hides MrTyper to the system tray.** GNOME hides tray icons unless you install the *AppIndicator and KStatusNotifierItem Support* extension. Without it, simply launch MrTyper again: the running instance comes back.
- **Esc is the emergency stop** while a session runs (X11). It is registered system-wide only during the session.
- Settings, presets and your script are saved to `~/.config/com.mrtyper.desktop/mrtyper.json`.

## Troubleshooting

- **Blank or white window (often on NVIDIA):** start it with `WEBKIT_DISABLE_DMABUF_RENDERER=1 mrtyper`.
- **"couldn't connect to your display server":** MrTyper needs a graphical session. Under Wayland it also needs XWayland, which every major desktop runs by default.
- **Nothing is typed on GNOME or KDE Wayland:** the target app is a native Wayland app. Use the X11 session, or a wlroots compositor.

## How it differs from the Windows build

| | Windows | Arch Linux |
| --- | --- | --- |
| Keystrokes | `SendInput` + `KEYEVENTF_UNICODE` | XTest (X11) or `zwp_virtual_keyboard_v1` (Wayland), via [enigo](https://crates.io/crates/enigo) |
| Focus detection | `GetForegroundWindow` | `_NET_ACTIVE_WINDOW` (X11); MrTyper's own focus (Wayland) |
| Window | Mica backdrop, rounded | Opaque, square corners |
| Packaging | NSIS installer | PKGBUILD, AppImage, deb, rpm |
| Extras | — | Relaunching reveals the running window |

The platform code lives in [src-tauri/src/input.rs](src-tauri/src/input.rs). Everything else matches the Windows app.
