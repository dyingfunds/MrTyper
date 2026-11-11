#!/usr/bin/env node
// Writes latest.json, the file MrTyper's updater reads, from the signed
// installers a release build produced. Used by the release job in CI:
//
//   node scripts/make-update-manifest.mjs <installers-dir> <version> <owner/repo>
//
// Each platform needs its update file and a matching .sig (made when the
// build had TAURI_SIGNING_PRIVATE_KEY set):
//
//   Windows  MrTyper_<v>_x64-setup.exe   (the NSIS installer itself)
//   macOS    MrTyper.app.tar.gz          (renamed here to MrTyper_<v>_universal.app.tar.gz)
//   Linux    MrTyper_<v>_amd64.AppImage
//
// Platforms without a signature are left out. With none at all, no file is
// written and the release simply has no automatic update.

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version, repo] = process.argv.slice(2);
if (!dir || !version || !repo) {
  console.error("Usage: node scripts/make-update-manifest.mjs <installers-dir> <version> <owner/repo>");
  process.exit(2);
}

const files = readdirSync(dir);
const signatureOf = (name) => {
  const path = join(dir, `${name}.sig`);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
};
const urlOf = (name) =>
  `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`;

const platforms = {};
function add(keys, name) {
  const signature = name ? signatureOf(name) : null;
  if (!name || !signature) return;
  for (const key of keys) platforms[key] = { signature, url: urlOf(name) };
  console.log(`${keys.join(", ")}: ${name}`);
}

add(["windows-x86_64"], files.find((name) => name.endsWith("_x64-setup.exe")));
add(["linux-x86_64"], files.find((name) => name.endsWith(".AppImage")));

// The macOS bundle is universal, so it serves both Apple Silicon and Intel.
const macBundle = files.find((name) => name.endsWith(".app.tar.gz"));
if (macBundle) {
  const versioned = `MrTyper_${version}_universal.app.tar.gz`;
  if (macBundle !== versioned) {
    renameSync(join(dir, macBundle), join(dir, versioned));
    if (existsSync(join(dir, `${macBundle}.sig`))) {
      renameSync(join(dir, `${macBundle}.sig`), join(dir, `${versioned}.sig`));
    }
  }
  add(["darwin-aarch64", "darwin-x86_64"], versioned);
}

if (Object.keys(platforms).length === 0) {
  console.log("No signed update files found; latest.json not written.");
  process.exit(0);
}

const manifest = {
  version,
  notes: `MrTyper ${version}. See the release page for what's new.`,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote latest.json for ${Object.keys(platforms).length} platform keys.`);
