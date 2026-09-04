// warden/src/mcp/tools/upgrade.mjs
import * as z from "zod";
import { paidWriteBlock, requireChain } from "../gates.mjs";
import { VARIANT_NAMES } from "../ladder.mjs";

// There was an exported UPGRADE_REASONS array here, listing the eight
// pre-payment refusals. Nothing imported it, nothing validated against it, and
// it was already out of date -- "paid-but-unavailable" is a reason this tool
// returns and the list never named it. A catalogue of strings that no code
// checks is not a constraint, it is a second place for the truth to live and
// drift; the reasons below are the only list. Deleted 2026-08-30.

export function makeUpgradeTool({ q, chain, catalogue, paid, alert = console.error }) {
  requireChain(chain, "upgrade");
  return {
    name: "upgrade",
    config: {
      title: "Buy a Mark",
      description: "Apply a paid Mark to a token bound to your key. Gates are checked before any payment is requested.",
      inputSchema: z.object({
        tokenId: z.number().int().positive(),
        // BOUNDED, because the bitmask below is a 32-bit shift. An unbounded id
        // wraps -- 1 << 32 is 1 and 1 << 33 is 2, so a high id aliases a low
        // one -- and 1 << 31 is negative.
        //
        // Ten, raised from seven in the SAME change that enforces requiresAny.
        // Opening 9 and 10 before that gate existed would have made Tint and
        // Aura buyable on day one, silently forfeiting the other side of a pair
        // that takes 100 days to reach.
        upgradeId: z.number().int().min(1).max(10),
        // The Iris shape (0 target, 1 squircle, 2 leaf) or the Tint ink
        // (0 violet, 1 gold). Every other Mark accepts only 0, which the
        // per-Mark check below enforces -- this bound is only the widest any
        // Mark accepts. The default is what lets an agent omit it entirely.
        variant: z.number().int().min(0).max(2).default(0),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },

    async handler(args, ctx) {
      const { tokenId, upgradeId, variant = 0 } = args;
      const token = q.getToken(tokenId);
      if (!token) return { ok: false, reason: "unknown-token" };
      if (token.keyId !== ctx.keyId) return { ok: false, reason: "not-bound-to-caller" };

      const mark = catalogue[upgradeId];
      if (!mark) return { ok: false, reason: "mark-inactive" };
      if (token.level < mark.minLevel) return { ok: false, reason: "mark-level-too-low" };
      if (mark.needsWhole && token.level < 365) return { ok: false, reason: "mark-needs-whole" };
      if (mark.minStreak && token.streak < mark.minStreak) return { ok: false, reason: "mark-needs-streak" };
      if (q.markSold(upgradeId) >= mark.supply) return { ok: false, reason: "mark-sold-out" };

      // WHAT THIS TOKEN HAS TAKEN, which is not the same thing as what the
      // chain says it wears. `tokens.marks` is set by markOrderWritten, and only
      // the Clock calls that, after a successful applyMark -- so a Mark bought
      // at noon is invisible to that column until 00:05 UTC. Deciding an
      // exclusion from it alone sold Tint ($250.00) and Aura ($25.00) to one
      // token in one cycle: the Clock writes Tint, applyMark(id, 10, 0) then
      // reverts MarkExcluded(9) a day later, and the agent was refused nothing
      // and told nothing. A reservation decides the pair the moment it is made,
      // so it has to be read here.
      //
      // WHAT THE UNIQUE INDEX STILL GUARANTEES, so the two are not confused.
      // mark_orders_token_upgrade is one row per (tokenId, upgradeId) and it is
      // enforced by the database across every process that opens the file --
      // that is the final authority against two settlements racing for the SAME
      // Mark, and reserveMark returning false is how that arrives. It cannot
      // help across a PAIR, because the two sides are different upgradeIds and
      // no index expresses "either of these two". So this read is a check and
      // not an authority: what makes it sound within this service is that
      // node:sqlite is synchronous and there is no `await` between reading the
      // mask and inserting the row, so no other request can interleave.
      const held = token.marks | q.reservedMask(tokenId);
      if (held & (1 << upgradeId)) return { ok: false, reason: "mark-already-applied" };

      // THE EXCLUSION, before any payment. An agent told only "no" cannot tell a
      // permanent exclusion from a temporary gate, and the whole ladder rests on
      // exclusions being legible -- so the refusal NAMES what closed the door.
      // It can only ever name the same pair's other side, which is why a name is
      // enough: every exclusion is pair-internal.
      const blocking = held & mark.excludes;
      if (blocking) {
        const by = Object.values(catalogue).find((m) => blocking & (1 << m.id));
        return { ok: false, reason: "mark-excluded", detail: by?.name.toLowerCase() };
      }

      // Both sides of pair five wait on an Iris, by either route. Aura was
      // ungated once, and being buyable on day one silently forfeited Tint --
      // which needs an Iris, and therefore 100 days.
      //
      // THIS ONE READS `token.marks` AND NOT `held`, deliberately. A reservation
      // that has not reached the chain does not satisfy the contract either:
      // applyMark would revert MarkGate on a Tint whose Iris is still queued.
      // Counting an unwritten Iris here would sell the Tint that refusal is
      // about. Under-satisfying a requirement only refuses, which is the safe
      // direction; over-satisfying an exclusion sells a forfeit, which is not.
      if (mark.requiresAny && !(token.marks & mark.requiresAny)) {
        return { ok: false, reason: "mark-needs-iris" };
      }

      // The variant bound is per Mark and the CONTRACT is its authority
      // (applyMark reverts BadVariant). Refusing here means an agent is never
      // charged for a shape the chain will not write.
      if (variant >= mark.variants) return { ok: false, reason: "mark-bad-variant" };

      // THE FREE ROUTE. Four of the ten Marks are earned by a run of days and
      // take no payment wrapper at all. This sits ABOVE the price guard on
      // purpose: an earned Mark has no price, so the guard below would refuse
      // every one of them as a catalogue error.
      //
      // The chain gate is read HERE, and only here, on this path. The paid
      // route reads it twice because settlement takes seconds and the piece can
      // be paused or the token sealed inside that window; nothing settles here,
      // so a settled-then-refused state cannot arise and one read is the whole
      // of it. reserveMark's unique index is still the final authority for THIS
      // Mark, so two calls racing for the same one cannot both reserve.
      if (mark.route === "earned") {
        const blocked = await paidWriteBlock(chain, { tokenId, q });
        if (blocked) return { ok: false, reason: blocked };

        // THE MASK IS RE-READ ON THIS SIDE OF THE await. What the chain read
        // costs in milliseconds is still a yield, and a paid call for the other
        // side of this pair can reserve inside it -- after which the Clock sends
        // both and the chain refuses whichever it sends second, which may well
        // be the one somebody paid for. The index cannot catch that: the two
        // sides are different upgradeIds. Nothing between this read and the
        // insert below yields, so together they are one decision.
        const nowHeld = (q.getToken(tokenId)?.marks ?? 0) | q.reservedMask(tokenId);
        const nowBlocking = nowHeld & mark.excludes;
        if (nowBlocking) {
          const by = Object.values(catalogue).find((m) => nowBlocking & (1 << m.id));
          return { ok: false, reason: "mark-excluded", detail: by?.name.toLowerCase() };
        }
        if (nowHeld & (1 << upgradeId) || !q.reserveMark(tokenId, upgradeId, variant)) {
          return { ok: false, reason: "mark-already-applied" };
        }
        return { ok: true, accepted: true, upgradeId, variant, appliedBy: "the next Clock run" };
      }

      // THE PRICE COMES FROM THE MARK, and a catalogue entry without one is
      // refused rather than defaulted. The six bought Marks run from $1.00 to
      // $1,250.00 against a mint's single dollar; anything that silently
      // substituted a default here would sell a Vessel for the price of a mint.
      if (typeof mark.price !== "string" || !/^\$\d/.test(mark.price)) {
        alert(`mark ${upgradeId} has no usable price in the catalogue`);
        return { ok: false, reason: "mark-inactive", detail: "no-price" };
      }

      // THE CONTRACT'S OWN GATES. applyMark carries whenNotPaused and
      // notSunset, and reverts Resting(id) at :454 -- and `resting` is set by
      // the token OWNER calling rest() directly, so this mirror can never learn
      // it without asking. Before payment, always.
      const blocked = await paidWriteBlock(chain, { tokenId, q });
      if (blocked) return { ok: false, reason: blocked };

      // Only now is payment requested.
      return paid(async () => {
        // EVERYTHING ABOVE IS NOW STALE. The payment round trip takes seconds,
        // and in that window another buyer can take the last unit or the same
        // token can be marked. So the decision is made again here, against the
        // database, with the unique index as the final authority rather than a
        // read that could itself be overtaken.
        // The chain gates are re-read for the same reason the mirror ones are:
        // the piece can be paused or the token sealed inside that window.
        //
        // The payment is VERIFIED but NOT YET SETTLED at this point -- the
        // `authorization` flow settles after this function returns -- so a
        // refusal here still cancels it rather than charging for it. See
        // cancelSettlementOnRefusal in pay/x402.mjs.
        const nowBlocked = await paidWriteBlock(chain, { tokenId, q });
        if (nowBlocked) {
          alert(`upgrade ${upgradeId} for token ${tokenId} refused after payment was verified: the chain now refuses it: ${nowBlocked}`);
          return { ok: false, reason: "paid-but-unavailable", detail: nowBlocked };
        }

        // The same union as before payment, re-read: the window this block
        // exists for is exactly long enough for another connection to buy the
        // other side of the pair, and that purchase lands in mark_orders and
        // nowhere else until the Clock runs. Reading only fresh.marks here read
        // straight past it -- and this is the path where the money has already
        // moved, so it is the one that must not be blind.
        const fresh = q.getToken(tokenId);
        const heldNow = fresh ? fresh.marks | q.reservedMask(tokenId) : 0;
        const blocked =
          !fresh ? "unknown-token"
          : fresh.keyId !== ctx.keyId ? "not-bound-to-caller"
          : heldNow & (1 << upgradeId) ? "mark-already-applied"
          : heldNow & mark.excludes ? "mark-excluded"
          : q.markSold(upgradeId) >= mark.supply ? "mark-sold-out"
          : null;

        // reserveMark returns false when this token already holds the mark, so
        // two settlements racing for the same token cannot both reserve.
        if (!blocked && q.reserveMark(tokenId, upgradeId, variant)) {
          // `ok: true` because every refusal from this tool carries
          // `ok: false`, and a client that branches on `result.ok` -- the one
          // field every other tool here answers with -- read a PAID success as
          // a failure. `accepted` stays alongside it: it is what the design
          // names this state, and dropping it would break anything already
          // reading it.
          return { ok: true, accepted: true, upgradeId, variant, appliedBy: "the next Clock run" };
        }

        // MONEY HAS ALREADY CHANGED HANDS. This must never be a quiet refusal:
        // the agent has paid for something it cannot be given, and somebody has
        // to see that. Alert, and say plainly what happened.
        const detail = blocked ?? "mark-already-applied";
        alert(`upgrade ${upgradeId} for token ${tokenId} refused after payment was verified: cannot be applied: ${detail}`);
        return { ok: false, reason: "paid-but-unavailable", detail };
      }, mark.price, {
        tool: "upgrade",
        // The MARK'S OWN NAME, because this is the demand an agent reads before
        // spending up to $1,250.00. "a paid tool" is not good enough -- and for
        // the two Marks with a choice, neither is the name alone: Tint costs
        // $250.00 and the ink is the whole of what is bought.
        //
        // VARIANT_NAMES[upgradeId] is indexed unguarded on purpose: assertLadderSane
        // refuses to start on a Mark that offers variants without naming them, so
        // by the time a catalogue reaches this tool the table is complete. A guard
        // here would turn a wiring error into a runtime refusal for one agent
        // mid-payment, which is precisely the wrong place to discover it.
        description: mark.variants > 1
          ? `Apply the ${mark.name} Mark (${VARIANT_NAMES[upgradeId][variant]}) to token ${tokenId}`
          : `Apply the ${mark.name} Mark to token ${tokenId}`,
      })(args, ctx);
    },
  };
}
