// Opening the mirror. One function, so every caller gets the same PRAGMAs.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The ONE converter between a thumbprint and the bytes32 the contract stores.
// Imported rather than reimplemented: two independent conversions is precisely
// how a rebound agent gets locked out by a comparison that cannot match.
import { keyIdToBytes32 } from "../mcp/keyId.mjs";

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

  // The settlement columns. Both tables gain the same pair, and the DEFAULT is
  // deliberately NULL rather than a timestamp: a row that already existed was
  // written by the old code, which committed before settlement, and there is no
  // way to learn now whether its payment landed. Leaving `payNonce` NULL means
  // the expiry sweep below never touches it -- an old row keeps whatever status
  // it has and stays exactly as reconcilable by hand as it is today. Inventing
  // a `reservedAt` for it would make the sweep delete real, already-written
  // history.
  if (!orderCols.has("payNonce")) {
    db.exec("ALTER TABLE mark_orders ADD COLUMN payNonce TEXT");
    db.exec("ALTER TABLE mark_orders ADD COLUMN reservedAt INTEGER");
  }
  const mintCols = new Set(db.prepare("PRAGMA table_info(mints)").all().map((c) => c.name));
  if (!mintCols.has("payNonce")) {
    db.exec("ALTER TABLE mints ADD COLUMN payNonce TEXT");
    db.exec("ALTER TABLE mints ADD COLUMN reservedAt INTEGER");
  }

  // The on-chain form of every registered key id. Unlike the columns above this
  // one CAN be backfilled, because the conversion is a plain forward hash of a
  // value the row already holds -- so an existing mirror gets the same lookup a
  // fresh one has, and a Rebound naming a key registered years ago still
  // resolves.
  const keyCols = new Set(db.prepare("PRAGMA table_info(keys)").all().map((c) => c.name));
  if (!keyCols.has("keyIdHash")) {
    db.exec("ALTER TABLE keys ADD COLUMN keyIdHash TEXT");
  }
  // OUTSIDE the branch above, because a FRESH database already has the column
  // from schema.sql and would skip it -- and schema.sql cannot create this
  // index itself without breaking every existing database. See the note there.
  db.exec("CREATE INDEX IF NOT EXISTS keys_hash ON keys (keyIdHash)");
  const unhashed = db.prepare("SELECT keyId FROM keys WHERE keyIdHash IS NULL").all();
  if (unhashed.length) {
    const set = db.prepare("UPDATE keys SET keyIdHash = ? WHERE keyId = ?");
    for (const { keyId } of unhashed) set.run(keyIdToBytes32(keyId), keyId);
  }
}
