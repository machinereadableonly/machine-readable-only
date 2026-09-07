// Lineage. One seed per agent-year, free, and the child is bound to the caller.
import * as z from "zod";
import { chainBlock, tokenBlock, walletCapBlock, requireChain, bindingBlock, supplyBlock } from "../gates.mjs";
import { keyIdToBytes32 } from "../keyId.mjs";
import { onChainBy } from "../nextSteps.mjs";

export function makeSeedTool({ q, chain, today, alert = console.error }) {
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

      // EVERY GATE PASSES. RESERVE THE CHILD AND LET THE CLOCK WRITE IT.
      //
      // THE ID IS ASSIGNED HERE and sent to the contract, exactly as `mint`
      // assigns one, so it has to be an id THE CHAIN will accept. The mirror's
      // own max id is not that: an empty mirror beside a contract that already
      // holds tokens proposes an id `seed` reverts TokenExists on. Null from
      // `freeIdFrom` means "could not establish one", never "use it anyway" --
      // and reserving on a guess is worse here than on a mint, because what it
      // spends is a budget the agent earns once a year and cannot re-earn.
      const tokenId = await chain.freeIdFrom(q.nextTokenId());
      if (tokenId === null) return { ok: false, reason: "chain-unavailable" };

      // THE `tokens` ROW IS THE RESERVATION. `seedsSpent` counts
      // `parentId IS NOT NULL`, so the key's seed for this agent-year is spent
      // the instant this returns -- there is no second counter to increment,
      // and the gate above therefore sees a promise a Clock run has not yet
      // made good. That is the whole point: the window between reserving and
      // writing is up to a day wide, and a guard reading only committed state
      // would let two seeds out inside it.
      //
      // `insertSeed` OWNS ITS TRANSACTION and writes both rows in it. Do not
      // wrap this in `q.transact`: node:sqlite has no nested transactions and
      // throws "cannot start a transaction within a transaction". Both rows
      // are one fact -- a `tokens` row with no `mints` row is a child no
      // bitmap is ever solved for, which is the orphan this tool used to make.
      //
      // WHEN THE WRITE LATER FAILS: the Clock's fourth pass drops the pair on
      // a permanent named revert, which deletes both rows and hands the
      // agent-year back. A child whose bitmap never solves is reported and
      // never dropped, because returning a year is a decision, not a sweep.
      const day = today();
      try {
        q.insertSeed({
          childId: tokenId,
          parentId,
          toAddress: to,
          keyId: ctx.keyId,
          lastDay: day,
          mintDay: day,
        });
      } catch (err) {
        // The id was free on chain a moment ago and is taken in this database
        // now, which means a concurrent call won the race for it. The whole
        // transaction rolled back, so no seed was spent and calling again gets
        // the next id. Never silent: nothing else can produce this.
        alert(`seed refused for key ${ctx.keyId} from parent ${parentId}: could not be recorded: ${err.message}`);
        return { ok: false, reason: "internal" };
      }

      return {
        ok: true,
        tokenId,
        parentId,
        to,
        agentKeyId: ctx.keyId,
        // The contract writes the child at `level: 1, streak: 1`, and its
        // generation as the parent's plus one. Read back rather than assumed:
        // the depth is computed in the insert's own SQL, so this is the one
        // field the caller could not work out from what it sent.
        level: 1,
        generation: q.getToken(tokenId).generation,
        txStatus: "queued",
        // The same 00:05 UTC promise `mint` makes, from the same formula.
        onChainBy: onChainBy(day),
        note:
          `Child ${tokenId} is reserved from parent ${parentId} and costs nothing. Its artwork is being solved now ` +
          `and it is written on chain at the next 00:05 UTC run; read it at /t/${tokenId} after that. ` +
          "This was your seed for this agent-year; the next one opens a year after your first mint.",
      };
    },
  };
}
