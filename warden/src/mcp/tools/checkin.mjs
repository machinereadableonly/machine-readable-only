// The check-in tool. Free to the agent; the site pays the gas at 00:05 UTC.
import * as z from "zod";
import { keyIdToBytes32 } from "../keyId.mjs";
import { chainBlock, tokenBlock, requireChain } from "../gates.mjs";

/// Day numbers are whole UTC days since the epoch, the same unit the contract
/// uses, so the mirror and the chain cannot drift on what "today" means.
export const utcDay = (now = Date.now()) => Math.floor(now / 86_400_000);

export function makeCheckinTool({ q, chain, today = utcDay }) {
  requireChain(chain, "checkin");
  return {
    name: "checkin",
    config: {
      title: "Check in",
      description:
        "Record today's visit for a token bound to your key. Free. The site pays the gas and writes it on chain at 00:05 UTC.",
      inputSchema: z.object({ tokenId: z.number().int().positive() }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },

    async handler({ tokenId }, ctx) {
      const token = q.getToken(tokenId);
      // BOTH `ok` AND `accepted`, on every return. `ok` is the convention every
      // other tool answers with and the only one llms.txt states, so a client
      // branching on it read a successful check-in as a failure for as long as
      // this tool answered with `accepted` alone. `accepted` stays because it
      // is the word this tool has always used and something may read it.
      if (!token) return { ok: false, accepted: false, reason: "unknown-token" };

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

      // batchCheckIn carries whenNotPaused and notSunset (:282) and reverts
      // Resting(id) at :308. A credit written here that the Clock cannot land
      // leaves the mirror permanently ahead of the chain -- the same class of
      // bug as the mint-day credit, which is why both gates are read rather
      // than assumed. This tool is FREE, so there is no settlement window and
      // no second check.
      const blocked = (await chainBlock(chain)) ?? (await tokenBlock(chain, tokenId, q));
      if (blocked) return { ok: false, accepted: false, reason: blocked };

      const day = today();
      // Level counts distinct credited days and never falls. A streak
      // CONTINUES only when this day is the one immediately after the last
      // credited day; any gap starts again at 1.
      const level = token.level + 1;
      const streak = day === token.lastDay + 1 ? token.streak + 1 : 1;

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
          nextWindowOpensAt: new Date((token.lastDay + 1) * 86_400_000).toISOString(),
        };
      }

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
          nextWindowOpensAt: new Date((day + 1) * 86_400_000).toISOString(),
        };
      }

      return {
        ok: true,
        accepted: true,
        creditedDay: day,
        level,
        streak,
        nextWindowOpensAt: new Date((day + 1) * 86_400_000).toISOString(),
      };
    },
  };
}
