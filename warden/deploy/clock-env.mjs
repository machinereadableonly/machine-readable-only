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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const CLOCK_PATHS = {
  stateDb: "/var/lib/mro/state.db",
  splitSeed: "/etc/mro-clock/split-seed",
  // The Clock's own copy: the Warden's sits where the main user can replace it.
  bank: "/etc/mro-clock/bank.json",
  // Outside /var/lib/mro, which the main user can write: the ledger is what
  // stops one proof backing two rows, so only mro-clock may write it.
  ledger: "/var/lib/mro-clock/ledger.db",
};

/// The Warden's copy of the question bank. In a directory only root can write:
/// root installs this file, and a path the main user can rename into would let
/// it point root's writes anywhere.
export const WARDEN_BANK = "/etc/mro/bank.json";

const COPIED = ["BASE_RPC_URL", "MRO_CONTRACT_ADDRESS", "MRO_CHAIN_ID", "MRO_DOMAIN", "TREASURY_ADDRESS"];
const OPTIONAL = ["MAX_GAS_GWEI", "MRO_HOUSE_KEY_ID", "CLOCK_CHECK_RPC_URL", "MRO_OWNER_SAFE", "CLOCK_MAX_MINTS", "CLOCK_MAX_SEEDS", "CLOCK_MAX_MARKS", "CLOCK_MAX_CREDITS"];
const KEY = "CLOCK_PRIVATE_KEY";
// Read by the Clock but never set for it. The two paths default beside
// STATE_DB_PATH, where the Warden and the cutover look; a copied one would point
// into the main user's home. The installed Clock counts real days only, and a
// Warden counting fast ones would disagree with it about which day it is.
export const REFUSED = ["CLOCK_CURSOR_PATH", "CLOCK_LOCK_PATH", "CLOCK_LEDGER_PATH", "CLOCK_TEST_BOX_DAY_OFFSET", "MRO_DAY_SECONDS", "MRO_CLOCK_OFFSET_SECONDS"];

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

/**
 * The Clock's key lives in clock.env and nowhere else. It is never taken from
 * the Warden's .env, which the main user can write: a key there is refused.
 * `newKey` is a freshly generated key for a first install; `existingUnreadable`
 * lets a dry run, which cannot read clock.env, assume the key is kept.
 */
export function buildClockEnv({ wardenEnvText, existingClockEnvText = "", newKey = null, rotate = false, existingUnreadable = false }) {
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

  if (warden.has(KEY)) {
    throw new Error(`${KEY} is in the Warden's .env; the Clock's key lives only in clock.env. Remove the line and re-run`);
  }
  if (usable(existing, KEY) && !(newKey && rotate)) {
    if (newKey) throw new Error(`clock.env already holds ${KEY}; replacing it is a rotation (--rotate-key, DEPLOY.md 9b)`);
    out.push(existing.get(KEY).line);
    report.push(`${KEY.padEnd(22)} set, kept from the existing clock.env`);
  } else if (newKey) {
    out.push(`${KEY}=${newKey}`);
    report.push(`${KEY.padEnd(22)} set, newly generated`);
  } else if (existingUnreadable) {
    report.push(`${KEY.padEnd(22)} not checked: the existing clock.env is not readable here`);
  } else {
    throw new Error(`${KEY} is not in an existing clock.env; pass --new-key for a first install`);
  }

  out.push(`STATE_DB_PATH=${CLOCK_PATHS.stateDb}`);
  out.push(`MRO_SPLIT_SEED_FILE=${CLOCK_PATHS.splitSeed}`);
  out.push(`MRO_QUESTION_BANK=${CLOCK_PATHS.bank}`);
  out.push(`CLOCK_LEDGER_PATH=${CLOCK_PATHS.ledger}`);
  return { text: out.join("\n") + "\n", report };
}

function main() {
  const { values } = parseArgs({
    options: {
      "warden-env": { type: "string" }, out: { type: "string" }, check: { type: "boolean" },
      "new-key": { type: "boolean" }, "rotate-key": { type: "boolean" },
    },
  });
  const src = values["warden-env"];
  const dest = values.out;
  if (!src || !dest) throw new Error("usage: clock-env.mjs --warden-env <path> --out <path> [--check]");
  // --check builds the file and writes nothing; dest may be unreadable to a
  // non-root caller, which only means its key cannot be the fallback.
  let existing = "";
  let existingUnreadable = false;
  try {
    existing = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  } catch (err) {
    if (!values.check) throw err;
    existingUnreadable = true;
  }
  // Generated here, printed as an address only.
  const rotate = Boolean(values["rotate-key"]);
  const newKey = (values["new-key"] || rotate) && !values.check ? generatePrivateKey() : null;
  const { text, report } = buildClockEnv({
    wardenEnvText: readFileSync(src, "utf8"), existingClockEnvText: existing, newKey, rotate, existingUnreadable,
  });
  if (newKey) report.push(`the new Clock key's address is ${privateKeyToAccount(newKey).address}`);
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
