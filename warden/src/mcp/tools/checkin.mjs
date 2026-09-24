// The check-in tool. Free to the agent; the site pays the gas at 00:05 UTC.
import * as z from "zod";
import { keyIdToBytes32 } from "../keyId.mjs";
import { chainBlock, tokenBlock, yearCompleteBlock, requireChain } from "../gates.mjs";
import { onChainBy } from "../nextSteps.mjs";
import { DAY_MS, utcDay } from "../../day.mjs";
import { FINISH_LEVEL } from "../ladder.mjs";

/// Day numbers are whole days since the epoch, the same unit the contract
/// uses, so the mirror and the chain cannot drift on what "today" means. The
/// length of a day lives in day.mjs; this re-export keeps every importer of
/// `utcDay` from here working unchanged.
export { utcDay };

/// The runs at which the heart's colour changes, in the copy's own words:
/// "at 3 days, at 7, at 30 and at 100". Named here so the daily reply can tell
/// an agent what it is walking towards.
const RUNGS = [3, 7, 30, 100];

/// The one shape of the year-complete refusal, wherever it is decided.
///
/// It is answered from two places -- the mirror's own level, and the chain gate
/// that covers a mirror running behind -- and those answers must be the same
/// value. `heart` is the fact an agent acts on (the year is whole, not merely
/// closed to it), and no other refusal here echoes the id it was asked about.
const yearComplete = () => ({ ok: false, accepted: false, reason: "year-complete", heart: `${FINISH_LEVEL}/${FINISH_LEVEL}` });

export function makeCheckinTool({ q, chain, today = utcDay }) {
  requireChain(chain, "checkin");
  return {
    name: "checkin",
    config: {
      title: "Check in",
      description:
        "Record today's visit for a token bound to your key. Free. The site pays the gas and writes it on chain at 00:05 UTC. Once per UTC day; a second call the same day is refused with `already-credited-today` and `nextWindowOpensAt`. A year is 365 credited days: after the 365th the record is final, and a further call is refused with `year-complete`.",
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

      // THE YEAR IS OVER, AND NOTHING MORE IS RECORDED AGAINST IT.
      //
      // MachineReadableOnly.sol reverts AlreadyFinished(id) inside `_credit`,
      // which both check-in paths share, on `s.level >= FINISH_LEVEL` (365) --
      // the same constant this reads, mirrored in ladder.mjs.
      // The mirror's level already counts the credit that made it 365 -- it is
      // incremented when a check-in is QUEUED, below -- so `>= 365` here is
      // exactly "a 365th credit already exists". What this refuses is the
      // 366th, which the chain would revert; the credit that finishes the year
      // is taken at level 364 and still accepted.
      //
      // Refused before the chain reads, like the day guard beneath it: a
      // finished token is the one an agent is most likely to keep calling on,
      // and that must not cost an RPC round trip every day for ever.
      if (token.level >= FINISH_LEVEL) return yearComplete();

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
      //
      // THE YEAR GATE IS READ HERE TOO, and it is not a duplicate of the level
      // check above: that one reads the MIRROR, and the mirror can be behind
      // the chain -- a token whose finishing credit was written straight on
      // chain, or one whose reconcile has not run. Only the chain can answer
      // for that token, and a credit queued against it would revert and take
      // the whole night's chunk with it. It is asked only on the one call a day
      // that gets this far, because everything cheaper has already answered.
      //
      // ONE READ, BOTH GATES. `resting` and `level` come out of the same
      // `viewOf`, and nothing caches it, so letting each gate fetch its own
      // would buy a second eth_call for one fact -- on the free tool, every
      // day, for every token. The record is read here and handed to both.
      const mint = q.getMint(tokenId);
      const paidAndPending = mint?.status === "queued" && mint.solveState !== "failed";
      let blocked = await chainBlock(chain);
      if (!blocked && !paidAndPending) {
        const life = await chain.lifecycleOf(tokenId);
        blocked =
          (await tokenBlock(chain, tokenId, q, life)) ?? (await yearCompleteBlock(chain, tokenId, life));
      }
      // ONE REASON, ONE SHAPE. `year-complete` is answered here and at the
      // mirror guard above, and the two used to disagree about what came with
      // it; a client cannot branch on a field that is present only sometimes.
      if (blocked) {
        return blocked === "year-complete"
          ? yearComplete()
          : { ok: false, accepted: false, reason: blocked };
      }

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
      // ctx.sigHash is the SHA-256 of the RFC 9421 SIGNATURE BASE the door
      // verified for this request -- the bytes that were signed -- threaded
      // through authInfo. It was the Signature HEADER until 2026-09-18, which
      // was relabellable: the same signature under a different label hashed
      // differently, so one request could mint several distinct evidence
      // values, and the replay guard keyed on it admitted each of them. The `?? ""`
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
      // THE CREDIT THAT MAKES 365 ENDS THE YEAR, and this reply is the one
      // place the agent hears it while it is still acting. Every other surface
      // had been brought into line -- `tokenView` nulls both dates, the door
      // refuses the next call `year-complete`, the chain reverts
      // AlreadyFinished -- and the ACCEPTED reply still handed out a window to
      // come back in and a deadline to keep. An agent doing exactly what it was
      // told would then be refused every day for ever, with nothing in the
      // accepted reply to suggest it had been misled. An accepted answer that
      // instructs a loop the door refuses is worse than a refusal.
      //
      // Both dates NULL rather than dropped, the same rule `tokenView` follows:
      // they are part of every accepted reply's shape, and an explicit "there is
      // none" is an answer where a missing key reads as a fault. The shape is
      // asserted on both branches in tools.test.mjs.
      const finished = level >= FINISH_LEVEL;
      const streakDeadline = finished ? null : new Date((day + 2) * DAY_MS).toISOString();
      const runBroke = streak === 1 && token.streak > 1
        ? { was: token.streak, lastCreditedDay: token.lastDay }
        : undefined;
      // A FINISHED TOKEN IS WALKING TOWARDS NOTHING. The rung table knows only
      // about the run, so a token that finishes its year on a run of 6 still
      // had 7 above it and was told to reach for it -- in the same reply that
      // says no further day can ever be credited. Both dates were already
      // null; this is the third field that pointed at a tomorrow the door
      // refuses, and it is nulled on the same fact rather than on its own rule.
      const nextRung = finished ? null : (RUNGS.find((r) => r > streak) ?? null);
      // The run that broke is still reported on the finishing day: a token that
      // slipped during its year is coloured by that slip for ever, so the day
      // it finishes is the last moment the fact is worth stating.
      const brokeNote = runBroke
        ? ` Your run of ${runBroke.was} ended: the ${runBroke.was} days are kept, the colour restarts.`
        : "";

      return {
        ok: true,
        accepted: true,
        creditedDay: day,
        level,
        streak,
        heart: `${Math.min(level, FINISH_LEVEL)}/${FINISH_LEVEL}`,
        nextWindowOpensAt: finished ? null : new Date((day + 1) * DAY_MS).toISOString(),
        onChainBy: onChainBy(day),
        streakDeadline,
        nextRung: nextRung === null ? null : { at: nextRung, daysAway: nextRung - streak },
        ...(runBroke ? { runBroke } : {}),
        note: finished
          // NOTHING IS CLAIMED ABOUT THE PLACE ITSELF. The credit is queued
          // here and the contract decides the place when it writes it, so this
          // says where to read it rather than what it is.
          ? `Day ${level} credited; it is written on chain at 00:05 UTC. Your year is complete: ` +
            `the record is final, and no further day can be credited to this token. Its place in the ` +
            `order tokens finish is written round the border once the chain has recorded it; ` +
            `\`status\` shows it.` + brokeNote
          : `Day ${level} credited; it is written on chain at 00:05 UTC. Your run is ${streak}. ` +
            `Check in again before ${streakDeadline} to keep it.` + brokeNote,
      };
    },
  };
}
