// The check-in tool. Free to the agent; the site pays the gas at 00:05 UTC.
import * as z from "zod";
import { keyIdToBytes32 } from "../keyId.mjs";
import { chainBlock, tokenBlock, requireChain } from "../gates.mjs";
import { onChainBy } from "../nextSteps.mjs";
import { DAY_MS, utcDay } from "../../day.mjs";

/// Day numbers are whole days since the epoch, the same unit the contract
/// uses, so the mirror and the chain cannot drift on what "today" means. The
/// length of a day lives in day.mjs; this re-export keeps every importer of
/// `utcDay` from here working unchanged.
export { utcDay };

/// The runs at which the heart's colour changes, in the copy's own words:
/// "at 3 days, at 7, at 30 and at 100". Named here so the daily reply can tell
/// an agent what it is walking towards.
const RUNGS = [3, 7, 30, 100];

export function makeCheckinTool({ q, chain, today = utcDay }) {
  requireChain(chain, "checkin");
  return {
    name: "checkin",
    config: {
      title: "Check in",
      description:
        "Record today's visit for a token bound to your key. Free. The site pays the gas and writes it on chain at 00:05 UTC. Once per UTC day; a second call the same day is refused with `already-credited-today` and `nextWindowOpensAt`.",
      inputSchema: z.object({ tokenId: z.number().int().positive().describe("A token bound to your key.") }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },

    async handler({ tokenId }, ctx) {
      const token = q.getToken(tokenId);
      // BOTH `ok` AND `accepted`, on every return. `ok` is the convention every
      // other tool answers with and the only one llms.txt states, so a client
      // branching on it read a successful check-in as a failure for as long as
      // this tool answered with `accepted` alone. `accepted` stays because it
      // is the word this tool has always used and something may read it.
      if (!token) {
        // A MIRROR MISS IS NOT AN ABSENCE. The chain is the authority on
        // whether a token exists, and this service can be behind it -- a token
        // minted straight on chain, or one whose reconcile has not run. Saying
        // "no such token" to the holder of a real token, from every tool at
        // once, is the shape of bug that makes an agent give up and report the
        // piece as broken.
        const life = await chain.lifecycleOf(tokenId);
        if (life === null) return { ok: false, accepted: false, reason: "chain-unavailable" };
        return { ok: false, accepted: false, reason: life.exists ? "not-yet-mirrored" : "unknown-token" };
      }

      // THIS CHECK IS ONE-SIDED, AND THAT IS A DECISION (the operator, 2026-09-05), not
      // an oversight. It asks the chain only when the mirror does NOT recognise
      // the caller, so a seller who has already been rebound away from can go
      // on checking in on a token they sold. `upgrade` and `seed` were made
      // two-sided in the same change; this one deliberately was not.
      //
      // WHY. A credit lands on the TOKEN, which the buyer now owns -- the
      // seller is donating a day, not taking one, and there is nothing to gain
      // by it. Against that, check-in is the most-called tool in the piece and
      // making it two-sided would put a chain read on every one of them, which
      // turns an RPC outage into a day nobody can claim. The two irreversible
      // tools pay that cost because their downside is a permanent forfeit; this
      // one does not, because its downside is a gift.
      //
      // Do not "fix" this by copying the guard from upgrade. If it changes, it
      // is because the cost calculation changed, not because it was missed.
      if (token.keyId !== ctx.keyId) {
        // The mirror does not recognise this caller. Before refusing, ask the
        // chain once: a rebind may have been mined since the last reconcile.
        // This read is a security control -- it must never be served from the
        // mirror, or a legitimately rebound agent is locked out of its own
        // token until the next Clock run.
        // A null here means the RPC could not be reached, NOT that the caller
        // is unbound. Refusing on null is the safe direction; admitting on it
        // would turn an RPC outage into an open door.
        const onChain = await chain.boundKeyOf(tokenId);
        if (!onChain || onChain !== keyIdToBytes32(ctx.keyId)) {
          return { ok: false, accepted: false, reason: "not-bound-to-caller" };
        }
      }

      const day = today();

      // THE CHAIN REFUSES THIS DAY, SO THE MIRROR MUST TOO.
      //
      // MachineReadableOnly.sol:249 mints with `Token(1, 1, d, d, ...)`, so a
      // fresh token's lastDay IS its mint day, and :314 reverts
      // DayNotAdvanced(id) on `day <= s.lastDay`. A check-in on the day of
      // minting is therefore refused ON CHAIN. The unique (tokenId, day) index
      // does not catch it, because on mint day that index is empty -- so
      // without this guard the mirror credits a day the Clock's batchCheckIn
      // will revert on, writes level 2, and every later day inherits the
      // offset. The mirror is what agents are told; it must never run ahead of
      // what is true. `seed` mints its child the same way
      // (MachineReadableOnly.sol:545), so this covers seeded tokens too.
      //
      // The unique index STAYS -- it is the concurrency control, and this
      // guard is about agreeing with the chain, not about racing callers.
      if (day <= token.lastDay) {
        return {
          ok: false,
          accepted: false,
          reason: "already-credited-today",
          nextWindowOpensAt: new Date((token.lastDay + 1) * DAY_MS).toISOString(),
          onChainBy: onChainBy(token.lastDay),
        };
      }

      // ONLY NOW THE CHAIN. Three eth_calls used to run ABOVE the guard above,
      // on a tool that is FREE and has no per-caller budget -- so an agent
      // looping check-in on its own token paid nothing and cost this service
      // three RPC round trips per call, for ever. When the provider throttles,
      // writesOpen answers "unreadable" and every PAID write refuses for
      // everyone: the mint path denied through a free tool, from one key, for
      // one dollar. Deciding what this process already knows first costs
      // nothing and changes no answer.
      //
      // batchCheckIn carries whenNotPaused and notSunset (:282) and reverts
      // Resting(id) at :308. A credit written here that the Clock cannot land
      // leaves the mirror permanently ahead of the chain -- the same class of
      // bug as the mint-day credit, which is why both gates are read rather
      // than assumed. This tool is FREE, so there is no settlement window and
      // no second check.
      //
      // A PAID MINT THE CLOCK HAS NOT WRITTEN YET IS A TOKEN, not an unknown
      // id. The chain does not hold it until the next run -- 00:05 UTC on the
      // live site -- but the payment has settled, the mirror has its row, and
      // the Clock writes mints BEFORE check-ins in the same run, so a credit
      // queued now lands after the token exists. Refusing it told the agent
      // "no token with this id is known here" about a token `status` listed,
      // and cost it the day (found by the fast-days copy, 2026-09-11). Only a
      // SETTLED row counts ('queued'; 'awaiting-payment' is a promise, not a
      // sale), and not one whose artwork failed for good -- that mint cannot
      // be written, so a credit behind it could only ever be condemned.
      // Pause and sunset are still read: they would refuse the write either way.
      const mint = q.getMint(tokenId);
      const paidAndPending = mint?.status === "queued" && mint.solveState !== "failed";
      const blocked =
        (await chainBlock(chain)) ?? (paidAndPending ? null : await tokenBlock(chain, tokenId, q));
      if (blocked) return { ok: false, accepted: false, reason: blocked };

      // Level counts distinct credited days and never falls. A streak
      // CONTINUES only when this day is the one immediately after the last
      // credited day; any gap starts again at 1.
      const level = token.level + 1;
      const streak = day === token.lastDay + 1 ? token.streak + 1 : 1;

      // ONE FACT, NOT TWO. The credit row and the token row it advances are
      // written inside a single transaction, so nothing can ever observe a
      // credited day whose level was not applied, or a level with no credit
      // behind it. The unique index on (tokenId, day) is still what decides
      // whether the day was new -- there is deliberately no lock.
      //
      // ctx.sigHash is the SHA-256 of the RFC 9421 Signature header the door
      // verified for this request, threaded through authInfo. The `?? ""`
      // fallback is unreachable through the door and is kept only so a
      // check-in can never be refused over bookkeeping; if it ever fires,
      // empty strings in credits.sigHash are the symptom to look for.
      const credited = q.transact(() => {
        if (!q.insertCredit(tokenId, day, ctx.sigHash ?? "")) return false;
        q.creditDay(tokenId, day, level, streak);
        return true;
      });

      if (!credited) {
        return {
          ok: false,
          accepted: false,
          reason: "already-credited-today",
          nextWindowOpensAt: new Date((day + 1) * DAY_MS).toISOString(),
          onChainBy: onChainBy(day),
        };
      }

      // C3.8. Day two used to tell an agent less than day one did: a level, a
      // streak, and a window. It never said when the day actually lands, never
      // said what the deadline was for keeping the run, and -- when the run had
      // just broken -- reported `streak: 1` with no hint that it had been 99
      // yesterday. The one thing the copy makes matter went unannounced by the
      // only tool that knew. Every field below is computed from values this
      // handler already holds; nothing new is read.
      const streakDeadline = new Date((day + 2) * DAY_MS).toISOString();
      const runBroke = streak === 1 && token.streak > 1
        ? { was: token.streak, lastCreditedDay: token.lastDay }
        : undefined;
      const nextRung = RUNGS.find((r) => r > streak) ?? null;

      return {
        ok: true,
        accepted: true,
        creditedDay: day,
        level,
        streak,
        heart: `${Math.min(level, 365)}/365`,
        nextWindowOpensAt: new Date((day + 1) * DAY_MS).toISOString(),
        onChainBy: onChainBy(day),
        streakDeadline,
        nextRung: nextRung === null ? null : { at: nextRung, daysAway: nextRung - streak },
        ...(runBroke ? { runBroke } : {}),
        note:
          `Day ${level} credited; it is written on chain at 00:05 UTC. Your run is ${streak}. ` +
          `Check in again before ${streakDeadline} to keep it.` +
          (runBroke ? ` Your run of ${runBroke.was} ended: the ${runBroke.was} days are kept, the colour restarts.` : ""),
      };
    },
  };
}
