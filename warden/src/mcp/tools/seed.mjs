// Lineage. One seed per agent-year, free, and the child is bound to the caller.
import * as z from "zod";
import { chainBlock, tokenBlock, walletCapBlock, requireChain, bindingBlock, supplyBlock } from "../gates.mjs";
import { keyIdToBytes32 } from "../keyId.mjs";

export function makeSeedTool({ q, chain, today }) {
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
      // EVERY LOCAL REFUSAL COMES FIRST, and that order is a rate-limiting
      // decision rather than a style one. The chain reads below are four
      // outbound RPC calls on a tool that is FREE and has no per-caller budget,
      // so an agent looping `seed` on its own level-1 token used to spend them
      // on every call before being refused on a fact this process already knew.
      // When the provider throttles, `writesOpen` answers "unreadable" and
      // `mint` and `upgrade` stop selling for everyone -- the paid path denied
      // through a free tool. Nothing about the answers changes; only what an
      // already-doomed call costs.
      const parent = q.getToken(parentId);
      if (!parent) return { ok: false, reason: "unknown-token" };
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
      if (parent.keyId !== ctx.keyId) {
        const onChain = await chain.boundKeyOf(parentId);
        if (!onChain || onChain !== keyIdToBytes32(ctx.keyId)) {
          return { ok: false, reason: "not-bound-to-caller" };
        }
      }
      if (parent.level < 365) return { ok: false, reason: "parent-not-whole" };

      // One seed per completed agent-year. seedsSpent is counted from the rows
      // this key has already seeded, so it cannot drift from what was granted.
      const years = Math.floor((today() - q.firstMintDay(ctx.keyId)) / 365);
      if (q.seedsSpent(ctx.keyId) >= years) return { ok: false, reason: "no-seed-available" };

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
      //
      // A seeded child is a token in the SAME collection, so it counts against
      // the SupplyCap the contract enforces on `seed` at :782, exactly as it
      // does on `mint`. This tool used to answer that from the mirror -- a
      // constant 10_000 against its own row count -- and both halves could
      // disagree with the chain: the cap is an owner dial, and the row count is
      // a fact about this database. It is read from the chain now, like every
      // other gate here.
      const blocked =
        (await chainBlock(chain)) ??
        (await tokenBlock(chain, parentId, q)) ??
        (await bindingBlock(chain, parentId, ctx.keyId, keyIdToBytes32)) ??
        (await walletCapBlock(chain, to)) ??
        (await supplyBlock(chain));
      if (blocked) return { ok: false, reason: blocked };

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
