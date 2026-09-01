// The way in. 1 USDC, paid inside the tool call, no account anywhere.
import * as z from "zod";
import { MINT_PRICE, MINT_RESOURCE } from "../../pay/x402.mjs";
import { paidWriteBlock, requireChain } from "../gates.mjs";

export function makeMintTool({ q, chain, paid, supplyCap, today, alert = console.error }) {
  requireChain(chain, "mint");
  return {
    name: "mint",
    config: {
      title: "Mint a token",
      // The price is interpolated, never typed twice. A description quoting a
      // price the wrapper does not charge is a lie told to every agent.
      description:
        `Costs ${MINT_PRICE} in USDC on Base. One per key. Returns immediately with your token id; the artwork is solved within the hour and written on chain at 00:05 UTC.`,
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

      // THE CONTRACT'S OWN GATES, read from the chain. Sunset, pause and the
      // per-address WalletCap are all invisible to this mirror, and every one
      // of them reverts a mint. Checked BEFORE payment: charging for a mint the
      // chain will refuse is the worst failure this tool has.
      const blocked = await paidWriteBlock(chain, { to: args.to });
      if (blocked) return { ok: false, reason: blocked };

      return paid(async () => {
        // BOTH GATES ARE RE-DECIDED AFTER SETTLEMENT, because settling takes
        // seconds and everything checked before it is now stale.
        //
        // `already-minted` is re-decided by the unique index on mints.keyId
        // below: two concurrent settlements from one key both pass the
        // pre-payment check, and the index is what actually holds it.
        //
        // The supply cap has no index behind it -- it is a count, not a
        // constraint -- so it has to be re-READ here, and this read is the only
        // thing between a settled payment and a token over the cap that the
        // contract would refuse to write. `seed` takes slots from the same
        // count, so this is not only a race between two mints.
        if (q.tokenCount() >= supplyCap) {
          alert(`mint settled for key ${ctx.keyId} but the supply cap was reached during settlement`);
          return { ok: false, reason: "paid-but-unavailable", detail: "supply-cap-reached" };
        }

        // THE CHAIN GATES ARE RE-READ TOO, for the same reason the cap is: the
        // piece can be paused or sunset, or the wallet cap filled by another
        // mint, while this payment was settling. A pre-payment check is stale
        // by the time the row is written.
        const stillBlocked = await paidWriteBlock(chain, { to: args.to });
        if (stillBlocked) {
          alert(`mint settled for key ${ctx.keyId} but the chain now refuses it: ${stillBlocked}`);
          return { ok: false, reason: "paid-but-unavailable", detail: stillBlocked };
        }

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
        // The price is passed at the call, never held by the wrapper: `paid` is
        // shared with `upgrade`, whose Marks cost up to 100,000 USDC.
        // The tool names itself, so the payment demand and every receipt say
        // "mint" rather than @x402/mcp's fallback "paid_tool". Shared with the
        // startup warm-up so both hit the same cache entry.
      }, MINT_PRICE, MINT_RESOURCE)(args, ctx);
    },
  };
}
