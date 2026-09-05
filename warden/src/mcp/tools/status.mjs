// What a token looks like right now, or what the caller owns.
import * as z from "zod";
import { tokenView, tokenLinks } from "../tokenView.mjs";

export function makeStatusTool({ q, domain, contract, chainId }) {
  // Built once per handler rather than per call, and shared with /t/<id> so a
  // scanner and an agent are told the same thing -- this function's own rule.
  const links = tokenLinks({ domain, contract, chainId });
  return {
    name: "status",
    config: {
      title: "Read a token, or your own",
      description: "With no id: the token you minted, and every token bound to your key. With an id: that token's live state. Every view carries `contract` and `chainId` so you can check it against the chain rather than against us.",
      inputSchema: z.object({ tokenId: z.number().int().positive().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async handler({ tokenId }, ctx) {
      if (tokenId !== undefined) {
        const view = tokenView(q, tokenId, links);
        return view ?? { ok: false, reason: "unknown-token" };
      }
      // The caller's own tokens. Read from the verified key id, never from an
      // argument, so nobody can enumerate somebody else's holdings.
      const mine = q.tokensForKey(ctx.keyId).map((t) => tokenView(q, t.tokenId, links));
      return { ok: true, tokens: mine };
    },
  };
}
