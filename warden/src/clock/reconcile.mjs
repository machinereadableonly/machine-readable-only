// Making the mirror agree with the chain.
//
// The mirror is the source of truth for what agents are TOLD, but it is not the
// source of truth for what is. Three things happen on chain that this service
// never sees, because they are called by the token's owner from their own
// wallet and never pass through the Warden:
//
//   Rested    the owner sealed the token, permanently
//   Transfer  the token changed hands
//   Rebound   the owner pointed it at a different agent key
//
// Until reconcile runs, the mirror is wrong about all three -- and `resting` in
// particular is what /t/<id> tells a scanner, so a stale mirror makes the
// artwork lie about itself.
//
// THE PAGING IS NOT AN OPTIMISATION. The public Base RPC refuses any
// eth_getLogs spanning more than 10,000 blocks ("eth_getLogs is limited to a
// 10,000 range", measured 2026-08-31). Base blocks are 2 seconds, so 10,000
// blocks is about 5.5 hours and a single day is about 43,200. An unpaged daily
// reconcile does not fail loudly -- it either errors on the whole call or, with
// a narrower window, silently reads a fraction of the day and reports success.
import { parseEventLogs } from "viem";
import { MRO_ABI } from "./abi.mjs";

/// The measured cap. Not a tunable guess: larger is refused outright.
export const MAX_LOG_SPAN = 10_000n;

/// The block MachineReadableOnly was deployed in on Base Sepolia, found by
/// bisecting on code presence 2026-08-31. Reconcile floors here rather than
/// using a rolling window, because a rolling window silently forgets anything
/// older than itself -- and the contract went 9,000 blocks with no logs at all,
/// so "nothing recent" is a normal state rather than a signal.
export const DEPLOY_BLOCK = { 84532: 46_163_891n };

/**
 * Read every log this contract emitted in a block range, one page at a time.
 *
 * `onPage` is called per page so a long catch-up reports progress rather than
 * going quiet for minutes.
 */
export async function readEvents(pub, { contract, fromBlock, toBlock, span = MAX_LOG_SPAN, onPage = () => {} }) {
  if (span > MAX_LOG_SPAN) {
    throw new Error(`log span ${span} exceeds the ${MAX_LOG_SPAN}-block limit the RPC enforces`);
  }
  const events = [];
  let pages = 0;
  for (let start = BigInt(fromBlock); start <= BigInt(toBlock); start += span) {
    // Inclusive on both ends, so the window is span-1 wide, not span. Off by
    // one here re-reads a block per page, which is harmless, or skips one,
    // which loses whatever it held.
    const end = start + span - 1n > BigInt(toBlock) ? BigInt(toBlock) : start + span - 1n;
    const logs = await pub.getLogs({ address: contract, fromBlock: start, toBlock: end });
    events.push(...parseEventLogs({ abi: MRO_ABI, logs }));
    pages += 1;
    onPage({ from: start, to: end, found: logs.length, pages });
  }
  return { events, pages };
}

/**
 * Apply what the chain says to the mirror.
 *
 * Returns a count per event type actually applied. Events for tokens this
 * mirror has never heard of are counted as `skipped` rather than inserted: a
 * token minted by some other warden is not this service's to invent, and
 * inserting a half-known row would give the tools something they cannot answer
 * questions about.
 */
export function applyEvents(q, events, { log = () => {} } = {}) {
  const applied = { Rested: 0, Transfer: 0, Rebound: 0, Minted: 0, MarkApplied: 0, skipped: 0 };

  for (const event of events) {
    const name = event.eventName;
    if (!(name in applied)) continue;

    // Every event this reconcile cares about names a token. Transfer's is
    // `tokenId`; the rest use `id` or `tokenId` depending on the event.
    const tokenId = Number(event.args?.tokenId ?? event.args?.id ?? 0);
    if (!tokenId || !q.getToken(tokenId)) {
      applied.skipped += 1;
      continue;
    }

    switch (name) {
      case "Rested":
        // ONE WAY ONLY. rest() is irreversible on chain, so there is no branch
        // here that clears it.
        q.setResting(tokenId);
        applied.Rested += 1;
        break;
      case "Transfer": {
        const to = event.args?.to;
        // The mint's own Transfer comes from the zero address and tells us
        // nothing the mint row does not already say.
        if (to && event.args?.from !== "0x0000000000000000000000000000000000000000") {
          q.setOwner(tokenId, to.toLowerCase());
          applied.Transfer += 1;
        }
        break;
      }
      case "Rebound":
        // The chain stores a bytes32, and the mirror stores the thumbprint the
        // door speaks. They are not interconvertible -- the hash is one way --
        // so the value is recorded as it came and the Warden's live re-check
        // stays the authority on who may act. Writing a bytes32 into a column
        // the door compares thumbprints against would lock the agent out.
        log(`clock: token ${tokenId} was rebound on chain to ${event.args?.newKeyId}`);
        applied.Rebound += 1;
        break;
      case "Minted":
        q.markMintWritten(tokenId);
        applied.Minted += 1;
        break;
      case "MarkApplied":
        q.markOrderWritten(tokenId, Number(event.args?.upgradeId ?? 0));
        applied.MarkApplied += 1;
        break;
    }
  }
  return applied;
}
