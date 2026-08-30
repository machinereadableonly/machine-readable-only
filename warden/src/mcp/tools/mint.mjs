// The way in. 0.10 USDC, paid inside the tool call, no account anywhere.
import * as z from "zod";

export function makeMintTool({ q, paid, supplyCap, today }) {
  return {
    name: "mint",
    config: {
      title: "Mint a token",
      description:
        "Costs $0.10 in USDC on Base. One per key. Returns immediately with your token id; the artwork is solved within the hour and written on chain at 00:05 UTC.",
      inputSchema: z.object({
        to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte address"),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },

    async handler(args, ctx) {
      // Both gates come before payment. Charging for a mint that cannot happen
      // is the worst failure this tool has.
      if (q.hasMinted(ctx.keyId)) return { ok: false, reason: "already-minted" };
      if (q.tokenCount() >= supplyCap) return { ok: false, reason: "supply-cap-reached" };

      return paid(async () => {
        // The id is assigned HERE, not by the contract. The contract takes it
        // as an argument and reverts if taken, so the id promised now is the id
        // that lands.
        const tokenId = q.nextTokenId();
        const day = today();
        q.insertToken({ tokenId, keyId: ctx.keyId, owner: args.to, lastDay: day, mintDay: day });
        // solveState 'pending' is what puts this token in front of the solver.
        q.insertMint({ tokenId, toAddress: args.to, keyId: ctx.keyId });
        return {
          ok: true,
          tokenId,
          to: args.to,
          agentKeyId: ctx.keyId,
          level: 1,
          txStatus: "queued",
          onChainBy: new Date((day + 1) * 86_400_000 + 300_000).toISOString(),
        };
      })(args, ctx);
    },
  };
}
