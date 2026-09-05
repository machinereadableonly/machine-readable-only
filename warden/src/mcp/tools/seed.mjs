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
        parentId: z.number().int().positive(),
        to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte address"),
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

      // ONE FACT, the same way `mint` writes its two rows. A child token whose
      // lineage never landed is a token with no parent and generation 0 -- an
      // ordinary mint, indistinguishable from one, and it would still have
      // consumed the key's seed for the year.
      // The chain decides which ids are free, not this mirror. See
      // mint.mjs for why -- a seed writes a token the same way and would
      // collide the same way.
      const tokenId = await chain.freeIdFrom(q.nextTokenId());
      if (tokenId === null) return { ok: false, reason: "chain-unavailable" };
      const generation = parent.generation + 1;
      q.transact(() => {
        q.insertToken({ tokenId, keyId: ctx.keyId, owner: to, lastDay: today(), mintDay: today() });
        q.setLineage(tokenId, generation, parentId);
      });
      return { ok: true, tokenId, parentId, generation, to, level: 1, txStatus: "queued" };
    },
  };
}
