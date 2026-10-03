// THE SPLIT SEED: the secret end of the key chain, held by the Clock alone.
// Every refusal is a FIXED sentence -- the path carries the home directory and
// the value is the secret, and both would reach a log read in public.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/// Outside every worktree: the repository is public and the seed must not be.
export function splitSeedPath(env = process.env) {
  return env.MRO_SPLIT_SEED_FILE || join(homedir(), ".mro-split", "seed");
}

export function loadSplitSeed(path) {
  let mode;
  let text;
  try {
    mode = statSync(path).mode;
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      err.code === "ENOENT"
        ? "split seed not found: set MRO_SPLIT_SEED_FILE or create .mro-split/seed in the home directory"
        : `split seed could not be read (${err.code ?? "unknown error"})`
    );
  }
  if ((mode & 0o077) !== 0) throw new Error("split seed file is readable by other users: chmod 600 it");
  const hex = text.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("split seed must be 64 hex characters");
  return "0x" + hex.toLowerCase();
}
