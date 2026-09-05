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
    // `bestRun` only ever rises, in SQL rather than in the caller, so a caller
    // that forgets to pass the larger of the two cannot lower it. Mirrors the
    // contract, where a run that was completed stays completed.
    creditDay: db.prepare(
      "UPDATE tokens SET level = ?, streak = ?, lastDay = ?, " +
        "bestRun = MAX(bestRun, ?) WHERE tokenId = ?"
    ),
    nextPendingMint: db.prepare("SELECT * FROM mints WHERE solveState = 'pending' ORDER BY tokenId ASC LIMIT 1"),
    setSolveState: db.prepare("UPDATE mints SET solveState = ? WHERE tokenId = ?"),
    completeSolve: db.prepare("UPDATE mints SET qr = ?, solveState = 'done' WHERE tokenId = ?"),
    bumpSolveTries: db.prepare("UPDATE mints SET solveTries = solveTries + 1 WHERE tokenId = ? RETURNING solveTries"),
    getMint: db.prepare("SELECT * FROM mints WHERE tokenId = ?"),
    requeueSolving: db.prepare("UPDATE mints SET solveState = 'pending' WHERE solveState = 'solving'"),
    tokenCount: db.prepare("SELECT COUNT(*) AS n FROM tokens"),
    setResting: db.prepare("UPDATE tokens SET resting = 1 WHERE tokenId = ?"),
    insertMint: db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (?, ?, ?)"),
    reserveMark: db.prepare("INSERT INTO mark_orders (tokenId, upgradeId, variant) VALUES (?, ?, ?)"),
    reservedMarks: db.prepare("SELECT upgradeId FROM mark_orders WHERE tokenId = ?"),
    markSold: db.prepare("SELECT COUNT(*) AS n FROM mark_orders WHERE upgradeId = ?"),
    hasMinted: db.prepare("SELECT COUNT(*) AS n FROM mints WHERE keyId = ?"),

    // --- the Clock's statements. Everything below is written by Plan 3 only;
    // the Warden queues rows and never marks one written.
    pendingMints: db.prepare(
      "SELECT m.tokenId, m.toAddress, m.keyId, m.qr, t.keyId AS agentKeyId FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        "WHERE m.status = 'queued' AND m.solveState = 'done' ORDER BY m.tokenId ASC"
    ),
    stuckMints: db.prepare(
      "SELECT tokenId, solveState, solveTries FROM mints WHERE status = 'queued' AND solveState = 'failed'"
    ),
    pendingCredits: db.prepare(
      "SELECT tokenId, day FROM credits WHERE status = 'queued' AND day <= ? ORDER BY day ASC, tokenId ASC"
    ),
    pendingMarkOrders: db.prepare(
      "SELECT tokenId, upgradeId, variant FROM mark_orders WHERE status = 'queued' ORDER BY tokenId ASC"
    ),
    stuckMarkOrders: db.prepare(
      "SELECT tokenId, upgradeId, variant FROM mark_orders WHERE status = 'failed' ORDER BY tokenId ASC, upgradeId ASC"
    ),
    failMarkOrder: db.prepare(
      "UPDATE mark_orders SET status = 'failed' WHERE tokenId = ? AND upgradeId = ?"
    ),
    markMintWritten: db.prepare("UPDATE mints SET status = 'written' WHERE tokenId = ?"),
    markTokenWritten: db.prepare("UPDATE tokens SET status = 'written' WHERE tokenId = ?"),
    markCreditWritten: db.prepare("UPDATE credits SET status = 'written' WHERE tokenId = ? AND day = ?"),
    markOrderWritten: db.prepare(
      "UPDATE mark_orders SET status = 'written' WHERE tokenId = ? AND upgradeId = ?"
    ),
    setOwner: db.prepare("UPDATE tokens SET owner = ? WHERE tokenId = ?"),
    setKeyId: db.prepare("UPDATE tokens SET keyId = ? WHERE tokenId = ?"),
    setMarkBit: db.prepare("UPDATE tokens SET marks = marks | ? WHERE tokenId = ?"),
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

    /// Record that the chain says this token is sealed. One way only: `rest` is
    /// irreversible on chain, so there is deliberately no way to clear it.
    setResting: (tokenId) => s.setResting.run(tokenId),
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
    creditDay: (tokenId, day, level, streak) =>
      s.creditDay.run(level, streak, day, streak, tokenId),

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
    reserveMark(tokenId, upgradeId, variant = 0) {
      try {
        s.reserveMark.run(tokenId, upgradeId, variant);
        return true;
      } catch (err) {
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
    },
    /**
     * Every Mark this token has RESERVED, in the same bitmask shape
     * `tokens.marks` uses.
     *
     * WHY IT IS NEEDED. `tokens.marks` is written by markOrderWritten alone,
     * and only the Clock calls that, after a successful on-chain applyMark. So
     * from a purchase until the next 00:05 UTC run -- up to 24 hours -- the
     * mirror's mask does not include what the token has already bought. Every
     * decision made from `tokens.marks` alone is blind for that window, which
     * is how both sides of one exclusive pair were sold to one token.
     *
     * EVERY ROW COUNTS, whatever its status, and this deliberately does not
     * filter. A 'written' row is already in `tokens.marks` so it adds nothing.
     * A 'queued' row is the whole point. A 'failed' row -- the terminal state
     * for an order the chain will never accept -- stays counted because money
     * moved and the row is waiting for a human: freeing the partner would sell
     * the other side of a pair whose first side may yet be resolved in the
     * agent's favour. A refusal can be undone by a human; a second sale cannot.
     * It is also what the unique index does, which holds no status either.
     */
    reservedMask: (tokenId) =>
      s.reservedMarks.all(tokenId).reduce((mask, r) => mask | (1 << r.upgradeId), 0),

    /// How many of a mark have actually been reserved. Read from the mirror,
    /// never from the catalogue object: a static `sold` field is never
    /// incremented by anything, so the sold-out gate would never fire and the
    /// supply would be unlimited.
    markSold: (upgradeId) => s.markSold.get(upgradeId).n,
    hasMinted: (keyId) => s.hasMinted.get(keyId).n > 0,

    // --- the Clock's surface ------------------------------------------------

    /// Mints ready to be written: paid for, and their artwork solved. A mint
    /// whose solve has NOT finished is deliberately absent -- the contract
    /// writes `code` once and permanently, so a token minted without its
    /// bitmap is broken forever rather than merely late.
    pendingMints: () => s.pendingMints.all(),

    /// Mints that can never proceed on their own. The agent has paid and has
    /// nothing, so a human has to see these.
    stuckMints: () => s.stuckMints.all(),

    /// Credits for days that have CLOSED. A check-in at 00:03 belongs to
    /// tomorrow's batch, which is why this is bounded rather than "everything".
    pendingCredits: (throughDay) => s.pendingCredits.all(throughDay),

    pendingMarkOrders: () => s.pendingMarkOrders.all(),

    /**
     * Mark orders the chain refused outright. The `mints` pattern, applied to
     * the one queue that lacked it.
     *
     * A row whose applyMark reverted on SIMULATION will revert again tomorrow
     * for the same reason -- an exclusion is permanent, `rest` is irreversible,
     * and a Mark the ladder no longer gates the way the chain does is a wiring
     * error, not a delay. Without a terminal state the Clock re-sent that call
     * every night and alerted every night, which is how a real problem becomes
     * something a human learns to scroll past.
     */
    stuckMarkOrders: () => s.stuckMarkOrders.all(),

    /// Move one order to its terminal state. There is deliberately no way back:
    /// requeueing a Mark the chain refused is a decision for a human who has
    /// read the alert, not something the Clock should do to itself.
    failMarkOrder: (tokenId, upgradeId) => s.failMarkOrder.run(tokenId, upgradeId),

    /// A mint landed: both rows move together, because a written token with a
    /// queued mint (or the reverse) is a state nothing else in this service
    /// knows how to read.
    markMintWritten(tokenId) {
      s.markMintWritten.run(tokenId);
      s.markTokenWritten.run(tokenId);
    },
    markCreditWritten: (tokenId, day) => s.markCreditWritten.run(tokenId, day),

    /// A Mark landed. The bit is set here rather than by the Warden, because
    /// until the chain has it the token does not really carry the Mark.
    markOrderWritten(tokenId, upgradeId) {
      s.markOrderWritten.run(tokenId, upgradeId);
      s.setMarkBit.run(1 << upgradeId, tokenId);
    },

    /// Facts only the chain knows: a transfer or a rebind the Warden never saw.
    setOwner: (tokenId, owner) => s.setOwner.run(owner, tokenId),
    setKeyId: (tokenId, keyId) => s.setKeyId.run(keyId, tokenId),

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
