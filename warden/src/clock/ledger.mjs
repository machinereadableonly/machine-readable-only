// The Clock's own record of what each signed request and each payment has
// already bought. It lives where only the Clock's user can write, never in the
// mirror: a row in the shared database is a claim, and this file is what stops
// one proof being spent on two rows.
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS used_requests (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS used_payments (
  txHash TEXT NOT NULL, logIndex INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
  PRIMARY KEY (txHash, logIndex)
);
CREATE TABLE IF NOT EXISTS minted_keys (keyId TEXT PRIMARY KEY, ref TEXT NOT NULL);
`;

/**
 * Open the ledger at `path` (":memory:" in tests).
 *
 * `claim` is all-or-nothing and idempotent: re-claiming the same proofs for the
 * same row succeeds, so a run that crashed after claiming and before writing
 * can try again. A proof already held by a DIFFERENT row refuses the claim.
 */
export function openLedger(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(SCHEMA);
  const s = {
    request: db.prepare("SELECT kind, ref FROM used_requests WHERE hash = ?"),
    payment: db.prepare("SELECT kind, ref FROM used_payments WHERE txHash = ? AND logIndex = ?"),
    key: db.prepare("SELECT ref FROM minted_keys WHERE keyId = ?"),
    putRequest: db.prepare("INSERT OR IGNORE INTO used_requests (hash, kind, ref) VALUES (?, ?, ?)"),
    putPayment: db.prepare("INSERT OR IGNORE INTO used_payments (txHash, logIndex, kind, ref) VALUES (?, ?, ?, ?)"),
    putKey: db.prepare("INSERT OR IGNORE INTO minted_keys (keyId, ref) VALUES (?, ?)"),
  };
  const other = (row, kind, ref) => row && (row.kind !== kind || row.ref !== ref);

  return {
    /// { requestHash, payment?: { txHash, logIndex }, mintKey? } -> { ok } | { ok: false, why }
    claim(kind, ref, { requestHash, payment = null, mintKey = null }) {
      ref = String(ref);
      if (other(s.request.get(requestHash), kind, ref)) {
        return { ok: false, why: "its signed request already backs another row" };
      }
      const txHash = payment?.txHash?.toLowerCase();
      if (payment && other(s.payment.get(txHash, payment.logIndex), kind, ref)) {
        return { ok: false, why: "its payment already paid for another row" };
      }
      const keyRow = mintKey ? s.key.get(mintKey) : null;
      if (keyRow && keyRow.ref !== ref) return { ok: false, why: "its key has already minted" };
      db.exec("BEGIN");
      try {
        s.putRequest.run(requestHash, kind, ref);
        if (payment) s.putPayment.run(txHash, payment.logIndex, kind, ref);
        if (mintKey) s.putKey.run(mintKey, ref);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { ok: true };
    },
    close: () => db.close(),
  };
}
