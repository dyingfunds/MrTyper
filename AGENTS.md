# MrTyper: guide for developers and AI assistants

Read this before changing anything. It explains how the repository is put together, how to verify changes on every platform (even from a Windows machine), how releases work, and the traps already found. History lives in [CHANGELOG.md](CHANGELOG.md); user-facing docs are the READMEs.

## What MrTyper is

A desktop app that types a script into whatever window the user focuses, with human-like rhythm: WPM range, randomness, punctuation, line-break and thinking pauses, bursts, QWERTY typos with corrections, and fatigue. It's built with **Tauri 2**: a **React 19 + TypeScript + Tailwind 4** UI, and a **Rust** engine that plans the timing and sends real keystrokes. It's local-first: no accounts or analytics, and its only network request is the optional update check against GitHub Releases.

## Repository layout: three apps, one codebase

```
/                       Windows app (the source of truth for shared files)
├─ src/                 React UI
├─ src-tauri/           Rust engine + Tauri config
├─ scripts/             Build and maintenance scripts (see below)
├─ release/             Prebuilt Windows installer committed to the repo
├─ docs/                README screenshots
├─ MrTyper-macOS/       macOS app: full copy of the root app
├─ MrTyper-ArchLinux/   Linux app: full copy + packaging/arch (PKGBUILD)
├─ .github/workflows/   CI: sync check, builds for all platforms, releases
├─ CHANGELOG.md
└─ AGENTS.md            this file (CLAUDE.md points here)
```

Each app folder is a complete, independently buildable project with its own `package.json`, `pnpm-lock.yaml` and `src-tauri/`. The user asked for separate, clearly labelled platform folders, so the copies are deliberate.

### The sync rule

The copies may differ from the root app **only** in these files:

| File | What differs |
| --- | --- |
| `src/lib/platform.ts` | UI wording, window-chrome flags, platform notes in Setup |
| `src-tauri/src/input.rs` | Keystroke sending and focus detection |
| `src-tauri/Cargo.toml`, `Cargo.lock` | Platform dependencies (windows-sys / enigo / objc2…) |
| `src-tauri/tauri.conf.json` | Window decorations, bundle formats, icons |
| `src-tauri/icons/` | `.ico` on Windows, `.icns` on macOS, PNGs on Linux |
| `README.md` | Platform guide |

Plus the copy-only `MrTyper-ArchLinux/packaging/` and the root-only tooling, docs and release files. **Every other file is byte-identical** (line endings aside). This is enforced by:

```bash
node scripts/check-platform-sync.mjs
```

```bash
node scripts/check-platform-sync.mjs --fix
```

The first reports drift and exits with 1. The second copies shared files from the root into both copies. CI runs the check first, and releases depend on it.

**Workflow for a shared change:**
1. Edit the file at the root.
2. Run `--fix`.
3. Verify all three apps (see [Verifying changes](#verifying-changes)).

**For a platform change,** edit only the platform files above. If a new file genuinely needs to differ per platform, add it to `PLATFORM_SPECIFIC` in `scripts/check-platform-sync.mjs`, and to the table above.

Keep platform logic out of shared code:
- **UI differences** go through `PLATFORM` from `src/lib/platform.ts`; CSS can key off `:root[data-platform="…"]`.
- **Rust differences** go in `input.rs`, or behind `#[cfg(target_os = "…")]` in shared files (see `apply_backdrop` and the macOS `RunEvent::Reopen` in `lib.rs`).

## Architecture

### Rust (`src-tauri/src/`)

| File | Role |
| --- | --- |
| `lib.rs` | App setup: plugins (single-instance first, then global shortcuts), window creation with saved bounds, tray, close-to-tray, focus tracking |
| `engine.rs` | Builds the timing plan (`build_plan`) from script steps, runs one worker thread per session, emits events, and holds most of the unit tests |
| `script.rs` | Splits a script into steps: typed characters and `{{…}}` commands (Google Docs shortcuts, raw key combos, pauses). Mirrored by `src/lib/scriptCommands.ts` |
| `input.rs` | **Platform layer.** The same API everywhere: `prepare`, `send_char`, `send_backspace`, `send_combo`, `foreground_target`, `is_own_process`, `set_own_window_focused` and `NO_TARGET_MESSAGE` |
| `commands.rs` | The Tauri command surface the UI calls, including `can_self_update` for the updater |
| `hotkeys.rs` | Global start/pause shortcuts, plus Esc registered only during a session |
| `actions.rs` | Start/stop/pause actions shared by hotkeys, the tray and commands |
| `settings.rs`, `store.rs` | Settings model and defaults; atomic JSON persistence in the app config dir (`mrtyper.json`) |
| `tray.rs` | Tray / menu-bar icon and menu |

A session goes: `prepare()` (connect or check permission) → countdown → read the focus target (refuse if MrTyper itself has focus) → type the plan, re-checking focus before every key when "Stop when focus leaves" is on.

Engine → UI events:
- `typing-phase`
- `typing-progress`
- `typing-keystroke` (kind: `key` / `typo` / `correction`)
- `typing-finished`
- `mrtyper-toast`

### Frontend (`src/`)

- **`App.tsx`** holds all state and the native event stream, and routes the three pages: `TypePage`, `PresetsPage`, `SettingsPage`.
- **`lib/bridge.ts`** wraps every Tauri call. In a plain browser it uses **`lib/mockBackend.ts`**, a localStorage-backed fake engine that never sends keystrokes, so `pnpm dev` works anywhere.
- **`lib/scriptCommands.ts`** mirrors `script.rs` so the UI can count characters without commands, estimate pause time and offer the command menu. **Change the two together**; `script.rs` has the tests.
- **`lib/updates.ts`** wraps the updater, process and opener plugins. The update check runs once on launch (if enabled) and installs only when the user clicks Update.
- **`components/ui/NumberField.tsx`** is the click-to-type value next to every slider. Use it for any new slider.

Performance rules. They're why the UI stays smooth at 300 WPM; keep them:
- **Keystrokes never become React state.** `typing-keystroke` goes to `lib/liveBus.ts`, which `CadenceScope` (a canvas) and `LiveScript` read directly.
- **`typing-progress` is coalesced** to one `setEngine` call per animation frame in `App.tsx`.
- **Prefer CSS transitions.** Framer Motion is for layout and presence animations only (page and toast transitions, rail and segmented pills).
- **No `backdrop-filter`, no animated blur, no infinite decorative animation.** Everything pauses under `html.is-backgrounded`.
- **`AnimatedNumber` writes to the DOM directly;** faders move by the `--p` / `--lo` / `--hi` CSS custom properties.

Styling:
- `styles/tokens.css` holds the colours, accents and fonts; light theme and accents are attribute selectors on `:root`.
- The other stylesheets are split by area: `shell`, `controls`, `type`, `pages` and `overlays`.
- Accent and motion preferences are cosmetic. They live in webview localStorage (`lib/uiPrefs.ts`), not in the native settings file.
- Reduced motion is applied with `html.reduce-motion`, not the media query, so the in-app Motion setting can override the OS.

### Platform layer at a glance

| | Windows (root) | macOS | Arch Linux |
| --- | --- | --- | --- |
| Keystrokes | `SendInput` + `KEYEVENTF_UNICODE` | enigo → `CGEvent` Unicode | enigo → XTest (X11) or `zwp_virtual_keyboard_v1` (wlroots Wayland); XWayland fallback on GNOME/KDE |
| Focus target | Foreground HWND | Frontmost app PID (`NSWorkspace`) | `_NET_ACTIVE_WINDOW` (X11); own-window focus only (Wayland) |
| Permission | None | Accessibility (checked in `prepare`) | None |
| Window | Custom title bar, Mica | Native traffic lights (`titleBarStyle: Overlay`) | Custom title bar, square corners |
| Packages | NSIS `.exe` | Universal `.app` / `.dmg`, ad-hoc signed | PKGBUILD, AppImage, `.deb`, `.rpm` |

## Commands

Run these from an app folder: the root, `MrTyper-macOS/` or `MrTyper-ArchLinux/`.

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install`. If pnpm isn't installed, `npx -y pnpm@10.15.0 install` works. |
| Browser preview (mock engine) | `pnpm dev`, then open `http://localhost:1420` |
| Typecheck and production frontend build | `pnpm build` |
| Strict unused-code check | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` |
| Engine tests | `cargo test --manifest-path src-tauri/Cargo.toml` (on the matching OS) |
| Lint | `cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml` |
| Release build and bundles | `pnpm tauri:build`, which runs `scripts/build-release.mjs` and strips build-machine paths |
| Run the native app in dev | `pnpm tauri:dev` |

From the repository root:

| Task | Command |
| --- | --- |
| Check the apps are in sync | `node scripts/check-platform-sync.mjs [--fix]` |
| Type-check or lint macOS / Linux from any OS | `node scripts/cross-check.mjs <macos\|linux> [check\|clippy]` (needs `rustup target add aarch64-apple-darwin x86_64-unknown-linux-gnu`) |
| Bump the version everywhere | `node scripts/bump-version.mjs <x.y.z>` |
| Regenerate icons | `pnpm tauri icon public/logo.svg -o <tmp>`, copy its `icon.png` to `src-tauri/icons/`, then `python scripts/generate_icons.py` and `python scripts/generate_installer_art.py` (needs Pillow) |

## Verifying changes

1. `node scripts/check-platform-sync.mjs` reports no drift.
2. `pnpm build` passes in all three app folders.
3. On Windows: `cargo test` and `cargo clippy` at the root.
4. For macOS and Linux: run `node scripts/cross-check.mjs macos clippy` and `… linux clippy`. Both should finish without warnings. These compile against the real platform APIs but don't link.
5. **The real proof is CI.** Push a branch: the workflow builds, tests and bundles every platform on real machines, including an end-to-end `makepkg` in an Arch container.
6. For UI changes, preview with `pnpm dev`, in both themes and at the 980×700 minimum window size.

Nobody has yet used the macOS or Linux apps on real hardware beyond the CI builds. Treat reports from real users as the next source of truth.

## Releasing

The in-app updater needs every release to be signed:

- **Secrets.** The repository must have the Actions secrets `TAURI_SIGNING_PRIVATE_KEY` (the contents of the private key file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is in `plugins.updater.pubkey` of all three `tauri.conf.json` files. The private key stays with the maintainer and is never committed.
- **What CI does with them.** With the secret present, the Windows, Linux and macOS jobs build with `createUpdaterArtifacts` on, which adds a `.sig` beside the NSIS installer, the AppImage and `MrTyper.app.tar.gz`. The release job runs `scripts/make-update-manifest.mjs` to fold those into `latest.json`, which installed apps fetch from `releases/latest/download/latest.json`. Without the secret, builds still work but have no update files.
- **Never lose or rotate the key casually.** Installed copies only accept updates signed by the key they shipped with. A new key means everyone has to reinstall by hand once.

1. `node scripts/bump-version.mjs x.y.z`, then add the release notes to `CHANGELOG.md`, moving them out of Unreleased.
2. Rebuild the Windows installer committed in `release/`: run `pnpm tauri:build` at the root, copy `src-tauri/target/release/bundle/nsis/MrTyper_x.y.z_x64-setup.exe` into `release/`, delete the old one, and regenerate `release/SHA256SUMS.txt`.
3. Commit, push to `main`, then `git tag -a vx.y.z -m "MrTyper x.y.z"` and `git push origin vx.y.z`.
4. The workflow's `release` job publishes a GitHub Release with every installer, `SHA256SUMS.txt`, and the text of `.github/release-notes.md`.

## Known traps

- **Updates and the macOS Accessibility permission.** The app is ad-hoc signed, so every new version looks like a different app to macOS and its Accessibility permission has to be granted again after an update. The macOS README says so.
- **Linux packages can't update themselves.** Only the AppImage can be replaced in place. `can_self_update` returns false for `.deb`, `.rpm` and Arch installs (no `APPIMAGE` variable), and the UI opens the download page instead.
- **Script commands send real shortcuts.** `{{alt+f4}}` really closes the window. Escape is refused because it's the emergency stop; keep it that way.

- **enigo sends through every Linux backend it connects to.** Connecting X11 and Wayland at once types each key twice. `input.rs` (Linux) disables the unwanted backend by passing an unconnectable display name. The `libei` backend is deliberately not enabled: it prompts on every connection and can panic when the desktop portal is missing.
- **Wayland limits are architectural, not bugs.** There's no global focus query and no global hotkeys, and GNOME/KDE don't offer virtual keyboards. The Linux app documents this in its README, Setup page and a runtime toast.
- **macOS Accessibility permission** is tied to the app's signature. The app is ad-hoc signed (`signingIdentity: "-"`), because Apple Silicon won't run unsigned code; it isn't notarised. Gatekeeper blocks the first launch. Since macOS 15, right-click → Open no longer bypasses it: users must click **Open Anyway** in System Settings → Privacy & Security (or clear the quarantine flag with `xattr`). Keep the install steps in `MrTyper-macOS/README.md`, the root README and `.github/release-notes.md` in agreement.
- **Cargo `trim-paths` is unstable,** hence `scripts/build-release.mjs`, which remaps paths with `CARGO_ENCODED_RUSTFLAGS` (that form survives spaces in paths). Always build releases through `pnpm tauri:build`, never plain `tauri build`, or the builder's user name ends up in the binary.
- **The webview data folder is named `webview2` on every platform,** so existing Windows installs keep their stored UI preferences.
- **Windows shell quirks:**
  - Windows PowerShell 5.1 reads BOM-less scripts as ANSI, which mangles non-ASCII strings.
  - `ln -s` in Git Bash copies directories instead of linking them.
  - pnpm isn't on PATH on the original dev machine; use `npx -y pnpm@10.15.0`.
- **The window can't scroll the deck on short screens.** A compact layout kicks in under 920 px of window height and the dial shrinks under 760 px (`styles/type.css`). Re-check at 980×700 after layout changes.
- **Line endings:** `.gitattributes` stores LF (CRLF for `.cmd`). Some editors on Windows write CRLF; that's fine, git normalises it.
- **Commits** are authored as `dyingfunds <dyingfunds@users.noreply.github.com>`, set in the repo-local git config. **Don't add `Co-Authored-By` trailers or any AI attribution**: the owner removed them so the GitHub Contributors list shows only them. Never commit personal email addresses or local paths.

## Ideas not yet done

- Code signing and notarisation for macOS (needs an Apple Developer account), and signing for the Windows installer.
- Wayland: an XDG RemoteDesktop/libei path for GNOME and KDE, and the XDG GlobalShortcuts portal for hotkeys.
- Script command shortcuts for Microsoft Word and other editors (today they target Google Docs).
- README screenshots for macOS and Linux (the current ones are from Windows).
