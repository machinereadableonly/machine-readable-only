// warden/src/mcp/tools/rest.mjs
import * as z from "zod";

export function makeRestTool({ q, contract }) {
  return {
    name: "rest",
    config: {
      title: "Seal a token, permanently",
      description: "Returns the call the token OWNER's wallet must sign. This cannot be undone.",
      inputSchema: z.object({ tokenId: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async handler({ tokenId }) {
      if (!q.getToken(tokenId)) return { ok: false, reason: "unknown-token" };
      return { ok: true, contract, function: "rest", args: [tokenId], irreversible: true };
    },
  };
}
