# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first. It covers the repository layout, the three-app sync rule, architecture, commands, verification, releasing and known traps. History is in [CHANGELOG.md](CHANGELOG.md).

The essentials:

- The repository root is the **Windows app and the source of truth**. `MrTyper-macOS/` and `MrTyper-ArchLinux/` are full copies that may differ only in `src/lib/platform.ts`, `src-tauri/src/input.rs`, `src-tauri/Cargo.toml` / `Cargo.lock` / `tauri.conf.json`, `src-tauri/icons/`, and `README.md`.
- To make a shared change, edit at the root, then run `node scripts/check-platform-sync.mjs --fix`.
- Verify macOS and Linux from any machine with `node scripts/cross-check.mjs <macos|linux> clippy`. CI is the final check.
- Never let a keystroke event become React state. See "Performance rules" in AGENTS.md.
