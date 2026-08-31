// Opening the mirror. One function, so every caller gets the same PRAGMAs.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA = fileURLToPath(new URL("./schema.sql", import.meta.url));

/**
 * Open the mirror and make sure its tables exist.
 *
 * WAL (write-ahead logging) lets readers carry on while a write is in flight,
 * which is what allows many agents to check in at the same moment without a
 * lock. It has no effect on an in-memory database, so tests are unaffected.
 */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(SCHEMA, "utf8"));
  migrate(db);
  return db;
}

/**
 * Bring an existing mirror up to the current schema.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a column added to schema.sql never reaches a database created before it.
 * Nothing is deployed yet, so today this is a no-op on every database there
 * is -- which is exactly when it is cheap to add.
 */
function migrate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(tokens)").all().map((c) => c.name));
  if (!columns.has("resting")) {
    db.exec("ALTER TABLE tokens ADD COLUMN resting INTEGER NOT NULL DEFAULT 0");
  }
}
