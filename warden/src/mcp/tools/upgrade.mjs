// warden/src/mcp/tools/upgrade.mjs
import * as z from "zod";
import { paidWriteBlock, requireChain } from "../gates.mjs";

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
        // THE BOUND IS SEVEN AND THE LADDER HAS TEN. That is deliberate, not an
        // oversight. Marks 9 and 10 are both gated on already holding an Iris,
        // and NOTHING here enforces `requiresAny` yet; opening those ids before
        // that gate exists would make them buyable on day one, which silently
        // forfeits the other side of a pair that takes 100 days to reach. The
        // bound rises to 10 in the same change that enforces the gate.
        upgradeId: z.number().int().min(1).max(7),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },

    async handler(args, ctx) {
      const { tokenId, upgradeId } = args;
      const token = q.getToken(tokenId);
      if (!token) return { ok: false, reason: "unknown-token" };
      if (token.keyId !== ctx.keyId) return { ok: false, reason: "not-bound-to-caller" };

      const mark = catalogue[upgradeId];
      if (!mark) return { ok: false, reason: "mark-inactive" };
      if (token.level < mark.minLevel) return { ok: false, reason: "mark-level-too-low" };
      if (mark.needsWhole && token.level < 365) return { ok: false, reason: "mark-needs-whole" };
      if (mark.minStreak && token.streak < mark.minStreak) return { ok: false, reason: "mark-needs-streak" };
      if (q.markSold(upgradeId) >= mark.supply) return { ok: false, reason: "mark-sold-out" };
      if (token.marks & (1 << upgradeId)) return { ok: false, reason: "mark-already-applied" };

      // THE FREE ROUTE. Four of the ten Marks are earned by a run of days and
      // take no payment wrapper at all. This sits ABOVE the price guard on
      // purpose: an earned Mark has no price, so the guard below would refuse
      // every one of them as a catalogue error.
      //
      // The chain gate is read HERE, and only here, on this path. The paid
      // route reads it twice because settlement takes seconds and the piece can
      // be paused or the token sealed inside that window; nothing settles here,
      // so a settled-then-refused state cannot arise and one read is the whole
      // of it. reserveMark's unique index is still the final authority, so two
      // calls racing for the same token cannot both reserve.
      if (mark.route === "earned") {
        const blocked = await paidWriteBlock(chain, { tokenId, q });
        if (blocked) return { ok: false, reason: blocked };
        if (!q.reserveMark(tokenId, upgradeId)) {
          return { ok: false, reason: "mark-already-applied" };
        }
        return { ok: true, accepted: true, upgradeId, appliedBy: "the next Clock run" };
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
        // EVERYTHING ABOVE IS NOW STALE. Settling a payment takes seconds, and
        // in that window another buyer can take the last unit or the same token
        // can be marked. So the decision is made again here, against the
        // database, with the unique index as the final authority rather than a
        // read that could itself be overtaken.
        // The chain gates are re-read after settlement for the same reason the
        // mirror ones are: settling takes seconds, and the piece can be paused
        // or the token sealed inside that window.
        const nowBlocked = await paidWriteBlock(chain, { tokenId, q });
        if (nowBlocked) {
          alert(`upgrade ${upgradeId} for token ${tokenId} settled but the chain now refuses it: ${nowBlocked}`);
          return { ok: false, reason: "paid-but-unavailable", detail: nowBlocked };
        }

        const fresh = q.getToken(tokenId);
        const blocked =
          !fresh ? "unknown-token"
          : fresh.keyId !== ctx.keyId ? "not-bound-to-caller"
          : fresh.marks & (1 << upgradeId) ? "mark-already-applied"
          : q.markSold(upgradeId) >= mark.supply ? "mark-sold-out"
          : null;

        // reserveMark returns false when this token already holds the mark, so
        // two settlements racing for the same token cannot both reserve.
        if (!blocked && q.reserveMark(tokenId, upgradeId)) {
          // `ok: true` because every refusal from this tool carries
          // `ok: false`, and a client that branches on `result.ok` -- the one
          // field every other tool here answers with -- read a PAID success as
          // a failure. `accepted` stays alongside it: it is what the design
          // names this state, and dropping it would break anything already
          // reading it.
          return { ok: true, accepted: true, upgradeId, appliedBy: "the next Clock run" };
        }

        // MONEY HAS ALREADY CHANGED HANDS. This must never be a quiet refusal:
        // the agent has paid for something it cannot be given, and somebody has
        // to see that. Alert, and say plainly what happened.
        const detail = blocked ?? "mark-already-applied";
        alert(`upgrade ${upgradeId} for token ${tokenId} settled but cannot be applied: ${detail}`);
        return { ok: false, reason: "paid-but-unavailable", detail };
      }, mark.price, {
        tool: "upgrade",
        // The MARK'S OWN NAME, because this is the demand an agent reads before
        // spending up to $1,250.00. "a paid tool" is not good enough.
        description: `Apply the ${mark.name} Mark to token ${tokenId}`,
      })(args, ctx);
    },
  };
}
