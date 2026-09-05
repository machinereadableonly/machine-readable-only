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
export function migrate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(tokens)").all().map((c) => c.name));
  if (!columns.has("resting")) {
    db.exec("ALTER TABLE tokens ADD COLUMN resting INTEGER NOT NULL DEFAULT 0");
  }

  if (!columns.has("bestRun")) {
    db.exec("ALTER TABLE tokens ADD COLUMN bestRun INTEGER NOT NULL DEFAULT 1");
    // Seed it from what the row already knows. A live mirror's `streak` is the
    // run standing at the last check-in, which is the best lower bound
    // available -- the runs that fell before it were never recorded anywhere,
    // so no migration can recover them. Leaving the default of 1 instead would
    // silently refuse every earned Mark to every token that already exists.
    db.exec("UPDATE tokens SET bestRun = streak WHERE streak > bestRun");
  }

  const orderCols = new Set(db.prepare("PRAGMA table_info(mark_orders)").all().map((c) => c.name));
  if (!orderCols.has("variant")) {
    db.exec("ALTER TABLE mark_orders ADD COLUMN variant INTEGER NOT NULL DEFAULT 0");
  }
}
