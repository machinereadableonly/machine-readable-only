// A CONSISTENT backup of the mirror, WAL included.
//
//   node tools/mirror-snapshot.mjs <destination> [absolute source]   (default: the Warden's STATE_DB_PATH)
//
// `cp state.db` IS NOT A BACKUP while the Warden is running. The mirror is in
// WAL mode, so recent commits live in state.db-wal until a checkpoint: on
// 2026-09-06 the main file was 40 KB dated three days earlier while the WAL held
// 103 KB of newer data, and a plain copy would silently have preserved the older
// state. VACUUM INTO takes a single-file snapshot of the CURRENT committed
// contents, which is what a restore needs.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { liveDbPath } from "./live-db.mjs";

const dest = process.argv[2];
const src = liveDbPath(process.argv[3]);
if (!dest) throw new Error("usage: mirror-snapshot.mjs <destination> [source]");
if (existsSync(dest)) throw new Error(`refusing to overwrite ${dest}`);

const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();

const check = new DatabaseSync(dest, { readOnly: true });
const tables = check.prepare(
  "select name from sqlite_master where type = 'table' order by name"
).all();
console.log(`snapshot ${dest}`);
for (const t of tables) {
  const n = check.prepare(`select count(*) as c from "${t.name}"`).get().c;
  if (n > 0) console.log(`  ${String(n).padStart(5)}  ${t.name}`);
}
