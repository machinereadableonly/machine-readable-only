// warden/src/mcp/tools/ladder.mjs
//
// THE LADDER, READ BEFORE IT IS WALKED. `upgrade` names an exclusion too, but
// only in a refusal, and a refusal arrives after the choice has been made. Five
// pairs where taking either side closes the other permanently are only fair if
// the forfeit is legible in advance, so this answers the question `upgrade`
// cannot: what would I be giving up, and what am I still short of.
//
// Free, unsigned-in-effect and ownerless on purpose. It reads nothing but the
// mirror row and the catalogue: no payment wrapper, no chain read, no write.
import * as z from "zod";
import { VARIANT_NAMES, effectiveRun } from "../ladder.mjs";

/**
 * What a side is still short of, or undefined when nothing stands in its way.
 *
 * The ORDER is the whole of this function. Pair five's two sides carry a level
 * of 0 and a run of 0 and are gated on holding an Iris; asked in the other
 * order they would report no gate at all, which is exactly the misreading that
 * made an ungated Aura a trap. A side whose gates the token already meets says
 * nothing, because "waiting on a run of 7 days" told to a token with a run of
 * 400 reads as a refusal the agent cannot act on.
 *
 * The Iris requirement is measured against `token.marks` and NOT the union with
 * reservations, because `upgrade` gates it that way too: an Iris that has not
 * reached the chain does not satisfy the contract either, and applyMark would
 * revert MarkGate. So a token that bought an Iris this morning is told pair five
 * still waits on one, which is what it will actually be refused with.
 */
function waitingOn(mark, token, catalogue) {
  if (mark.requiresAny && !(token.marks & mark.requiresAny)) {
    // The NAME comes from the catalogue rather than being written here, so a
    // rename cannot leave this promising something the ladder no longer sells.
    // "by either route" is true because the mask covers both Iris ids, 5 bought
    // and 6 earned -- the only requiresAny mask the catalogue has.
    const names = [...new Set(
      Object.values(catalogue).filter((m) => mark.requiresAny & (1 << m.id)).map((m) => m.name)
    )].join(" or ");
    return `${/^[aeiou]/i.test(names) ? "an" : "a"} ${names}, by either route`;
  }
  // "Level" is credited days and never falls; "run" is the live streak. Two
  // different numbers on the two sides of a pair, and reporting one for the
  // other would send an agent after the wrong thing for seventy days.
  if (mark.minStreak && effectiveRun(token) < mark.minStreak) return `a run of ${mark.minStreak} days`;
  if (mark.needsWhole && token.level < 365) return "a whole heart, 365 days";
  if (mark.minLevel && token.level < mark.minLevel) return `a level of ${mark.minLevel} days`;
  return undefined;
}

/// One side of one pair. `state` is the single field that says whether it can
/// still be taken: two booleans for one fact is how they drift apart.
///
/// `mask` is what the token has TAKEN -- its on-chain Marks unioned with what it
/// has bought and not yet had written -- rather than `token.marks`, which lags a
/// purchase by up to a day. `upgrade` refuses on that same union, and this tool
/// exists so the refusal is legible in advance: reporting as open a side that
/// `upgrade` will refuse is exactly the misreading it was built to prevent.
function sideOf(mark, token, catalogue, mask) {
  const held = Boolean(mask & (1 << mark.id));
  // A SEALED TOKEN CAN TAKE NOTHING. rest() is irreversible and applyMark
  // reverts Resting(id), so `upgrade` refuses all ten -- and five open pairs
  // with prices beside them would be quoting a price for something that cannot
  // be bought at any price. `resting` is learned lazily and can be false when
  // the chain says otherwise, so this only ever closes a door: a token this
  // mirror knows is sealed is sealed.
  const state = held ? "held" : (mask & mark.excludes) || token.resting ? "closed" : "open";
  const side = {
    id: mark.id,
    // Lower case, because this is the same token `upgrade`'s `mark-excluded`
    // detail returns and an agent should not have to case-fold to match them.
    name: mark.name.toLowerCase(),
    route: mark.route,
    state,
    price: mark.price,
  };
  // The two Marks with a choice cost $25.00 and $250.00, and the shape or the
  // ink IS what is being bought -- so the options are named, not counted.
  if (mark.variants > 1 && VARIANT_NAMES[mark.id]) side.variants = VARIANT_NAMES[mark.id];
  // A held or closed side is not waiting on anything: the gate is moot once the
  // pair is decided, and quoting it would read as a door still ajar.
  if (state === "open") {
    const gate = waitingOn(mark, token, catalogue);
    if (gate !== undefined) side.waitingOn = gate;
  }
  return side;
}

export function makeLadderTool({ q, catalogue }) {
  return {
    name: "ladder",
    config: {
      title: "Read the Mark ladder for a token",
      description: "Free. For each of the five pairs: what this token wears, what that has closed permanently, what each side costs and what it is still short of. Ask before you buy.",
      inputSchema: z.object({ tokenId: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },

    // No `ctx`. Deliberately NOT restricted to the caller's own tokens: the
    // point of this tool is that a consequence is readable before it is taken,
    // and `status` already serves any token by id.
    async handler({ tokenId }) {
      const token = q.getToken(tokenId);
      if (!token) return { ok: false, reason: "unknown-token" };

      // What the token has taken, on chain or at the door. See sideOf.
      const mask = token.marks | q.reservedMask(tokenId);

      const pairs = [];
      for (const mark of Object.values(catalogue).sort((a, b) => a.id - b.id)) {
        const side = sideOf(mark, token, catalogue, mask);
        let entry = pairs.find((p) => p.pair === mark.pair);
        if (!entry) pairs.push((entry = { pair: mark.pair, sides: [] }));
        entry.sides.push(side);
      }

      for (const entry of pairs) {
        // A pair is decided by the side that is worn, and the exclusion can only
        // ever be the OTHER side of the same pair -- every exclusion is
        // pair-internal, which is why one name is the whole answer.
        const held = entry.sides.find((s) => s.state === "held");
        if (!held) continue;
        entry.held = held.name;
        // A PAIR WITH ONE SIDE closes nothing, and saying so is better than
        // throwing. Every pair in the shipped ladder has two sides and
        // assertLadderSane does not check that it does, so a catalogue with an
        // odd Mark in it -- or a stub catalogue in a test -- used to take this
        // free, read-only tool down with a TypeError.
        const other = entry.sides.find((s) => s !== held);
        if (!other) continue;
        entry.closed = other.name;
        entry.closedBy = held.name;
      }

      // The two numbers every gate above is measured against, so an agent told
      // it is short of a run of 30 can see how short. `resting` is here because
      // it is the one state that closes every pair at once, and a page of
      // closed sides with no reason given is a puzzle. The rest of the token's
      // state is `status`'s job and is not repeated here.
      return {
        ok: true,
        tokenId: token.tokenId,
        level: token.level,
        streak: token.streak,
        resting: Boolean(token.resting),
        pairs,
      };
    },
  };
}
