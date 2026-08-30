// Lineage. One seed per agent-year, free, and the child is bound to the caller.
import * as z from "zod";

export function makeSeedTool({ q, today }) {
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
      const parent = q.getToken(parentId);
      if (!parent) return { ok: false, reason: "unknown-token" };
      if (parent.keyId !== ctx.keyId) return { ok: false, reason: "not-bound-to-caller" };
      if (parent.status === "resting") return { ok: false, reason: "resting" };
      if (parent.level < 365) return { ok: false, reason: "parent-not-whole" };

      // One seed per completed agent-year. seedsSpent is counted from the rows
      // this key has already seeded, so it cannot drift from what was granted.
      const years = Math.floor((today() - q.firstMintDay(ctx.keyId)) / 365);
      if (q.seedsSpent(ctx.keyId) >= years) return { ok: false, reason: "no-seed-available" };

      const tokenId = q.nextTokenId();
      q.insertToken({ tokenId, keyId: ctx.keyId, owner: to, lastDay: today(), mintDay: today() });
      q.setLineage(tokenId, parent.generation + 1, parentId);
      return { ok: true, tokenId, parentId, generation: parent.generation + 1, to, level: 1, txStatus: "queued" };
    },
  };
}
