// warden/src/mcp/tools/upgrade.mjs
import * as z from "zod";
import { paidWriteBlock, bindingBlock, requireChain } from "../gates.mjs";
import { keyIdToBytes32 } from "../keyId.mjs";
import { PaymentNonceReusedError } from "../../mirror/queries.mjs";
import { VARIANT_NAMES, effectiveRun, ladderSentence, markNameIn } from "../ladder.mjs";

// There was an exported UPGRADE_REASONS array here, listing the eight
// pre-payment refusals. Nothing imported it, nothing validated against it, and
// it was already out of date -- "paid-but-unavailable" is a reason this tool
// returns and the list never named it. A catalogue of strings that no code
// checks is not a constraint, it is a second place for the truth to live and
// drift; the reasons below are the only list. Deleted 2026-08-30.

/**
 * Every gate a Mark has that is decided from the TOKEN's own state, in one
 * place, so the two call sites cannot drift apart.
 *
 * WHY IT IS SHARED. The post-payment block used to re-read a SUBSET: the chain
 * gates, the binding, already-applied, excluded and sold-out -- but not
 * `minLevel`, `needsWhole`, `minStreak`, `requiresAny` or the variant bound,
 * while the protocol document promises every agent that "every gate is read a
 * SECOND time". Nothing was exploitable when that was found (level only rises,
 * marks are never cleared, no bought Mark carries a minStreak), which is
 * exactly what makes it dangerous: the exemption is invisible, and the first
 * Mark given a minStreak, or any change that lets a level fall, would be
 * unguarded on the path where the money has already moved.
 *
 * `held` is the union of what the token wears and what it has reserved -- see
 * the call sites. `requiresAny` deliberately takes `token.marks` alone: an
 * unwritten Iris does not satisfy the contract either.
 */
function markGateBlock({ token, held, mark, variant }) {
  if (token.level < mark.minLevel) return "mark-level-too-low";
  if (mark.needsWhole && token.level < 365) return "mark-needs-whole";
  if (mark.minStreak && effectiveRun(token) < mark.minStreak) return "mark-needs-streak";
  if (held & (1 << mark.id)) return "mark-already-applied";
  if (held & mark.excludes) return "mark-excluded";
  if (mark.requiresAny && !(token.marks & mark.requiresAny)) return "mark-needs-iris";
  if (variant >= mark.variants) return "mark-bad-variant";
  return null;
}

export function makeUpgradeTool({ q, chain, catalogue, paid, alert = console.error }) {
  requireChain(chain, "upgrade");
  return {
    name: "upgrade",
    config: {
      // NOT "Buy a Mark". Four of the ten Marks are earned by a run of days and
      // take no payment wrapper at all, so the shop framing hid the free route
      // from the agent reading the tool list to decide what to call. The
      // exclusion belongs here too: it is the one consequence of this call that
      // cannot be undone, and a title is read by agents that never open
      // `ladder`.
      title: "Take a Mark",
      description: "Take a Mark, bought or earned, for a token bound to your key. Taking either side of a pair closes the other permanently; every gate is checked before any payment is requested.",
      inputSchema: z.object({
        tokenId: z.number().int().positive().describe("A token bound to your key."),
        // BOUNDED, because the bitmask below is a 32-bit shift. An unbounded id
        // wraps -- 1 << 32 is 1 and 1 << 33 is 2, so a high id aliases a low
        // one -- and 1 << 31 is negative.
        //
        // Ten, raised from seven in the SAME change that enforces requiresAny.
        // Opening 9 and 10 before that gate existed would have made Tint and
        // Aura buyable on day one, silently forfeiting the other side of a pair
        // that takes 100 days to reach.
        upgradeId: z.number().int().min(1).max(10).describe(ladderSentence()),
        // The Iris shape (0 target, 1 squircle, 2 leaf) or the Tint ink
        // (0 violet, 1 gold). Every other Mark accepts only 0, which the
        // per-Mark check below enforces -- this bound is only the widest any
        // Mark accepts. The default is what lets an agent omit it entirely.
        variant: z.number().int().min(0).max(2).default(0)
          .describe("Shape for 5 (0 target, 1 squircle, 2 leaf) or ink for 9 (0 violet, 1 gold). Every other Mark takes 0."),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },

    async handler(args, ctx) {
      const { tokenId, upgradeId, variant = 0 } = args;
      const token = q.getToken(tokenId);
      if (!token) return { ok: false, reason: "unknown-token" };
      // 5.M2. THE MIRROR IS NOT THE AUTHORITY ON WHO THIS TOKEN IS BOUND TO.
      // `rebind` is a token-owner call the Warden never sees: it lands on chain
      // and reaches the mirror only at the next Clock run, so between those two
      // moments `token.keyId` is stale BY DESIGN. Refusing on it alone locked a
      // legitimately rebound agent out of its own token for up to a day --
      // and here that means refusing something it is about to PAY for.
      //
      // The chain read is the same security control `checkin` performs, for the
      // same reason and with the same null rule: a null means the RPC could not
      // be reached, NOT that the caller is unbound, so refusing on null is the
      // safe direction. Admitting on it would turn an outage into an open door.
      //
      // The gates below read the binding again on the paid route, because
      // settlement takes seconds and a rebind can land inside that window.
      if (token.keyId !== ctx.keyId) {
        const onChain = await chain.boundKeyOf(tokenId);
        if (!onChain || onChain !== keyIdToBytes32(ctx.keyId)) {
          return { ok: false, reason: "not-bound-to-caller" };
        }
      }

      const mark = catalogue[upgradeId];
      if (!mark) return { ok: false, reason: "mark-inactive" };
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

      // Every gate this Mark has, decided here and decided again after payment
      // from the same function. Two of them are worth naming individually:
      //
      // `requiresAny` reads `token.marks` alone and not `held` -- both sides of
      // pair five wait on an Iris, and a reservation that has not reached the
      // chain does not satisfy the CONTRACT either: applyMark would revert
      // MarkGate on a Tint whose Iris is still queued. Under-satisfying a
      // requirement only refuses, which is safe; over-satisfying an exclusion
      // sells a forfeit, which is not.
      //
      // The variant bound belongs to the contract (applyMark reverts
      // BadVariant), so refusing here means an agent is never charged for a
      // shape the chain will not write.
      const gate = markGateBlock({ token, held, mark, variant });

      // THE EXCLUSION, before any payment. An agent told only "no" cannot tell a
      // permanent exclusion from a temporary gate, and the whole ladder rests on
      // exclusions being legible -- so the refusal NAMES what closed the door.
      // It can only ever name the same pair's other side, which is why a name is
      // enough: every exclusion is pair-internal.
      if (gate === "mark-excluded") {
        return { ok: false, reason: "mark-excluded", detail: markNameIn(held & mark.excludes, catalogue) };
      }
      if (gate) return { ok: false, reason: gate };

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
        // THE BINDING IS READ FROM THE CHAIN. An earned Mark is free, which
        // makes this the CHEAPEST way to damage a token somebody else now owns:
        // taking Break costs nothing and permanently forecloses the $1,250.00
        // Vessel. The mirror cannot answer who the token is bound to -- `rebind`
        // never passes through this service -- so it is asked of the chain, in
        // both directions, before anything irreversible is reserved.
        const blocked =
          (await paidWriteBlock(chain, { tokenId, q })) ??
          (await bindingBlock(chain, tokenId, ctx.keyId, keyIdToBytes32));
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
          return { ok: false, reason: "mark-excluded", detail: markNameIn(nowBlocking, catalogue) };
        }
        if (nowHeld & (1 << upgradeId) || !q.reserveMark(tokenId, upgradeId, variant)) {
          return { ok: false, reason: "mark-already-applied" };
        }
        return { ok: true, accepted: true, upgradeId, variant, closed: markNameIn(mark.excludes, catalogue), appliedBy: "the next Clock run" };
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
      // The binding goes with them, for the reason given on the earned route
      // above: the mirror cannot know who this token is bound to now.
      const blocked =
        (await paidWriteBlock(chain, { tokenId, q })) ??
        (await bindingBlock(chain, tokenId, ctx.keyId, keyIdToBytes32));
      if (blocked) return { ok: false, reason: blocked };

      // Reservations nobody paid for are cleared before the reservation below
      // is attempted: the unique index on (tokenId, upgradeId) is what stops a
      // Mark being bought twice, and a dead 'awaiting-payment' row occupies it
      // exactly as a live one does. Without this a failed settlement would
      // refuse that Mark to that token for good.
      q.dropExpiredReservations();

      // Only now is payment requested.
      return paid(async (_args, { payNonce }) => {
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
        // The binding is re-read HERE TOO, from the CHAIN: a rebind mined during
        // the settlement round trip is in no mirror. This read is the ONLY
        // binding check after payment -- see the note on `blocked` below.
        const nowBlocked =
          (await paidWriteBlock(chain, { tokenId, q })) ??
          (await bindingBlock(chain, tokenId, ctx.keyId, keyIdToBytes32));
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
        // EVERY gate, not a subset -- the same function the pre-payment block
        // runs, so the two cannot come apart when a Mark or a gate is added.
        //
        // NO MIRROR BINDING CHECK HERE, deliberately (removed 2026-09-12). It
        // compared `fresh.keyId`, which is stale BY DESIGN until the next Clock
        // run after a rebind (5.M2, at the top of this handler), so it refused
        // every rebound agent AFTER the chain read above had admitted it --
        // re-imposing, on the paid route only, the lockout 5.M2 removed. The
        // chain read is the authority in both directions.
        const blocked =
          !fresh ? "unknown-token"
          : q.markSold(upgradeId) >= mark.supply ? "mark-sold-out"
          : markGateBlock({ token: fresh, held: heldNow, mark, variant });

        // reserveMarkPaid returns false when this token already holds the mark,
        // so two settlements racing for the same token cannot both reserve.
        //
        // THE PAID METHOD, not the earned one. The row lands as
        // 'awaiting-payment' carrying the nonce that will settle it, so the
        // Clock cannot apply a Mark nobody has paid for yet. The earned route
        // above uses reserveMark and queues outright, because nothing settles
        // there.
        let reserved = false;
        try {
          reserved = !blocked && q.reserveMarkPaid(tokenId, upgradeId, variant, payNonce);
        } catch (err) {
          // See the same branch in mint.mjs: one signed authorisation presented
          // for a second effect, refused before settlement so nothing is
          // charged. The demands for mint and Hush are byte-identical at $1.00,
          // which is precisely how a payload crosses between tools.
          if (!(err instanceof PaymentNonceReusedError)) throw err;
          alert(`upgrade ${upgradeId} for token ${tokenId} refused: payment authorisation already used`);
          return { ok: false, reason: "payment-already-used" };
        }
        if (reserved) {
          // `ok: true` because every refusal from this tool carries
          // `ok: false`, and a client that branches on `result.ok` -- the one
          // field every other tool here answers with -- read a PAID success as
          // a failure. `accepted` stays alongside it: it is what the design
          // names this state, and dropping it would break anything already
          // reading it.
          return { ok: true, accepted: true, upgradeId, variant, closed: markNameIn(mark.excludes, catalogue), appliedBy: "the next Clock run" };
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
