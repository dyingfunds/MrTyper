// Set the version of all three MrTyper apps in one go.
//
//   node scripts/bump-version.mjs 2.1.0
//
// The app UI and each tauri.conf.json read the version from package.json, so
// only these need editing: the three package.json and Cargo.toml files, the
// Arch PKGBUILD, and the Windows installer name in the README and the
// elevated-install helper. Afterwards: update CHANGELOG.md, rebuild the
// Windows installer into release/ (see AGENTS.md), commit, and push a
// `v<version>` tag to publish the GitHub Release.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("usage: node scripts/bump-version.mjs <major.minor.patch>");
  process.exit(2);
}

const current = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const APPS = [".", "MrTyper-macOS", "MrTyper-ArchLinux"];

function update(file, pattern, replacement) {
  const full = path.join(ROOT, file);
  const before = fs.readFileSync(full, "utf8");
  // Test a fresh copy of the pattern: global regexes keep state between calls.
  if (!new RegExp(pattern.source, pattern.flags.replace("g", "")).test(before)) {
    throw new Error(`${file}: version pattern not found`);
  }
  const after = before.replace(pattern, replacement);
  if (after === before) {
    console.log(`same     ${file}`);
    return;
  }
  fs.writeFileSync(full, after);
  console.log(`updated  ${file}`);
}

for (const app of APPS) {
  update(path.join(app, "package.json"), /"version": "[^"]+"/, `"version": "${next}"`);
  update(path.join(app, "src-tauri", "Cargo.toml"), /^version = "[^"]+"/m, `version = "${next}"`);
}
update("MrTyper-ArchLinux/packaging/arch/PKGBUILD", /^pkgver=.*$/m, `pkgver=${next}`);
update("MrTyper-ArchLinux/packaging/arch/PKGBUILD", /^pkgrel=.*$/m, "pkgrel=1");

const installerName = (version) => `MrTyper_${version}_x64-setup`;
const oldName = new RegExp(installerName(current).replaceAll(".", "\\."), "g");
update("README.md", oldName, installerName(next));
update("release/install-elevated.cmd", oldName, installerName(next));

console.log(`\n${current} -> ${next}. Cargo.lock files refresh on the next build.`);
