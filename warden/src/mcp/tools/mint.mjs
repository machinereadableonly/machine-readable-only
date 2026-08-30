// The way in. 0.10 USDC, paid inside the tool call, no account anywhere.
import * as z from "zod";

export function makeMintTool({ q, paid, supplyCap, today, alert = console.error }) {
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
        // Re-decided after settlement, for the same reason as upgrade: two
        // concurrent settlements from one key both pass the check above. The
        // unique index on mints.keyId is what actually holds it.
        // The id is assigned HERE, not by the contract. The contract takes it
        // as an argument and reverts if taken, so the id promised now is the id
        // that lands.
        const tokenId = q.nextTokenId();
        const day = today();
        try {
          // The two rows are ONE FACT: a token with no mint record holds a
          // supply-cap slot no mint will ever claim, and a mint with no token
          // is unreachable. Writing them separately let a losing concurrent
          // settlement insert its token, get refused by the guarded write,
          // and leave that orphan behind. insertMint goes FIRST, inside the
          // transaction, so the guarded write hits the unique index on
          // mints.keyId before anything else is attempted; if it throws, the
          // whole transaction rolls back and insertToken never lands either.
          q.transact(() => {
            // solveState 'pending' is what puts this token in front of the solver.
            q.insertMint({ tokenId, toAddress: args.to, keyId: ctx.keyId });
            q.insertToken({ tokenId, keyId: ctx.keyId, owner: args.to, lastDay: day, mintDay: day });
          });
        } catch (err) {
          // The unique index refused a second mint for this key. The agent has
          // PAID, so this is never silent.
          alert(`mint settled for key ${ctx.keyId} but could not be recorded: ${err.message}`);
          return { ok: false, reason: "paid-but-unavailable", detail: "already-minted" };
        }
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
