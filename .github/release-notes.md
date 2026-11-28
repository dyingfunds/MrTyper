## Download

Pick the file for your system below. Everything is ready to use, so you don't need to build anything.

| System | File | How to install |
| --- | --- | --- |
| **Windows** 10/11 | `MrTyper_…_x64-setup.exe` | Double-click and follow the installer. If SmartScreen appears, choose **More info → Run anyway**. |
| **macOS** 11+ (Apple Silicon and Intel) | `MrTyper_…_universal.dmg` | Open it and drag MrTyper into Applications. The first launch is blocked: on macOS 15+, click **Done**, then **System Settings → Privacy & Security → Open Anyway**; on macOS 11–14, right-click MrTyper → **Open** → **Open**. Allow **Accessibility** access when asked. |
| **Arch Linux** | `mrtyper-…-x86_64.pkg.tar.zst` | `sudo pacman -U mrtyper-*.pkg.tar.zst` |
| **Ubuntu / Debian** | `MrTyper_…_amd64.deb` | `sudo apt install ./MrTyper_*_amd64.deb` |
| **Fedora / openSUSE** | `MrTyper-….x86_64.rpm` | `sudo dnf install ./MrTyper-*.x86_64.rpm` |
| **Any Linux** | `MrTyper_…_amd64.AppImage` | `chmod +x MrTyper_*.AppImage`, then run it. |

`SHA256SUMS.txt` lists checksums for every file.

## Good to know

- **Start typing:** paste a script, press **Start typing** (or F8), then click into the app you want to type into during the countdown. **Esc** stops instantly.
- **macOS:** MrTyper isn't notarised by Apple, so you have to allow the first launch: on macOS 15 Sequoia and later, use **Open Anyway** in **System Settings → Privacy & Security** (right-click → Open no longer works there); on older versions, right-click → Open. It also needs Accessibility access to type into other apps.
- **Updates:** from 2.1.0 on, MrTyper checks for new versions when it opens and offers to install them; nothing installs until you click Update. Coming from 2.0.0, install this version by hand once.
- **Formatting in Google Docs:** write `{{bold}}`, `{{h1}}`, `{{bigger}}`, `{{bullets}}` and more in a script and MrTyper presses the shortcut instead of typing it.
- **New in 2.6.0:** low detail while typing (on by default in **Setup → Appearance**) cuts the window's CPU use during a run by about 80%, the engine sleeps between keys, and the Windows installer is Graphite & Yellow.
- **New in 2.5.0:** several custom palettes, time and words left in the mini window, a Graphite & Yellow app icon, and command highlights that stay in place on Linux.
- **New in 2.4.0:** four colour palettes (Graphite & Yellow, Bougainvillea, Cocoa & Sky, Sage & Tomato) and a custom palette from any three colours, in **Setup → Appearance → Colours**.
- **New in 2.3.0:** type `/` or `{{` in a script for a list of matching commands, carry on from where a stopped session got to (or from the cursor), and four new presets: Slow & realistic, Hunt & peck, Typo storm and Tired, late night.
- **New in 2.2.1:** on Linux, the floating mini window is the right size again and sits at the top centre of the screen.
- **New in 2.2.0:** open `.docx` and `.md` files with their formatting kept, `{{hold}}` to wait for the pause key, more pause lengths, **Finish in** to fit the tempo to a time, a floating mini window while typing, preset export and import, and a calmer look.
- **Linux:** everything works on X11 and on Hyprland, Sway and other wlroots Wayland compositors. On GNOME or KDE Wayland, MrTyper can only type into X11 apps, so pick the X11 session at login for the full experience.

Full guides: [Windows](https://github.com/dyingfunds/MrTyper#readme) · [macOS](https://github.com/dyingfunds/MrTyper/tree/main/MrTyper-macOS#readme) · [Arch Linux](https://github.com/dyingfunds/MrTyper/tree/main/MrTyper-ArchLinux#readme)
