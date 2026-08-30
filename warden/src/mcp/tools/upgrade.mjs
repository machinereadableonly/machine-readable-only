// warden/src/mcp/tools/upgrade.mjs
import * as z from "zod";

/// Every reason an upgrade can be refused. All of them are checked BEFORE
/// payment is requested: an agent must never pay for a Mark it cannot have.
export const UPGRADE_REASONS = [
  "unknown-token", "not-bound-to-caller", "mark-inactive", "mark-level-too-low",
  "mark-needs-whole", "mark-needs-streak", "mark-sold-out", "mark-already-applied",
];

export function makeUpgradeTool({ q, catalogue, paid, alert = console.error }) {
  return {
    name: "upgrade",
    config: {
      title: "Buy a Mark",
      description: "Apply a paid Mark to a token bound to your key. Gates are checked before any payment is requested.",
      inputSchema: z.object({
        tokenId: z.number().int().positive(),
        // BOUNDED, because the bitmask below is a 32-bit shift. There are seven
        // marks; an unbounded id wraps -- 1 << 32 is 1 and 1 << 33 is 2, so a
        // high id aliases a low one -- and 1 << 31 is negative.
        upgradeId: z.number().int().min(1).max(7),
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
      if (q.markSold(upgradeId) >= mark.supply) return { ok: false, reason: "mark-sold-out" };
      if (token.marks & (1 << upgradeId)) return { ok: false, reason: "mark-already-applied" };

      // Only now is payment requested.
      return paid(async () => {
        // EVERYTHING ABOVE IS NOW STALE. Settling a payment takes seconds, and
        // in that window another buyer can take the last unit or the same token
        // can be marked. So the decision is made again here, against the
        // database, with the unique index as the final authority rather than a
        // read that could itself be overtaken.
        const fresh = q.getToken(tokenId);
        const blocked =
          !fresh ? "unknown-token"
          : fresh.keyId !== ctx.keyId ? "not-bound-to-caller"
          : fresh.marks & (1 << upgradeId) ? "mark-already-applied"
          : q.markSold(upgradeId) >= mark.supply ? "mark-sold-out"
          : null;

        // reserveMark returns false when this token already holds the mark, so
        // two settlements racing for the same token cannot both reserve.
        if (!blocked && q.reserveMark(tokenId, upgradeId)) {
          return { accepted: true, upgradeId, appliedBy: "the next Clock run" };
        }

        // MONEY HAS ALREADY CHANGED HANDS. This must never be a quiet refusal:
        // the agent has paid for something it cannot be given, and somebody has
        // to see that. Alert, and say plainly what happened.
        const detail = blocked ?? "mark-already-applied";
        alert(`upgrade ${upgradeId} for token ${tokenId} settled but cannot be applied: ${detail}`);
        return { ok: false, reason: "paid-but-unavailable", detail };
      })(args, ctx);
    },
  };
}
