// Every statement the tools use, prepared once, in one file.
//
// Prepared statements are reused across calls, so the SQL is parsed once per
// process rather than once per request.

// The ONE converter between a thumbprint and the bytes32 the contract stores.
// Imported rather than reimplemented, for the reason keyId.mjs gives.
import { keyIdToBytes32 } from "../mcp/keyId.mjs";

/// The exact SQLite error for a violated UNIQUE index. Matching on the message
/// rather than catching everything is deliberate: a dropped table and a
/// duplicate check-in must not look the same to a caller.
const UNIQUE_VIOLATION = /UNIQUE constraint failed/;

/**
 * One signed payment authorisation, presented for a second effect.
 *
 * Its own class rather than a boolean, because the two reservation paths sit
 * inside transactions their callers own and a throw is the only thing that
 * unwinds those. Named so a caller can tell it apart from the unique-index
 * refusals that mean "you already have this", which are an ordinary answer.
 */
export class PaymentNonceReusedError extends Error {
  constructor(payNonce) {
    super(`payment authorisation ${payNonce} has already been used`);
    this.name = "PaymentNonceReusedError";
    this.payNonce = payNonce;
  }
}

/**
 * How long a reservation may sit unsettled before it is treated as dead.
 *
 * A paid row is written by the tool handler and promoted by the settlement
 * hook, and those two moments are one HTTP round trip to the facilitator apart
 * -- seconds. Ten minutes is therefore enormous slack, chosen because the cost
 * of being wrong is asymmetric: expiring a live reservation too early would
 * take money for a row that then vanished, while expiring one too late only
 * makes an agent wait before it can retry.
 *
 * It has to exist at all because @x402/mcp has no failure hook. `onAfterSettlement`
 * fires only on success, so a settlement that fails tells this service nothing
 * whatsoever -- the reservation simply never gets promoted, and without an
 * expiry it would hold its slot in the unique index forever. For `mints` that
 * index is on keyId, so a single failed settlement would lock that agent out of
 * minting permanently.
 */
export const RESERVATION_TTL_MS = 10 * 60_000;

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
      "INSERT OR REPLACE INTO keys (keyId, jwk, directory, registeredAt, keyIdHash) " +
        "VALUES (?, ?, ?, ?, ?)"
    ),
    /// Which registered key is this, given only the form the CONTRACT stores?
    /// The hash is one way, so this is the only way back -- and it is why the
    /// column exists.
    keyForHash: db.prepare("SELECT keyId FROM keys WHERE keyIdHash = ?"),
    getKey: db.prepare("SELECT * FROM keys WHERE keyId = ?"),
    allKeys: db.prepare("SELECT * FROM keys ORDER BY registeredAt ASC"),
    keyCount: db.prepare("SELECT COUNT(*) AS n FROM keys"),
    claimPayNonce: db.prepare("INSERT INTO pay_nonces (payNonce, tool, claimedAt) VALUES (?, ?, ?)"),
    payNonceClaim: db.prepare("SELECT * FROM pay_nonces WHERE payNonce = ?"),
    /// Written at most once a day per key -- see markKeyUsed.
    touchKey: db.prepare("UPDATE keys SET lastUsedAt = ? WHERE keyId = ? AND (lastUsedAt IS NULL OR lastUsedAt < ?)"),
    /// Only ever NEVER-USED keys. A key that has been through the door keeps
    /// its row for good: it may be bound to a token on chain, and that binding
    /// is permanent.
    pruneUnusedKeys: db.prepare("DELETE FROM keys WHERE lastUsedAt IS NULL AND registeredAt < ?"),
    firstMintDay: db.prepare("SELECT MIN(mintDay) AS d FROM tokens WHERE keyId = ?"),
    seedsSpent: db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE keyId = ? AND parentId IS NOT NULL"),
    // 5.M3. How many children a token has seeded. Counted rather than stored,
    // so it cannot drift from the rows it describes.
    childCount: db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE parentId = ?"),
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
    insertMint: db.prepare(
      "INSERT INTO mints (tokenId, toAddress, keyId, payNonce, reservedAt, status) " +
        "VALUES (?, ?, ?, ?, ?, 'awaiting-payment')"
    ),
    // --- lineage: the free route --------------------------------------------
    insertSeedToken: db.prepare(
      "INSERT INTO tokens (tokenId, keyId, owner, lastDay, mintDay, parentId, generation) " +
        // The child's generation is the PARENT's plus one, read in the same
        // statement so it cannot drift from the chain's p.generation + 1. The
        // parent id is bound twice because it is both the column value and the
        // subselect's key; a parent that does not exist makes this NULL, which
        // the NOT NULL column refuses -- a child with no parent is exactly the
        // row nothing downstream could interpret.
        "VALUES (?, ?, ?, ?, ?, ?, (SELECT generation + 1 FROM tokens WHERE tokenId = ?))"
    ),
    insertSeedMint: db.prepare(
      // payNonce and reservedAt are deliberately absent: a free row must not be
      // reachable by expiredMints or by staleRows, both of which require a
      // reservation. The same treatment the four EARNED Marks already get.
      "INSERT INTO mints (tokenId, toAddress, keyId, status) VALUES (?, ?, ?, 'queued')"
    ),
    // BOTH deletes carry BOTH guards, and each rules out a different disaster.
    //
    // `parentId IS NOT NULL` means a bug in the Clock can never take a FOUNDING
    // token's rows: those were paid for and are on chain, and they are the one
    // thing here nobody can recreate.
    //
    // `status != 'written'` means a child that is ALREADY ON CHAIN cannot be
    // deleted either. Without it, dropping a written seed removed both rows and
    // handed the budget back, while the token went on existing on chain forever
    // -- and nothing heals that: reconcile only LOGS `Seeded`, so `/t/<childId>`
    // would 404 for the life of the piece. The contract still refuses the
    // over-spend loudly (NoSeedAvailable), so it is not a free second seed; it
    // is an unrecoverable hole in the mirror. A seed that FAILED to write is
    // still 'queued', so nothing legitimate is blocked.
    //
    // The mints half reads the tokens row, so it has to run BEFORE the tokens
    // half -- after it, the guard would find nothing and refuse to delete
    // anything.
    deleteSeedMint: db.prepare(
      "DELETE FROM mints WHERE tokenId = ? AND status != 'written' AND EXISTS " +
        "(SELECT 1 FROM tokens t WHERE t.tokenId = mints.tokenId AND t.parentId IS NOT NULL)"
    ),
    deleteSeedToken: db.prepare(
      "DELETE FROM tokens WHERE tokenId = ? AND parentId IS NOT NULL AND status != 'written'"
    ),

    reserveMark: db.prepare("INSERT INTO mark_orders (tokenId, upgradeId, variant) VALUES (?, ?, ?)"),
    reserveMarkPaid: db.prepare(
      "INSERT INTO mark_orders (tokenId, upgradeId, variant, payNonce, reservedAt, status) " +
        "VALUES (?, ?, ?, ?, ?, 'awaiting-payment')"
    ),

    // --- settlement -----------------------------------------------------
    // Promotion is keyed on the payment nonce, which is the only identifier
    // both sides of the settlement share: the handler knows it because it signed
    // for it, and @x402/mcp's onAfterSettlement hook receives the same payload.
    // The tool's own return value is NOT available to that hook, so a token id
    // cannot be used.
    settleMint: db.prepare(
      "UPDATE mints SET status = 'queued', paymentTx = ? " +
        "WHERE payNonce = ? AND status = 'awaiting-payment' RETURNING tokenId"
    ),
    settleMintToken: db.prepare("UPDATE tokens SET status = 'queued' WHERE tokenId = ?"),
    setTokenAwaitingPayment: db.prepare("UPDATE tokens SET status = 'awaiting-payment' WHERE tokenId = ?"),
    settleMarkOrder: db.prepare(
      "UPDATE mark_orders SET status = 'queued', paymentTx = ? " +
        "WHERE payNonce = ? AND status = 'awaiting-payment' RETURNING tokenId, upgradeId"
    ),

    // One named reservation, released because its settlement is known to have
    // failed. Same shape as the expiry sweep below, keyed on the nonce rather
    // than on age.
    mintForNonce: db.prepare(
      "SELECT tokenId FROM mints WHERE payNonce = ? AND status = 'awaiting-payment'"
    ),
    dropMarkOrderForNonce: db.prepare(
      "DELETE FROM mark_orders WHERE payNonce = ? AND status = 'awaiting-payment'"
    ),

    // Reservations nobody ever paid for. `payNonce IS NOT NULL` keeps this away
    // from rows written before these columns existed, which have no reservedAt
    // and must never be swept.
    expiredMints: db.prepare(
      "SELECT tokenId FROM mints WHERE status = 'awaiting-payment' " +
        "AND payNonce IS NOT NULL AND reservedAt < ?"
    ),
    dropMint: db.prepare("DELETE FROM mints WHERE tokenId = ?"),
    dropMintToken: db.prepare("DELETE FROM tokens WHERE tokenId = ?"),
    dropExpiredMarkOrders: db.prepare(
      "DELETE FROM mark_orders WHERE status = 'awaiting-payment' " +
        "AND payNonce IS NOT NULL AND reservedAt < ?"
    ),
    reservedMarks: db.prepare("SELECT upgradeId FROM mark_orders WHERE tokenId = ?"),
    // 5.M7. The subset of those the CHAIN refused outright. reservedMask
    // deliberately counts a failed row -- a refusal can be undone by a human, a
    // second sale cannot -- but nothing could SEE that, so `ladder` reported
    // such a Mark as plain `held` and its partner as permanently `closed`.
    failedMarks: db.prepare("SELECT upgradeId FROM mark_orders WHERE tokenId = ? AND status = 'failed'"),
    markSold: db.prepare("SELECT COUNT(*) AS n FROM mark_orders WHERE upgradeId = ?"),
    hasMinted: db.prepare("SELECT COUNT(*) AS n FROM mints WHERE keyId = ?"),

    // --- the Clock's statements. Everything below is written by Plan 3 only;
    // the Warden queues rows and never marks one written.
    pendingMints: db.prepare(
      "SELECT m.tokenId, m.toAddress, m.keyId, m.qr, t.keyId AS agentKeyId FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        // A CHILD IS NOT A MINT. `seed` and `mint` are different functions with
        // different arguments, and a child sent through the mint pass reverts
        // for a reason no agent could act on.
        "WHERE m.status = 'queued' AND m.solveState = 'done' AND t.parentId IS NULL " +
        "ORDER BY m.tokenId ASC"
    ),
    pendingSeeds: db.prepare(
      "SELECT m.tokenId, m.toAddress, m.qr, t.parentId, t.keyId AS agentKeyId FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        "WHERE m.status = 'queued' AND m.solveState = 'done' AND t.parentId IS NOT NULL " +
        "ORDER BY m.tokenId ASC"
    ),
    stuckMints: db.prepare(
      "SELECT m.tokenId, m.solveState, m.solveTries FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        // The seed half is split out because the ALERT is different, not just
        // the query: this one says the agent has PAID and has nothing, which
        // is untrue of a seed and would send a human looking for a refund.
        "WHERE m.status = 'queued' AND m.solveState = 'failed' AND t.parentId IS NULL"
    ),
    stuckSeeds: db.prepare(
      "SELECT m.tokenId, m.solveState, m.solveTries, t.parentId FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        "WHERE m.status = 'queued' AND m.solveState = 'failed' AND t.parentId IS NOT NULL"
    ),
    pendingCredits: db.prepare(
      "SELECT tokenId, day FROM credits WHERE status = 'queued' AND day <= ? ORDER BY day ASC, tokenId ASC"
    ),
    pendingMarkOrders: db.prepare(
      "SELECT tokenId, upgradeId, variant FROM mark_orders WHERE status = 'queued' ORDER BY tokenId ASC"
    ),
    // 4.L3. Rows that have survived N runs without landing, counted from data
    // the mirror already holds rather than from a new column: a credit carries
    // the DAY it is for, and a queued mint or order carries when it was
    // reserved. No migration, and nothing to keep in step with the runs.
    staleCredits: db.prepare(
      "SELECT tokenId, day FROM credits WHERE status = 'queued' AND day <= ? ORDER BY day ASC, tokenId ASC"
    ),
    staleMints: db.prepare(
      "SELECT tokenId FROM mints WHERE status = 'queued' AND reservedAt IS NOT NULL AND reservedAt <= ? ORDER BY tokenId ASC"
    ),
    staleMarkOrders: db.prepare(
      "SELECT tokenId, upgradeId FROM mark_orders WHERE status = 'queued' AND reservedAt IS NOT NULL AND reservedAt <= ? ORDER BY tokenId ASC"
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
    failCredit: db.prepare("UPDATE credits SET status = 'failed' WHERE tokenId = ? AND day = ?"),
    stuckCredits: db.prepare(
      "SELECT tokenId, day FROM credits WHERE status = 'failed' ORDER BY day ASC, tokenId ASC"
    ),
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

    /// Hold a freshly inserted token back until its payment settles. Called by
    /// `mint` inside the same transaction as the insert; `seed` does not, and
    /// must not, because a seed costs nothing.
    setTokenAwaitingPayment: (tokenId) => s.setTokenAwaitingPayment.run(tokenId),

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

    /**
     * Record that this key just got through the door.
     *
     * THROTTLED TO ONE WRITE A DAY per key. This runs on every admitted
     * request, and the only question anything asks of the value is "has this
     * key ever been used, and how long ago" -- a resolution of one day answers
     * it. The `lastUsedAt < ?` in the statement is what makes the write a
     * no-op rather than the caller having to read first, so two concurrent
     * requests cannot race each other into two updates.
     */
    markKeyUsed: (keyId, now = Date.now()) =>
      s.touchKey.run(now, keyId, now - 24 * 60 * 60 * 1000).changes,

    /**
     * Forget keys that registered and never used it.
     *
     * WHY THIS EXISTS. Registration is free and unauthenticated -- a fresh
     * Ed25519 keypair costs nothing -- so the per-thumbprint rate limit never
     * binds an attacker who uses a new key each time. The only aggregate limit
     * is MAX_TOTAL_KEYS, and reaching it IS the attack: every later
     * registration is refused forever, which shuts out exactly the agents that
     * have no domain of their own and no other way in.
     *
     * A key that has been through the door is NEVER pruned, whatever its age.
     * It may be the key a token is bound to on chain, and that binding is
     * permanent; forgetting it would break the rebind lookup and the
     * seed budget. Only `lastUsedAt IS NULL` is a candidate.
     *
     * Returns how many rows went, so the caller can log a real number.
     */
    pruneUnusedKeys: (before) => s.pruneUnusedKeys.run(before).changes,
    insertKey: ({ keyId, jwk, directory, registeredAt }) =>
      s.insertKey.run(
        keyId,
        JSON.stringify(jwk),
        directory ?? null,
        registeredAt,
        // Computed HERE, on the way in, so no caller can register a key without
        // it and leave a Rebound to that key unresolvable later.
        keyIdToBytes32(keyId)
      ),

    /**
     * The registered key id matching an on-chain bytes32, or null.
     *
     * A null is NOT "no such key" in any useful sense -- it means this Warden
     * has never seen the key the token was rebound to, which is entirely
     * legitimate: an agent can rebind to a key it has not registered here yet.
     * The caller has to treat that as "the mirror's binding is now wrong and
     * cannot be corrected", never as "the rebind did not happen".
     */
    keyForHash: (hash) => s.keyForHash.get(hash)?.keyId ?? null,

    /// Token ids are assigned here, not by the contract. The contract takes the
    /// id as an argument and reverts if it is taken, so the id promised to an
    /// agent at mint is the id that lands.
    nextTokenId: () => (s.maxTokenId.get().maxId ?? 0) + 1,

    firstMintDay: (keyId) => s.firstMintDay.get(keyId).d ?? 0,
    seedsSpent: (keyId) => s.seedsSpent.get(keyId).n,
    childCount: (tokenId) => s.childCount.get(tokenId).n,
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
    /**
     * Claim a payment authorisation for one tool call, once and for all.
     *
     * Returns true when this nonce had never been claimed, false when it had.
     * MUST be called inside the same transaction as the reservation it is
     * claiming for -- a claim that commits separately from the row it protects
     * is two facts a caller can observe half-applied, which is the exact
     * failure it exists to prevent.
     *
     * A false is not an error condition to be logged and shrugged at. It means
     * one signed authorisation was presented for two different effects, which
     * an honest client cannot do by accident.
     */
    claimPayNonce(payNonce, tool, now = Date.now()) {
      if (!payNonce) throw new Error("claimPayNonce needs a payment nonce");
      try {
        s.claimPayNonce.run(payNonce, tool, now);
        return true;
      } catch (err) {
        // Same discrimination as insertCredit and reserveMark: a duplicate is
        // an answer, anything else is a fault.
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
    },

    /// What claimed this nonce, or undefined. For tests and for an operator
    /// asking why a payment was refused.
    payNonceClaim: (payNonce) => s.payNonceClaim.get(payNonce),

    /**
     * Reserve a mint against a payment that has NOT yet settled.
     *
     * Every mint is paid for, so there is no unpaid variant of this and
     * `payNonce` is required rather than optional -- a caller that could omit
     * it would write a row no settlement could ever find, which is a free
     * token. The row lands as 'awaiting-payment' and only settleByNonce moves
     * it to the 'queued' the Clock reads.
     */
    insertMint({ tokenId, toAddress, keyId, payNonce, now = Date.now() }) {
      if (!payNonce) throw new Error("insertMint needs the payment nonce that will settle it");
      // THE ROW FIRST, THE CLAIM SECOND. If the unique index refuses this mint
      // the throw unwinds both, so an agent refused for a reason of its own
      // does not also lose its authorisation. The caller already holds a
      // transaction (mint.mjs wraps both rows in one), so this claims inside
      // it and any rollback un-claims with it.
      s.insertMint.run(tokenId, toAddress, keyId, payNonce, now);
      if (!this.claimPayNonce(payNonce, "mint", now)) {
        throw new PaymentNonceReusedError(payNonce);
      }
    },

    /**
     * Reserve a SEEDED CHILD, which costs nothing.
     *
     * Queued outright, because nothing settles on this route and there is
     * therefore no window in which the mirror could be believing in a payment
     * that never arrives -- the same reasoning as reserveMark below.
     *
     * A SEPARATE METHOD rather than a flag on insertMint, which throws without
     * a payment nonce. The rule is the one written beside reserveMark and
     * reserveMarkPaid: a boolean argument in a money path is exactly the seam
     * where something expensive gets handed out for free.
     *
     * THIS METHOD OWNS ITS TRANSACTION, unlike insertMint, which deliberately
     * does not because mint.mjs already holds one. node:sqlite has no nested
     * transactions, so calling this from inside a `q.transact` throws "cannot
     * start a transaction within a transaction" -- call it at the top level.
     *
     * BOTH ROWS LAND IN ONE TRANSACTION. The tokens row IS the reservation --
     * seedsSpent counts `parentId IS NOT NULL` -- so a half-written pair would
     * either spend a seed with nothing to write, or write with no seed spent.
     * A key earns one seed per completed agent-year and can never earn that
     * year again, so the rollback is what makes a failed reservation free.
     */
    insertSeed({ childId, parentId, toAddress, keyId, lastDay, mintDay }) {
      return this.transact(() => {
        s.insertSeedToken.run(childId, keyId, toAddress, lastDay, mintDay, parentId, parentId);
        s.insertSeedMint.run(childId, toAddress, keyId);
      });
    },

    /**
     * A seed the chain will never accept.
     *
     * Deleting BOTH rows is what returns the key's seed for this agent-year,
     * because seedsSpent counts the tokens row. A once-a-year budget burned on
     * a child the chain never heard of is the worst failure this feature has,
     * and it is a SILENT one: a free row has no reservedAt, so neither the
     * expiry sweep nor staleRows would ever mention it.
     *
     * Both statements refuse a token with no parent, so this can never be the
     * thing that deletes a founding token.
     */
    dropSeed(childId) {
      return this.transact(() => {
        s.deleteSeedMint.run(childId);
        s.deleteSeedToken.run(childId);
      });
    },

    /**
     * Reserve an EARNED Mark, which costs nothing.
     *
     * Queued outright, because nothing settles on that route and there is
     * therefore no window in which the mirror could be believing in a payment
     * that never arrives. The paid route has its own method by name rather than
     * a flag on this one: a boolean argument in a money path is exactly the
     * seam where a $1,250.00 Mark gets handed out for free.
     *
     * Returns true when the reservation was new, false when this token already
     * holds that mark. Any OTHER database error is rethrown -- the same
     * discrimination insertCredit makes, and for the same reason.
     */
    reserveMark(tokenId, upgradeId, variant = 0) {
      try {
        s.reserveMark.run(tokenId, upgradeId, variant);
        return true;
      } catch (err) {
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
    },

    /// Reserve a BOUGHT Mark against a payment that has not yet settled. Same
    /// contract as reserveMark, and the same false on a duplicate.
    reserveMarkPaid(tokenId, upgradeId, variant, payNonce, now = Date.now()) {
      if (!payNonce) throw new Error("reserveMarkPaid needs the payment nonce that will settle it");
      // One transaction, so a claimed nonce and the order it paid for land
      // together or not at all. Unlike mint's path this one owns the
      // transaction, because its caller does not.
      return this.transact(() => {
        // Same order as insertMint: the reservation first, so a token that
        // already holds this Mark is refused WITHOUT burning the agent's
        // authorisation. Only a reservation that actually landed claims one.
        try {
          s.reserveMarkPaid.run(tokenId, upgradeId, variant, payNonce, now);
        } catch (err) {
          if (UNIQUE_VIOLATION.test(err.message)) return false;
          throw err;
        }
        if (!this.claimPayNonce(payNonce, "upgrade", now)) {
          throw new PaymentNonceReusedError(payNonce);
        }
        return true;
      });
    },

    /**
     * The money landed: promote whatever this nonce reserved.
     *
     * One nonce belongs to one tool call, so at most one row moves -- both
     * tables are tried because the gateway is shared by `mint` and `upgrade`
     * and must not need to know which one it just wrapped.
     *
     * Returns what moved, so the caller can alert on a settlement that matched
     * nothing. That case means money moved for a reservation this service
     * cannot find -- an expired row already swept, or a restart between the
     * handler and the hook -- and it is the one outcome that must never be
     * silent, because the agent has paid.
     */
    settleByNonce(payNonce, paymentTx) {
      return this.transact(() => {
        const mint = s.settleMint.get(paymentTx, payNonce);
        if (mint) {
          // The token row moves with its mint row, for the same reason they are
          // inserted together: a queued mint beside an awaiting-payment token is
          // a state nothing else in this service knows how to read.
          s.settleMintToken.run(mint.tokenId);
          return { kind: "mint", tokenId: mint.tokenId };
        }
        const order = s.settleMarkOrder.get(paymentTx, payNonce);
        if (order) return { kind: "mark", tokenId: order.tokenId, upgradeId: order.upgradeId };
        return null;
      });
    },

    /**
     * Release one reservation whose payment is KNOWN to have failed.
     *
     * The expiry sweep below would eventually do this, and waiting for it is
     * the difference between an agent retrying now and an agent locked out of
     * minting for ten minutes over a facilitator hiccup. The gateway can tell
     * the difference because it knows whether the settlement hook fired for
     * this exact nonce, so the common failure is handled precisely and the
     * sweep is left as a backstop for the uncommon one -- a crash between the
     * handler and the settle, where nothing is left running to notice.
     *
     * Returns what was released, or null when there was nothing to release
     * (the handler refused before reserving, which is the ordinary case).
     */
    releaseReservation(payNonce) {
      if (!payNonce) return null;
      return this.transact(() => {
        const mint = s.mintForNonce.get(payNonce);
        if (mint) {
          s.dropMintToken.run(mint.tokenId);
          s.dropMint.run(mint.tokenId);
          return { kind: "mint", tokenId: mint.tokenId };
        }
        const marks = s.dropMarkOrderForNonce.run(payNonce).changes;
        return marks ? { kind: "mark" } : null;
      });
    },

    /**
     * Clear reservations nobody ever paid for.
     *
     * Called before each new reservation rather than on a timer: the only thing
     * a dead row can actually harm is the next agent to want its slot in the
     * unique index, so that is exactly when it is worth removing. No background
     * sweeper, no clock.
     *
     * A mint's token row goes with it. mint.mjs writes both inside one
     * transaction precisely because a token with no mint record holds a
     * supply-cap slot no mint will ever claim; undoing half of that would
     * recreate the orphan it exists to prevent.
     */
    dropExpiredReservations(before = Date.now() - RESERVATION_TTL_MS) {
      return this.transact(() => {
        const dead = s.expiredMints.all(before);
        for (const { tokenId } of dead) {
          s.dropMintToken.run(tokenId);
          s.dropMint.run(tokenId);
        }
        const marks = s.dropExpiredMarkOrders.run(before).changes;
        return { mints: dead.length, marks };
      });
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
     * A 'queued' row is the whole point. An 'awaiting-payment' row counts for
     * the window it lives in, which is what stops both sides of an exclusive
     * pair being sold inside the seconds a settlement takes; if that payment
     * never lands the row is swept and the partner frees itself.
     * A 'failed' row -- the terminal state
     * for an order the chain will never accept -- stays counted because money
     * moved and the row is waiting for a human: freeing the partner would sell
     * the other side of a pair whose first side may yet be resolved in the
     * agent's favour. A refusal can be undone by a human; a second sale cannot.
     * It is also what the unique index does, which holds no status either.
     */
    reservedMask: (tokenId) =>
      s.reservedMarks.all(tokenId).reduce((mask, r) => mask | (1 << r.upgradeId), 0),

    /**
     * The Marks this token reserved that the CHAIN then refused outright.
     *
     * A subset of reservedMask, and it exists so the difference is visible.
     * Those rows still occupy their side of a pair -- which is right, because
     * releasing one would let a second sale race a human's correction -- but
     * reporting them as `held` told an agent it owns a Mark that does not exist
     * and that the partner is closed forever, when what is actually true is
     * that a human has to look.
     */
    failedMask: (tokenId) =>
      s.failedMarks.all(tokenId).reduce((mask, r) => mask | (1 << r.upgradeId), 0),

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

    /// Seeds ready to be written, on the same rule as pendingMints above: the
    /// child's `code` is written once and permanently, so an unsolved bitmap
    /// makes a permanently broken artwork out of a merely late one.
    pendingSeeds: () => s.pendingSeeds.all(),

    /// Mints that can never proceed on their own. The agent has paid and has
    /// nothing, so a human has to see these.
    stuckMints: () => s.stuckMints.all(),

    /// The same, for seeds. Nobody paid, so the money is not the problem -- but
    /// the agent has spent one of the few seeds it will ever have, and only a
    /// human can decide whether to drop the row and give the year back.
    stuckSeeds: () => s.stuckSeeds.all(),

    /// Credits for days that have CLOSED. A check-in at 00:03 belongs to
    /// tomorrow's batch, which is why this is bounded rather than "everything".
    pendingCredits: (throughDay) => s.pendingCredits.all(throughDay),

    pendingMarkOrders: () => s.pendingMarkOrders.all(),

    /**
     * Everything still queued after `runs` nightly runs, for the alert the spec
     * asks for and nothing implemented.
     *
     * MEASURED FROM WHAT IS ALREADY STORED. A credit is for a day, so a queued
     * credit whose day is `runs` days behind today has been offered that many
     * times; a mint or an order carries `reservedAt`. Neither needs a run
     * counter, and adding a column to three tables to count something two
     * existing columns already imply is how a schema drifts.
     *
     * `reservedAt IS NOT NULL` skips the four EARNED Marks, which are queued
     * with no reservation at all. They are not stale, they are free.
     */
    staleRows(today, now = Date.now(), runs = 3) {
      const before = now - runs * 86_400_000;
      return {
        credits: s.staleCredits.all(today - runs),
        mints: s.staleMints.all(before),
        markOrders: s.staleMarkOrders.all(before),
      };
    },

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
    ///
    /// 4.L1: "together" was a comment and not a fact -- the two statements ran
    /// outside any transaction, so a crash between them (or a SIGKILL, which
    /// the Clock's unit could deliver until 16.7) left exactly the half-applied
    /// state the comment promised was impossible. `transact` is what makes the
    /// sentence true.
    markMintWritten(tokenId) {
      this.transact(() => {
        s.markMintWritten.run(tokenId);
        s.markTokenWritten.run(tokenId);
      });
    },
    /// A seed landed. Deliberately the SAME two statements markMintWritten
    /// runs, and deliberately its own name: 'written' means the identical thing
    /// on both routes, but a Clock pass that sends `seed` must never read as
    /// one that sends `mint`. Duplicating the SQL to make the two look
    /// different would be two facts where there is one.
    markSeedWritten(tokenId) {
      this.transact(() => {
        s.markMintWritten.run(tokenId);
        s.markTokenWritten.run(tokenId);
      });
    },
    markCreditWritten: (tokenId, day) => s.markCreditWritten.run(tokenId, day),

    /**
     * A credit the chain condemned. Terminal, and deliberately with no way back:
     * requeueing something the chain refused is a decision for a human who has
     * read the alert, exactly as it is for a mark order.
     *
     * This is NOT for a day the chain already holds -- that is the mirror being
     * behind, and it is marked WRITTEN by the Clock's heal path. Failing it
     * would tell an operator a landed day had been lost.
     */
    failCredit: (tokenId, day) => s.failCredit.run(tokenId, day),

    /// Credits waiting for a human. The `stuckMints` / `stuckMarkOrders`
    /// pattern, applied to the one queue that lacked it.
    stuckCredits: () => s.stuckCredits.all(),

    /// A Mark landed. The bit is set here rather than by the Warden, because
    /// until the chain has it the token does not really carry the Mark.
    ///
    /// 4.L1, and this half is the one that costs money: a crash between the two
    /// statements leaves a 'written' order whose bit is not in `tokens.marks`,
    /// and the exclusion check reads that mask -- so the token could then be
    /// sold the other side of a pair the chain has already closed. One
    /// transaction, so the row and the mask are one fact.
    markOrderWritten(tokenId, upgradeId) {
      this.transact(() => {
        s.markOrderWritten.run(tokenId, upgradeId);
        s.setMarkBit.run(1 << upgradeId, tokenId);
      });
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
