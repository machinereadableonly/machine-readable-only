// Build the Warden's own environment file from the main user's.
//
//   node warden-env.mjs --warden-env <warden/.env> --out /etc/mro-warden/warden.env [--check]
//
// Run by install-warden-user.sh as root, from the root-owned tree. Copies only
// the settings the Warden's code reads, so a credential that sits in the main
// user's file for another reason never reaches the service. Prints key names
// only, never a value.
import { readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WARDEN_BANK, CLOCK_PATHS } from "./clock-env.mjs";

/// Fixed by the installer: the shared mirror and the root-owned bank.
export const WARDEN_PATHS = { stateDb: CLOCK_PATHS.stateDb, bank: WARDEN_BANK };

/// The Clock's, never the Warden's.
export const REFUSED = ["CLOCK_PRIVATE_KEY"];

/// Every setting the Warden's code reads, outside the Clock, and the subset it
/// refuses to start without. Read from the code being installed, so a setting
/// added later is carried without editing this file.
export function wardenSettings(srcDir = fileURLToPath(new URL("../src/", import.meta.url))) {
  const read = new Set();
  const files = readdirSync(srcDir, { recursive: true })
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("clock"))
    .map((f) => join(srcDir, f));
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/\benv\s*(?:\.\s*([A-Z][A-Z0-9_]+)|\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\])/g)) {
      read.add(m[1] ?? m[2]);
    }
  }
  const main = readFileSync(join(srcDir, "main.mjs"), "utf8");
  const required = new Set([...main.matchAll(/\brequireEnv\(\s*["']([A-Z][A-Z0-9_]+)["']/g)].map((m) => m[1]));
  for (const name of required) read.add(name);
  // Set by the unit, not by the file.
  for (const name of ["PORT", "NODE_ENV", ...REFUSED]) read.delete(name);
  return { names: [...read].sort(), required: [...required].sort() };
}

function linesByKey(text) {
  const found = new Map();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const empty = m[2].trim() === "" || /^(""|'')$/.test(m[2].trim());
    found.set(m[1], found.has(m[1]) ? { twice: true } : { line: line.trim(), empty });
  }
  return found;
}

export function buildWardenEnv({ wardenEnvText, names, required }) {
  const src = linesByKey(wardenEnvText);
  for (const name of REFUSED) {
    if (src.has(name)) throw new Error(`${name} is in the Warden's .env; it belongs to the Clock alone. Remove the line and re-run`);
  }
  const fixed = { STATE_DB_PATH: WARDEN_PATHS.stateDb, MRO_QUESTION_BANK: WARDEN_PATHS.bank };
  const out = ["# Written by install-warden-user.sh. Re-run it after changing the Warden's .env."];
  const report = [];
  for (const name of names) {
    if (name in fixed) continue;
    const entry = src.get(name);
    if (entry?.twice) throw new Error(`${name} is written more than once in the Warden's .env; remove one and re-run`);
    if (!entry || entry.empty) {
      if (required.includes(name)) throw new Error(`${name} is missing or empty in the Warden's .env`);
      continue;
    }
    out.push(entry.line);
    report.push(`${name.padEnd(22)} set, from the Warden's .env`);
  }
  for (const [name, value] of Object.entries(fixed)) {
    out.push(`${name}=${value}`);
    report.push(`${name.padEnd(22)} ${value}`);
  }
  const dropped = [...src.keys()].filter((n) => !names.includes(n) && !(n in fixed));
  if (dropped.length) report.push(`not copied (the Warden does not read them): ${dropped.join(", ")}`);
  return { text: out.join("\n") + "\n", report };
}

function main() {
  const { values } = parseArgs({ options: { "warden-env": { type: "string" }, out: { type: "string" }, check: { type: "boolean" } } });
  const src = values["warden-env"];
  const dest = values.out;
  if (!src || !dest) throw new Error("usage: warden-env.mjs --warden-env <path> --out <path> [--check]");
  const { names, required } = wardenSettings();
  const { text, report } = buildWardenEnv({ wardenEnvText: readFileSync(src, "utf8"), names, required });
  if (!values.check) {
    const tmp = `${dest}.tmp-${process.pid}`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, dest);
  }
  for (const line of report) console.log(`   ${line}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`warden-env: ${err.message}`);
    process.exit(1);
  }
}
