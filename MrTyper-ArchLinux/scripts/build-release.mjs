// Release build that keeps the build machine's file paths out of the binary.
//
// Rust embeds source paths for panic messages, and those paths include the
// user's home folder (and so their user name). This remaps them to neutral
// prefixes before running `tauri build`. Extra arguments are passed through.
//
//   pnpm tauri:build
//   node scripts/build-release.mjs --config some-override.json

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo");
const rustupHome = process.env.RUSTUP_HOME ?? path.join(os.homedir(), ".rustup");

const remaps = [
  `--remap-path-prefix=${cargoHome}=/cargo`,
  `--remap-path-prefix=${rustupHome}=/rustup`,
  `--remap-path-prefix=${root}=/mrtyper`,
];

// The encoded form is separated by \x1f, so paths containing spaces survive.
const existing = process.env.CARGO_ENCODED_RUSTFLAGS
  ? process.env.CARGO_ENCODED_RUSTFLAGS.split("\x1f")
  : (process.env.RUSTFLAGS ?? "").split(" ");
const env = { ...process.env };
delete env.RUSTFLAGS;
env.CARGO_ENCODED_RUSTFLAGS = [...existing.filter(Boolean), ...remaps].join("\x1f");

// The local Tauri CLI and Rust's toolchain must both be on PATH.
const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = [
  path.join(root, "node_modules", ".bin"),
  path.join(cargoHome, "bin"),
  env[pathKey] ?? "",
].join(path.delimiter);

const result = spawnSync("tauri", ["build", ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
