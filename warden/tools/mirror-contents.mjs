// What the mirror currently holds. Read-only, so it is safe against production.
//   node tools/mirror-contents.mjs [path]
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2] ?? "state.db";
const db = new DatabaseSync(path, { readOnly: true });

const tables = db.prepare(
  "select name from sqlite_master where type = 'table' order by name"
).all();

console.log(`mirror ${path}`);
for (const t of tables) {
  const n = db.prepare(`select count(*) as c from "${t.name}"`).get().c;
  if (n > 0) console.log(`  ${String(n).padStart(5)}  ${t.name}`);
}

for (const table of ["tokens", "mints", "credits", "mark_orders", "keys"]) {
  if (!tables.some((t) => t.name === table)) continue;
  const rows = db.prepare(`select * from "${table}" limit 10`).all();
  if (!rows.length) continue;
  console.log(`\n-- ${table} --`);
  for (const r of rows) console.log("  " + JSON.stringify(r));
}
