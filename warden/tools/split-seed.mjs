#!/usr/bin/env node
// The operator's split seed: the secret end of the daily split's key chain.
//
//   node warden/tools/split-seed.mjs new <path>      make a seed, print its anchor
//   node warden/tools/split-seed.mjs anchor <path>   print an existing seed's anchor
//   node warden/tools/split-seed.mjs verify <path>   check a typed-in backup against it
//
// It prints ONLY `anchor 0x...`, never the seed. `new` writes mode 0600,
// refuses a file that already exists, and refuses any path inside this
// repository, which is public. The anchor is what `setSplitAnchor` takes.
import { randomBytes } from "node:crypto";
import { mkdirSync, openSync, writeSync, closeSync, realpathSync, existsSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { chainKeys } from "../src/clock/split.mjs";
import { loadSplitSeed } from "../src/clock/splitSeed.mjs";

const REPO = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));

function fail(message) {
  console.error(`split-seed: ${message}`);
  process.exit(1);
}

/// The nearest existing ancestor, resolved through links, so a symlink cannot smuggle the seed in.
function realDirOf(path) {
  let dir = dirname(resolve(path));
  while (!existsSync(dir)) dir = dirname(dir);
  return realpathSync(dir);
}

function insideRepo(path) {
  const rel = relative(REPO, realDirOf(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const [command, path] = process.argv.slice(2);
if (!path || !["new", "anchor", "verify"].includes(command)) fail("usage: split-seed.mjs new|anchor|verify <path>");

if (command === "new") {
  if (insideRepo(path)) fail("refusing a path inside the repository: keep the seed outside every worktree");
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const seed = "0x" + randomBytes(32).toString("hex");
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (err) {
    fail(err.code === "EEXIST" ? "a seed already exists there: it is never overwritten" : `could not create the seed (${err.code})`);
  }
  writeSync(fd, seed + "\n");
  closeSync(fd);
  console.log(`anchor ${chainKeys(seed)[0]}`);
} else {
  let seed;
  try {
    seed = loadSplitSeed(path);
  } catch (err) {
    fail(err.message);
  }
  if (command === "anchor") {
    console.log(`anchor ${chainKeys(seed)[0]}`);
  } else {
    // Typed input is not echoed, so the seed never lands in terminal scrollback.
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) });
    process.stderr.write("Type the backup copy, then Enter (it is not shown): ");
    rl.once("line", (line) => {
      rl.close();
      process.stderr.write("\n");
      const hex = line.trim().replace(/^0x/i, "").toLowerCase();
      if ("0x" + hex === seed) {
        console.log("match: the backup restores this seed");
      } else {
        console.log("DIFFERENT: the backup does not match this seed");
        process.exitCode = 1;
      }
    });
  }
}
