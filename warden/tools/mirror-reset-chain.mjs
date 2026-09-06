// Clear the mirror's CHAIN-DERIVED rows after a redeploy, and nothing else.
//
//   node tools/mirror-reset-chain.mjs [path] --yes
//
// A redeploy gives the piece a new contract at a new address. Every token, mint
// and Mark order in the mirror belongs to the OLD one: the ids restart at 1, and
// a mint row even carries the QR bitmap solved for the old token's url. Left in
// place they are phantoms -- rows describing tokens the configured contract has
// never heard of.
//
// `keys` IS NOT TOUCHED, deliberately. A registered agent key is a DOOR fact,
// not a chain fact: it survives a redeploy exactly as it survives a restart, and
// `keyIdHash` is what makes a later `rebind` resolvable. Wiping it would
// deregister live agents for no reason.
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) ?? "state.db";
if (!args.includes("--yes")) {
  console.error("This DELETES rows. Re-run with --yes once a snapshot exists.");
  process.exit(2);
}

// Every table whose rows are derived from the chain. Ordered children first so
// a foreign key cannot block the parent's delete.
const CHAIN_TABLES = ["mark_orders", "credits", "mints", "tokens"];

const db = new DatabaseSync(path);
const before = {}, after = {};
const has = (t) => db.prepare(
  "select count(*) as c from sqlite_master where type = 'table' and name = ?"
).get(t).c > 0;

db.exec("BEGIN");
for (const t of CHAIN_TABLES) {
  if (!has(t)) continue;
  before[t] = db.prepare(`select count(*) as c from "${t}"`).get().c;
  db.prepare(`delete from "${t}"`).run();
  after[t] = db.prepare(`select count(*) as c from "${t}"`).get().c;
}
db.exec("COMMIT");

for (const t of CHAIN_TABLES) {
  if (before[t] === undefined) continue;
  console.log(`  ${t.padEnd(12)} ${before[t]} -> ${after[t]}`);
}
const keys = has("keys") ? db.prepare("select count(*) as c from keys").get().c : 0;
console.log(`  ${"keys".padEnd(12)} ${keys} kept (door state, not chain state)`);
db.close();
