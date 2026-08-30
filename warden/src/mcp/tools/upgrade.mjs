// warden/src/mcp/tools/upgrade.mjs
import * as z from "zod";

/// Every reason an upgrade can be refused. All of them are checked BEFORE
/// payment is requested: an agent must never pay for a Mark it cannot have.
export const UPGRADE_REASONS = [
  "unknown-token", "not-bound-to-caller", "mark-inactive", "mark-level-too-low",
  "mark-needs-whole", "mark-needs-streak", "mark-sold-out", "mark-already-applied",
];

export function makeUpgradeTool({ q, catalogue, paid }) {
  return {
    name: "upgrade",
    config: {
      title: "Buy a Mark",
      description: "Apply a paid Mark to a token bound to your key. Gates are checked before any payment is requested.",
      inputSchema: z.object({
        tokenId: z.number().int().positive(),
        upgradeId: z.number().int().positive(),
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
      if (mark.sold >= mark.supply) return { ok: false, reason: "mark-sold-out" };
      if (token.marks & (1 << upgradeId)) return { ok: false, reason: "mark-already-applied" };

      // Only now is payment requested.
      return paid(async () => {
        q.reserveMark(tokenId, upgradeId);
        return { accepted: true, upgradeId, appliedBy: "the next Clock run" };
      })(args, ctx);
    },
  };
}
