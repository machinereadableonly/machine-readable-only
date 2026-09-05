// Lineage. One seed per agent-year, free, and the child is bound to the caller.
import * as z from "zod";
import { chainBlock, tokenBlock, walletCapBlock, requireChain, bindingBlock } from "../gates.mjs";
import { keyIdToBytes32 } from "../keyId.mjs";

export function makeSeedTool({ q, chain, today, supplyCap }) {
  requireChain(chain, "seed");
  return {
    name: "seed",
    config: {
      title: "Seed a child token",
      description: "Costs nothing. Requires a whole, resting-free parent bound to your key, and an unspent seed for this agent-year.",
      inputSchema: z.object({
        parentId: z.number().int().positive().describe("A whole, unsealed token bound to your key."),
        to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte address").describe("The Base address that will OWN the token: your operator's wallet, usually. Your signing key grows the token; this address owns it and can sell, rebind or seal it."),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async handler({ parentId, to }, ctx) {
      // A seeded child is a token in the SAME collection, so it counts against
      // the same supply cap `mint` checks. This tool inserted tokens without
      // ever looking at it, so seeds could carry the collection past a cap the
      // contract would then refuse to write -- a queued token nothing could
      // ever mine. Required, never defaulted: a missing cap would compare
      // against undefined and silently never fire.
      if (!Number.isFinite(supplyCap)) throw new Error("seed requires a numeric supplyCap");
      if (q.tokenCount() >= supplyCap) return { ok: false, reason: "supply-cap-reached" };

      const parent = q.getToken(parentId);
      if (!parent) return { ok: false, reason: "unknown-token" };
      if (parent.keyId !== ctx.keyId) return { ok: false, reason: "not-bound-to-caller" };
      // WAS `parent.status === "resting"`, WHICH COULD NEVER BE TRUE.
      // tokens.status holds only 'queued' | 'written' -- the write-pipeline
      // state -- so this read like a working gate and was dead code. seed
      // reverts Resting(parentId) at :532, and carries whenNotPaused and
      // notSunset like every other write, and WalletCap at :538 against the
      // CHILD's recipient.
      // THE BINDING IS RE-READ FROM THE CHAIN, not taken from the line above.
      // A seed is spent once per agent-year and cannot be returned, so the
      // seller of a token who has already been rebound away from must not be
      // able to spend the buyer's. The mirror alone cannot answer that: it
      // learns of a rebind at the next Clock pass at the earliest.
      const blocked =
        (await chainBlock(chain)) ??
        (await tokenBlock(chain, parentId, q)) ??
        (await bindingBlock(chain, parentId, ctx.keyId, keyIdToBytes32)) ??
        (await walletCapBlock(chain, to));
      if (blocked) return { ok: false, reason: blocked };
      if (parent.level < 365) return { ok: false, reason: "parent-not-whole" };

      // One seed per completed agent-year. seedsSpent is counted from the rows
      // this key has already seeded, so it cannot drift from what was granted.
      const years = Math.floor((today() - q.firstMintDay(ctx.keyId)) / 365);
      if (q.seedsSpent(ctx.keyId) >= years) return { ok: false, reason: "no-seed-available" };

      // EVERY GATE ABOVE PASSES AND THERE IS STILL NOTHING TO GIVE.
      //
      // This tool used to insert a `tokens` row plus lineage here and answer
      // `{ ok: true, tokenId, txStatus: "queued" }`. That was a false promise,
      // and an expensive one. It wrote NO `mints` row, so no bitmap was ever
      // solved for the child and `pendingMints` -- which joins `mints` --
      // could never return it. `runClock` sends exactly three functions
      // (`mint`, `batchCheckIn`, `applyMark`); nothing in `src/clock/` mentions
      // seed at all. The contract's `seed(uint256,uint256,address,bytes)` is
      // called by nothing in this repository.
      //
      // So the child existed in the mirror, was served by `/t/<id>` and
      // `status` forever, and the chain had never heard of it -- while
      // `seedsSpent` counted the orphan and burned the key's one seed for that
      // agent-year. It was silent too: the row was in neither `stuckMints` nor
      // `dropped`, because both read `mints`.
      //
      // Refusing is not a workaround, it is the honest answer to "can I seed a
      // child today". Building the write path means a fourth pass in runClock
      // between mints and check-ins, sending
      // `seed(childId, parentId, to, "0x"+qr)` and marking the row on the
      // receipt, plus a queued solve for the child's bitmap. That is a feature,
      // not a fix, and nothing can reach this line for a long time yet: a
      // parent must be WHOLE (level 365) and a key needs a full year since its
      // first mint. The gates above still run and still answer precisely,
      // because "why can I not seed" deserves a real reason.
      return { ok: false, reason: "seed-not-available" };
    },
  };
}
