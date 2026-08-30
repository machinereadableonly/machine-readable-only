// The check-in tool. Free to the agent; the site pays the gas at 00:05 UTC.
import * as z from "zod";
import { keyIdToBytes32 } from "../keyId.mjs";

/// Day numbers are whole UTC days since the epoch, the same unit the contract
/// uses, so the mirror and the chain cannot drift on what "today" means.
export const utcDay = (now = Date.now()) => Math.floor(now / 86_400_000);

export function makeCheckinTool({ q, chain, today = utcDay }) {
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
      if (!token) return { accepted: false, reason: "unknown-token" };

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
          return { accepted: false, reason: "not-bound-to-caller" };
        }
      }

      const day = today();
      if (!q.insertCredit(tokenId, day, ctx.sigHash ?? "")) {
        return {
          accepted: false,
          reason: "already-credited-today",
          nextWindowOpensAt: new Date((day + 1) * 86_400_000).toISOString(),
        };
      }

      return {
        accepted: true,
        creditedDay: day,
        level: token.level + 1,
        streak: day === token.lastDay + 1 ? token.streak + 1 : 1,
        nextWindowOpensAt: new Date((day + 1) * 86_400_000).toISOString(),
      };
    },
  };
}
