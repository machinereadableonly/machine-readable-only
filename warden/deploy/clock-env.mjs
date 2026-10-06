// Build the Clock's own environment file from the Warden's.
//
//   node clock-env.mjs --warden-env <warden/.env> --out /etc/mro-clock/clock.env
//
// Run by install-clock-user.sh as root. Prints key names only, never a value:
// the file carries the Clock's private key and the RPC url, which is where a
// managed provider keeps its api key.
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const CLOCK_PATHS = {
  stateDb: "/var/lib/mro/state.db",
  splitSeed: "/etc/mro-clock/split-seed",
  bank: "/var/lib/mro/questions/bank.json",
};

const COPIED = ["BASE_RPC_URL", "MRO_CONTRACT_ADDRESS", "MRO_CHAIN_ID"];
const OPTIONAL = ["MAX_GAS_GWEI"];
const KEY = "CLOCK_PRIVATE_KEY";
// Read by the Clock but never set for it. The two paths default beside
// STATE_DB_PATH, where the Warden and the cutover look; a copied one would point
// into the main user's home. The installed Clock counts real days only, and a
// Warden counting fast ones would disagree with it about which day it is.
export const REFUSED = ["CLOCK_CURSOR_PATH", "CLOCK_LOCK_PATH", "MRO_DAY_SECONDS", "MRO_CLOCK_OFFSET_SECONDS"];

/// KEY -> the raw line, so quoting reaches node's --env-file untouched. A key
/// written twice is refused only if the Clock reads it.
function linesByKey(text, label) {
  const found = new Map();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const empty = m[2].trim() === "" || /^(""|'')$/.test(m[2].trim());
    found.set(m[1], found.has(m[1]) ? { twice: label } : { line: line.trim(), empty });
  }
  return found;
}

function usable(map, name) {
  const entry = map.get(name);
  if (entry?.twice) throw new Error(`${name} is written more than once in ${entry.twice}; remove one and re-run`);
  return entry !== undefined && !entry.empty;
}

export function buildClockEnv({ wardenEnvText, existingClockEnvText = "" }) {
  const warden = linesByKey(wardenEnvText, "the Warden's .env");
  const existing = linesByKey(existingClockEnvText, "the existing clock.env");
  const out = ["# Written by install-clock-user.sh. Re-run it after changing the Warden's .env."];
  const report = [];

  for (const name of REFUSED) {
    if (warden.has(name)) throw new Error(`${name} is set in the Warden's .env; the installed Clock never takes it, so remove it and re-run`);
  }
  for (const name of COPIED) {
    if (!usable(warden, name)) throw new Error(`${name} is missing or empty in the Warden's .env`);
    out.push(warden.get(name).line);
    report.push(`${name.padEnd(22)} set, from the Warden's .env`);
  }
  for (const name of OPTIONAL) {
    if (!usable(warden, name)) continue;
    out.push(warden.get(name).line);
    report.push(`${name.padEnd(22)} set, from the Warden's .env`);
  }

  if (usable(warden, KEY)) {
    out.push(warden.get(KEY).line);
    report.push(`${KEY.padEnd(22)} set, from the Warden's .env`);
  } else if (usable(existing, KEY)) {
    out.push(existing.get(KEY).line);
    report.push(`${KEY.padEnd(22)} set, kept from the existing clock.env`);
  } else {
    throw new Error(`${KEY} is in neither the Warden's .env nor an existing clock.env`);
  }

  out.push(`STATE_DB_PATH=${CLOCK_PATHS.stateDb}`);
  out.push(`MRO_SPLIT_SEED_FILE=${CLOCK_PATHS.splitSeed}`);
  out.push(`MRO_QUESTION_BANK=${CLOCK_PATHS.bank}`);
  return { text: out.join("\n") + "\n", report };
}

function main() {
  const { values } = parseArgs({
    options: { "warden-env": { type: "string" }, out: { type: "string" }, check: { type: "boolean" } },
  });
  const src = values["warden-env"];
  const dest = values.out;
  if (!src || !dest) throw new Error("usage: clock-env.mjs --warden-env <path> --out <path> [--check]");
  // --check builds the file and writes nothing; dest may be unreadable to a
  // non-root caller, which only means its key cannot be the fallback.
  let existing = "";
  try {
    existing = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  } catch (err) {
    if (!values.check) throw err;
  }
  const { text, report } = buildClockEnv({ wardenEnvText: readFileSync(src, "utf8"), existingClockEnvText: existing });
  if (values.check) {
    for (const line of report) console.log(`   ${line}`);
    return;
  }
  const tmp = `${dest}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, dest);
  for (const line of report) console.log(`   ${line}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`clock-env: ${err.message}`);
    process.exit(1);
  }
}
