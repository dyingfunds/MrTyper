// Type-check (or lint) the macOS or Linux app from any machine, including
// Windows, without a Mac or a Linux install.
//
//   node scripts/cross-check.mjs macos            cargo check for aarch64-apple-darwin
//   node scripts/cross-check.mjs linux            cargo check for x86_64-unknown-linux-gnu
//   node scripts/cross-check.mjs macos clippy     cargo clippy instead of check
//
// `cargo check` compiles every crate against the target platform's real APIs
// but never links, so native libraries are not needed. Two kinds of build
// script still try to reach native tooling, and get harmless stand-ins:
//
// * C/Objective-C helpers compiled with `cc` (e.g. objc2-exception-helper on
//   macOS) get a stand-in compiler/archiver that writes empty outputs.
// * Crates that ask `pkg-config` for GTK, WebKitGTK, D-Bus, ... get a
//   stand-in pkg-config that reports every library as present.
//
// This catches type errors, wrong API usage and config mistakes. It cannot
// prove the app links or runs: the GitHub Actions build does that.
//
// Requires: rustup target add aarch64-apple-darwin x86_64-unknown-linux-gnu

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = {
  macos: { folder: "MrTyper-macOS", triple: "aarch64-apple-darwin" },
  linux: { folder: "MrTyper-ArchLinux", triple: "x86_64-unknown-linux-gnu" },
};

const [platform, mode = "check"] = process.argv.slice(2);
const target = TARGETS[platform];
if (!target || !["check", "clippy"].includes(mode)) {
  console.error("usage: node scripts/cross-check.mjs <macos|linux> [check|clippy]");
  process.exit(2);
}

// --- Stand-in tools -----------------------------------------------------
const tools = fs.mkdtempSync(path.join(os.tmpdir(), "mrtyper-cross-"));
const scripts = {
  cc: `const fs = require("fs"); const a = process.argv.slice(2); const i = a.indexOf("-o"); if (i >= 0) fs.writeFileSync(a[i + 1], "");`,
  ar: `const fs = require("fs"); const out = process.argv.slice(2).find((x) => x.endsWith(".a")); if (out) fs.writeFileSync(out, "!<arch>\\n");`,
  "pkg-config": `const a = process.argv.slice(2); if (a.includes("--modversion")) process.stdout.write("99.0\\n"); process.exit(0);`,
};
const executables = {};
for (const [name, body] of Object.entries(scripts)) {
  const js = path.join(tools, `${name}.js`);
  fs.writeFileSync(js, body);
  if (process.platform === "win32") {
    const cmd = path.join(tools, `${name}.cmd`);
    fs.writeFileSync(cmd, `@node "${js}" %*\r\n`);
    executables[name] = cmd;
  } else {
    const sh = path.join(tools, name);
    fs.writeFileSync(sh, `#!/bin/sh\nexec node "${js}" "$@"\n`, { mode: 0o755 });
    executables[name] = sh;
  }
}

const envTriple = target.triple.replaceAll("-", "_");
const env = {
  ...process.env,
  [`CC_${envTriple}`]: executables.cc,
  [`AR_${envTriple}`]: executables.ar,
  PKG_CONFIG: executables["pkg-config"],
  PKG_CONFIG_ALLOW_CROSS: "1",
};
const cargoBin = path.join(process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"), "bin");
const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = [cargoBin, env[pathKey] ?? ""].join(path.delimiter);

console.log(`cargo ${mode} for ${platform} (${target.triple}) in ${target.folder}/src-tauri`);
const result = spawnSync("cargo", [mode, "--all-targets", "--target", target.triple], {
  cwd: path.join(ROOT, target.folder, "src-tauri"),
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

fs.rmSync(tools, { recursive: true, force: true });
process.exit(result.status ?? 1);
