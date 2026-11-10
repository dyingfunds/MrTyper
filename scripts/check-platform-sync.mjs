// Keeps the three MrTyper apps in sync.
//
// The Windows app at the repository root is the source of truth. The macOS
// and Arch Linux apps are full copies that may differ ONLY in the
// platform-specific files listed below; every other file must be identical.
//
//   node scripts/check-platform-sync.mjs         report drift (exit 1 if any)
//   node scripts/check-platform-sync.mjs --fix   copy shared files from the root
//
// Workflow for a shared change: edit it at the root, run with --fix, then
// build or type-check each app (see AGENTS.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPIES = ["MrTyper-macOS", "MrTyper-ArchLinux"];

/** Files that are allowed (and expected) to differ between the apps. */
const PLATFORM_SPECIFIC = [
  "src/lib/platform.ts", // UI wording and window-chrome flags
  "src-tauri/src/input.rs", // keystrokes and focus detection
  "src-tauri/Cargo.toml", // platform dependencies
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json", // window chrome and bundle formats
  "src-tauri/icons/", // .ico / .icns / PNG sets differ
  "README.md",
];

/** Root-only material that is not part of an app. */
const ROOT_ONLY = [
  ".git/",
  ".github/",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".claude/",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "docs/",
  "release/",
  "scripts/check-platform-sync.mjs",
  "scripts/cross-check.mjs",
  "scripts/bump-version.mjs",
  "scripts/generate_installer_art.py", // NSIS (Windows installer) artwork
  ...COPIES.map((copy) => `${copy}/`),
];

/** Copy-only material. */
const COPY_ONLY = ["packaging/"];

/** Build output and dependencies are never compared. */
const IGNORED_DIRS = new Set(["node_modules", "dist", "target", "gen"]);

const matches = (file, list) =>
  list.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));

function walk(base, dir = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(base, dir), { withFileTypes: true })) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...walk(base, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

// Line endings are normalised by .gitattributes, so compare without them.
const read = (file) => fs.readFileSync(file).toString("latin1").split("\r\n").join("\n");

const fix = process.argv.includes("--fix");
const shared = walk(ROOT).filter((file) => !matches(file, ROOT_ONLY) && !matches(file, PLATFORM_SPECIFIC));
let problems = 0;

for (const copy of COPIES) {
  const copyRoot = path.join(ROOT, copy);
  const copyFiles = new Set(walk(copyRoot));

  for (const file of shared) {
    const source = path.join(ROOT, file);
    const target = path.join(copyRoot, file);
    const state = !copyFiles.has(file) ? "missing" : read(source) === read(target) ? "ok" : "differs";
    if (state === "ok") continue;
    if (fix) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      console.log(`fixed    ${copy}/${file} (${state})`);
    } else {
      console.log(`${state.padEnd(8)} ${copy}/${file}`);
      problems += 1;
    }
  }

  for (const file of copyFiles) {
    if (shared.includes(file) || matches(file, PLATFORM_SPECIFIC) || matches(file, COPY_ONLY)) continue;
    console.log(`extra    ${copy}/${file}  (not in the root app; delete it or list it as platform-specific)`);
    problems += 1;
  }
}

if (problems > 0) {
  console.log(`\n${problems} file(s) out of sync. Run with --fix to copy shared files from the root app.`);
  process.exit(1);
}
console.log(`All shared files are in sync (${shared.length} files, ${COPIES.length} copies).`);
