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
    /// Written at most once a day per key -- see markKeyUsed.
    touchKey: db.prepare("UPDATE keys SET lastUsedAt = ? WHERE keyId = ? AND (lastUsedAt IS NULL OR lastUsedAt < ?)"),
    /// Only ever NEVER-USED keys. A key that has been through the door keeps
    /// its row for good: it may be bound to a token on chain, and that binding
    /// is permanent.
    pruneUnusedKeys: db.prepare("DELETE FROM keys WHERE lastUsedAt IS NULL AND registeredAt < ?"),
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
    insertMint: db.prepare(
      "INSERT INTO mints (tokenId, toAddress, keyId, payNonce, reservedAt, status) " +
        "VALUES (?, ?, ?, ?, ?, 'awaiting-payment')"
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
     * Reserve a mint against a payment that has NOT yet settled.
     *
     * Every mint is paid for, so there is no unpaid variant of this and
     * `payNonce` is required rather than optional -- a caller that could omit
     * it would write a row no settlement could ever find, which is a free
     * token. The row lands as 'awaiting-payment' and only settleByNonce moves
     * it to the 'queued' the Clock reads.
     */
    insertMint: ({ tokenId, toAddress, keyId, payNonce, now = Date.now() }) => {
      if (!payNonce) throw new Error("insertMint needs the payment nonce that will settle it");
      s.insertMint.run(tokenId, toAddress, keyId, payNonce, now);
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
      try {
        s.reserveMarkPaid.run(tokenId, upgradeId, variant, payNonce, now);
        return true;
      } catch (err) {
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
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
