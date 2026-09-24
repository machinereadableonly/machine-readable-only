// The public shape of a token. ONE function, used by both the `status` tool and
// the unsigned /t/<id> route, so a scanner and an agent can never be told two
// different stories about the same token.

import { onChainBy } from "./nextSteps.mjs";
import { dayStartIso } from "../day.mjs";
import { FINISH_LEVEL, FINISHER_MASK, LADDER, markNameIn } from "./ladder.mjs";

/**
 * Where a token says the rest of the piece is.
 *
 * C1.5: `/t/<id>` is the destination written into every bitmap at mint and it
 * cannot be changed afterwards, so the answer at the other end is the only
 * part of the artwork's own arrival that stays under our control. It used to
 * be a number set with an owner address: nothing naming the piece, and no
 * route to the page that would explain it.
 *
 * Built from the SAME configuration the resources use and never from a
 * literal. A hardcoded 8453 once sat beside an address read from the
 * environment, which published a mainnet chain id with a testnet address --
 * see resources.mjs for that one.
 */
export function tokenLinks({ domain, contract, chainId }) {
  return {
    docs: `https://${domain}/llms.txt`,
    mcp: `https://${domain}/mcp`,
    contract,
    chainId,
  };
}

export function tokenView(q, tokenId, links = null, now = Date.now()) {
  const t = q.getToken(tokenId);
  if (!t) return null;
  // Whether this token's year is over. Everything the piece measures in days
  // stops here, so it is asked once and read three times below.
  const finished = t.level >= FINISH_LEVEL;
  return {
    tokenId: t.tokenId,
    level: t.level,
    streak: t.streak,
    heart: `${Math.min(t.level, FINISH_LEVEL)}/${FINISH_LEVEL}`,
    whole: finished,
    // `years` is GONE. It counted completed years as `level / 365` on a piece
    // where the year now ends at 365 and does not begin again, so it could only
    // ever answer 0 or 1 -- the same fact `whole` already carries, in a field
    // whose name promises a second year that cannot happen.
    //
    // What replaces it is the thing that DOES distinguish one finished token
    // from another: the place it came in. `null` until the chain says so, which
    // is the finishing credit's `Finished` event and nothing else.
    finisher: t.finisher
      ? { place: t.finisher, mark: markNameIn(t.marks & FINISHER_MASK, LADDER) }
      : null,
    marks: t.marks,
    lastDay: t.lastDay,
    generation: t.generation,
    parentId: t.parentId,
    // The real column, not `status`. This read `t.status === "resting"` until
    // 2026-08-31, and status holds only 'queued' | 'written', so every token
    // ever served -- to a scanner at /t/<id> and to an agent through `status`
    // -- was reported as not resting, sealed ones included.
    resting: t.resting === 1,
    // NOT WRITTEN, rather than a list of the statuses that are not written.
    // `status` gained 'awaiting-payment' when settlement stopped being assumed,
    // and an equality test against 'queued' answered `pendingOnChain: false`
    // for those rows -- telling an agent its brand new token was already on
    // chain when it was not even paid for yet. Every status except 'written'
    // means the chain does not have this token, so that is what is asked.
    pendingOnChain: t.status !== "written",
    // C3.10. `pendingOnChain: true` on its own said "pending" forever without
    // saying since when or until when, so an agent reading it on day three
    // could not tell "the Clock runs tonight" from "the Clock has not run for
    // three nights" -- and the piece's whole verification story sends it to a
    // chain that does not have the token yet. The Clock can skip a night on
    // purpose (the gas guard), so `late` is a real state, not a fault.
    ...(t.status !== "written"
      ? { onChainBy: onChainBy(t.mintDay), late: now > Date.parse(onChainBy(t.mintDay)) }
      : {}),
    // 5.M3. WHEN TO COME BACK, which is the one question this piece is about
    // and the answer nothing carried. `pendingOnChain` said where the token
    // was, `heart` said how far along it is, and neither said when the next day
    // opens or when the run breaks -- so an agent scheduling its return had to
    // re-derive both from `lastDay` and a constant it was never given.
    //
    // The window opens at the start of the day after the last credited one; the
    // run survives only if the next credit lands INSIDE that day, which is why
    // the deadline is its end. Both from `lastDay`, which is the same field the
    // contract's `lastDay < day <= today()` reads.
    //
    // NULL ONCE THE YEAR IS COMPLETE, because there is no next window and no
    // run left to lose: the door refuses a finished token's check-in with
    // `year-complete` forever, and these two fields were still handing it a
    // time to come back and a deadline to keep. An agent scheduling from them
    // would have returned every day to be refused every day.
    //
    // Null rather than absent, unlike `onChainBy` and `late` above. Those two
    // are extra fields that exist only in a passing state; these two are part
    // of every view's published shape, and an explicit "there is none" is an
    // answer where a missing key reads as a fault.
    nextWindowOpensAt: finished ? null : dayStartIso(t.lastDay + 1),
    streakDeadline: finished ? null : dayStartIso(t.lastDay + 2),
    // Counted, not stored. `seedsAvailable` is still deliberately NOT here,
    // for a different reason than before: the write path exists since
    // 2026-09-07, so the old objection -- publishing an entitlement the
    // service would refuse to honour -- is gone. What remains is that this
    // view is served UNAUTHENTICATED at `/t/<id>`, and a seed budget belongs
    // to a KEY rather than to a token; a token's page is the wrong place to
    // publish what its agent may still spend elsewhere. `seed` answers it
    // exactly, to the key that owns it, and refuses `no-seed-available` with
    // the reason spelled out.
    children: q.childCount?.(t.tokenId) ?? 0,
    owner: t.owner,
    ...(links ?? {}),
  };
}
