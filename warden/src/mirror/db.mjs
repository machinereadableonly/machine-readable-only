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
  // A BUSY TIMEOUT, because two processes write this file: the Warden on every
  // check-in and the Clock at 00:05. node:sqlite's default is 0 -- measured on
  // the installed Node 24.14.1, a second writer threw `database is locked`
  // after 1 ms, while `{ timeout: 5000 }` waited 5,025 ms and then succeeded.
  // WAL lets readers through during a write but does not make two WRITERS
  // wait; only this does. Five seconds is far longer than any statement here
  // takes and still bounded, so a genuinely stuck writer still fails rather
  // than hanging the process.
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL");
  // 4.L7. THIS GUARDS NOTHING TODAY, and that is deliberate rather than an
  // oversight: schema.sql declares no REFERENCES clauses at all, so there is no
  // constraint for SQLite to enforce. It stays because the setting is per
  // CONNECTION and off by default -- so the day a foreign key IS declared, the
  // choice would otherwise be silently unenforced in exactly the way a
  // constraint must never be. Nothing here depends on it; it is the cheap half
  // of a decision whose expensive half is a migration.
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

  // ONE PAID MINT PER KEY, which is narrower than what this guard used to say
  // and is what it always meant.
  //
  // schema.sql declares `mints_key` over `keyId` alone. Its purpose is stated
  // there: two settlements from the same key can both pass the pre-payment
  // hasMinted check, so the index is what actually stops a second token being
  // recorded. A FREE SEED WAS NEVER WHAT IT DEFENDED AGAINST -- a seeded child
  // is bound to its parent's key by design, so it carries a key that has
  // already minted, and the full index refused every seed any real agent could
  // ever ask for. Restricting it to rows that carry a payment authorisation
  // keeps the money-path guard exactly as strong and lets the free route
  // through.
  //
  // THE NARROWING, STATED RATHER THAN BURIED: `mints` rows written before the
  // payment columns existed have a NULL payNonce, so they fall OUT of this
  // index's coverage and a second mint under such a key would no longer be
  // refused here. Accepted -- those keys have demonstrably already minted and
  // the CHAIN is the authority on that (`mint` reverts TokenExists), and the
  // rows predate 2026-09-05 on testnet only.
  //
  // IT MUST STAY HERE AND NEVER MOVE TO schema.sql. This index names
  // `payNonce`, a column the block DIRECTLY ABOVE adds, and schema.sql is
  // exec'd WHOLE before migrate() runs -- so on any existing database
  // `CREATE TABLE IF NOT EXISTS mints` is a no-op, the column is not there yet,
  // and the index throws "no such column: payNonce" before migrate can help.
  // That exact ordering crash-looped the live Warden on 2026-09-05. The order
  // of these two statements is load-bearing for the same reason.
  //
  // A NEW NAME rather than replacing `mints_key` in place, so the old index is
  // dropped exactly ONCE and never comes back. Both statements are then no-ops
  // on every later boot, which matters because openDb() runs at every process
  // start and two processes write this file -- the Warden on every check-in and
  // the Clock at 00:05.
  //
  // SCHEMA.SQL NO LONGER DECLARES ANY INDEX ON `mints`, and that half is not
  // optional. It is exec'd whole on every start, so the full index it used to
  // carry was recreated after every drop: startup took the write lock each time
  // (measured at 413ms behind a held lock), and the moment one seed existed the
  // NEXT restart died outright on `UNIQUE constraint failed: mints.keyId`. Read
  // the note that replaced it there before moving anything back.
  db.exec("DROP INDEX IF EXISTS mints_key");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS mints_paid_key ON mints (keyId) WHERE payNonce IS NOT NULL");

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

  // Last use, so a key registered and never used can be forgotten. Reaching the
  // 10,000-key cap closes POST /keys forever, and that route is the only way in
  // for an agent with no domain of its own.
  if (!keyCols.has("lastUsedAt")) {
    db.exec("ALTER TABLE keys ADD COLUMN lastUsedAt INTEGER");
    // BACKFILL FROM EVIDENCE, because the prune reads NULL as "never used" and
    // an existing mirror has no usage history at all. A key that owns a token
    // has demonstrably been through the door, so it gets a non-NULL value and
    // is never a prune candidate. registeredAt is a lower bound rather than the
    // truth -- the real last use was not recorded by the old code and cannot be
    // recovered -- but the only thing the prune asks is whether it is NULL.
    db.exec("UPDATE keys SET lastUsedAt = registeredAt WHERE keyId IN (SELECT keyId FROM tokens)");
  }
  // Outside the branch, same reason as keys_hash above: a fresh database
  // already has the column from schema.sql and would skip it.
  db.exec("CREATE INDEX IF NOT EXISTS keys_unused ON keys (lastUsedAt, registeredAt)");
  const unhashed = db.prepare("SELECT keyId FROM keys WHERE keyIdHash IS NULL").all();
  if (unhashed.length) {
    const set = db.prepare("UPDATE keys SET keyIdHash = ? WHERE keyId = ?");
    for (const { keyId } of unhashed) set.run(keyIdToBytes32(keyId), keyId);
  }
}
