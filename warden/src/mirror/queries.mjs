// Every statement the tools use, prepared once, in one file.
//
// Prepared statements are reused across calls, so the SQL is parsed once per
// process rather than once per request.

/// The exact SQLite error for a violated UNIQUE index. Matching on the message
/// rather than catching everything is deliberate: a dropped table and a
/// duplicate check-in must not look the same to a caller.
const UNIQUE_VIOLATION = /UNIQUE constraint failed/;

export function queries(db) {
  const s = {
    insertCredit: db.prepare("INSERT INTO credits (tokenId, day, sigHash) VALUES (?, ?, ?)"),
    insertToken: db.prepare(
      "INSERT INTO tokens (tokenId, keyId, owner, lastDay, mintDay) VALUES (?, ?, ?, ?, ?)"
    ),
    getToken: db.prepare("SELECT * FROM tokens WHERE tokenId = ?"),
    tokensForKey: db.prepare("SELECT * FROM tokens WHERE keyId = ?"),
    maxTokenId: db.prepare("SELECT MAX(tokenId) AS maxId FROM tokens"),
    insertKey: db.prepare(
      "INSERT OR REPLACE INTO keys (keyId, jwk, directory, registeredAt) VALUES (?, ?, ?, ?)"
    ),
    getKey: db.prepare("SELECT * FROM keys WHERE keyId = ?"),
    allKeys: db.prepare("SELECT * FROM keys ORDER BY registeredAt ASC"),
    keyCount: db.prepare("SELECT COUNT(*) AS n FROM keys"),
    firstMintDay: db.prepare("SELECT MIN(mintDay) AS d FROM tokens WHERE keyId = ?"),
    seedsSpent: db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE keyId = ? AND parentId IS NOT NULL"),
    setLineage: db.prepare("UPDATE tokens SET generation = ?, parentId = ? WHERE tokenId = ?"),
    creditDay: db.prepare("UPDATE tokens SET level = ?, streak = ?, lastDay = ? WHERE tokenId = ?"),
    nextPendingMint: db.prepare("SELECT * FROM mints WHERE solveState = 'pending' ORDER BY tokenId ASC LIMIT 1"),
    setSolveState: db.prepare("UPDATE mints SET solveState = ? WHERE tokenId = ?"),
    completeSolve: db.prepare("UPDATE mints SET qr = ?, solveState = 'done' WHERE tokenId = ?"),
    bumpSolveTries: db.prepare("UPDATE mints SET solveTries = solveTries + 1 WHERE tokenId = ? RETURNING solveTries"),
    getMint: db.prepare("SELECT * FROM mints WHERE tokenId = ?"),
    requeueSolving: db.prepare("UPDATE mints SET solveState = 'pending' WHERE solveState = 'solving'"),
    tokenCount: db.prepare("SELECT COUNT(*) AS n FROM tokens"),
    insertMint: db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (?, ?, ?)"),
    reserveMark: db.prepare("INSERT INTO mark_orders (tokenId, upgradeId) VALUES (?, ?)"),
    markSold: db.prepare("SELECT COUNT(*) AS n FROM mark_orders WHERE upgradeId = ?"),
    hasMinted: db.prepare("SELECT COUNT(*) AS n FROM mints WHERE keyId = ?"),
  };

  return {
    /**
     * Credit one day to one token.
     *
     * Returns true when the credit was new and false when that token already
     * had that day. Any OTHER database error is rethrown: a swallowed error
     * here would report a healthy check-in on a broken database.
     */
    insertCredit(tokenId, day, sigHash) {
      try {
        s.insertCredit.run(tokenId, day, sigHash);
        return true;
      } catch (err) {
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
    },

    insertToken({ tokenId, keyId, owner, lastDay, mintDay }) {
      s.insertToken.run(tokenId, keyId, owner, lastDay, mintDay);
    },

    getToken: (tokenId) => s.getToken.get(tokenId),
    tokensForKey: (keyId) => s.tokensForKey.all(keyId),
    getKey: (keyId) => s.getKey.get(keyId),
    allKeys: () => s.allKeys.all(),

    /// How many keys are registered. COUNT(*) in SQLite, never allKeys().length
    /// -- allKeys returns every row INCLUDING the JWK JSON, which is the whole
    /// directory materialised in memory just to read one integer. At the
    /// 10,000-key cap that is 10,000 parsed rows per registration attempt, on a
    /// box that has been OOM-killed twice.
    keyCount: () => s.keyCount.get().n,
    insertKey: ({ keyId, jwk, directory, registeredAt }) =>
      s.insertKey.run(keyId, JSON.stringify(jwk), directory ?? null, registeredAt),

    /// Token ids are assigned here, not by the contract. The contract takes the
    /// id as an argument and reverts if it is taken, so the id promised to an
    /// agent at mint is the id that lands.
    nextTokenId: () => (s.maxTokenId.get().maxId ?? 0) + 1,

    firstMintDay: (keyId) => s.firstMintDay.get(keyId).d ?? 0,
    seedsSpent: (keyId) => s.seedsSpent.get(keyId).n,
    setLineage: (tokenId, generation, parentId) => s.setLineage.run(generation, parentId, tokenId),

    /**
     * Advance a token to the state a newly credited day leaves it in.
     *
     * THE MIRROR IS THE SOURCE OF TRUTH FOR THE TOOLS (schema.sql's own first
     * line): a token exists to an agent from the moment its action is queued,
     * not from the moment it is mined. So a credited day has to move the token
     * row too. Without this, `credits` filled up while `tokens.level` sat at 1
     * forever -- /t/<id> and `status` reported a token that never grew, and
     * `upgrade`'s minLevel/needsWhole/minStreak gates and `seed`'s
     * parent-whole gate all judged a value nothing advanced.
     *
     * The caller decides the new level and streak and writes this INSIDE the
     * same transaction as the credit row, so a credit and the level it implies
     * land together or not at all.
     */
    creditDay: (tokenId, day, level, streak) => s.creditDay.run(level, streak, day, tokenId),

    nextPendingMint: () => s.nextPendingMint.get() ?? null,
    setSolveState: (tokenId, state) => s.setSolveState.run(state, tokenId),
    completeSolve: (tokenId, qr) => s.completeSolve.run(qr, tokenId),
    bumpSolveTries: (tokenId) => s.bumpSolveTries.get(tokenId).solveTries,
    getMint: (tokenId) => s.getMint.get(tokenId),
    requeueSolving: () => s.requeueSolving.run().changes,
    tokenCount: () => s.tokenCount.get().n,
    insertMint: ({ tokenId, toAddress, keyId }) => s.insertMint.run(tokenId, toAddress, keyId),

    /// Returns true when the reservation was new, false when this token already
    /// holds that mark. Any OTHER database error is rethrown -- the same
    /// discrimination insertCredit makes, and for the same reason.
    reserveMark(tokenId, upgradeId) {
      try {
        s.reserveMark.run(tokenId, upgradeId);
        return true;
      } catch (err) {
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
    },
    /// How many of a mark have actually been reserved. Read from the mirror,
    /// never from the catalogue object: a static `sold` field is never
    /// incremented by anything, so the sold-out gate would never fire and the
    /// supply would be unlimited.
    markSold: (upgradeId) => s.markSold.get(upgradeId).n,
    hasMinted: (keyId) => s.hasMinted.get(keyId).n > 0,

    /// Run fn inside BEGIN/COMMIT, rolling back on any error. node:sqlite's
    /// DatabaseSync has no .transaction() helper (checked directly against
    /// this Node version), but BEGIN / COMMIT / ROLLBACK work and a rolled
    /// back write leaves zero rows. This is what makes a multi-statement
    /// write one fact instead of two separate ones a caller could observe
    /// half-applied.
    transact(fn) {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
