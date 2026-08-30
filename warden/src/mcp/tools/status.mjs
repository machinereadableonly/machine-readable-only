// What a token looks like right now, or what the caller owns.
import * as z from "zod";
import { tokenView } from "../tokenView.mjs";

export function makeStatusTool({ q }) {
  return {
    name: "status",
    config: {
      title: "Read a token, or your own",
      description: "With no id: the token you minted, and every token bound to your key. With an id: that token's live state.",
      inputSchema: z.object({ tokenId: z.number().int().positive().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async handler({ tokenId }, ctx) {
      if (tokenId !== undefined) {
        const view = tokenView(q, tokenId);
        return view ?? { ok: false, reason: "unknown-token" };
      }
      // The caller's own tokens. Read from the verified key id, never from an
      // argument, so nobody can enumerate somebody else's holdings.
      const mine = q.tokensForKey(ctx.keyId).map((t) => tokenView(q, t.tokenId));
      return { ok: true, tokens: mine };
    },
  };
}
