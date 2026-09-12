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

/// The block MachineReadableOnly was deployed in on Base Sepolia. Reconcile
/// floors here rather than using a rolling window, because a rolling window
/// silently forgets anything older than itself -- and the contract went 9,000
/// blocks with no logs at all, so "nothing recent" is a normal state rather
/// than a signal.
///
/// THIS MUST CHANGE WITH EVERY REDEPLOY, and contracts/script/adopt-deployment.sh
/// changes it, from the broadcast receipt. Left at a previous contract's block
/// it does not fail -- it pages tens of thousands of empty blocks and finds
/// nothing, which reads as a quiet chain rather than as a misconfiguration.
///
/// This comment deliberately names no block. It used to ("block 46,468,133",
/// the 2026-09-06 pair), and the script, which rewrites only the value, left
/// it describing a superseded deployment (found 2026-09-12). The value is the
/// fact.
export const DEPLOY_BLOCK = { 84532: 46_686_660n };

/// The highest Mark id the CONTRACT will accept, from MachineReadableOnly.sol's
/// own `MAX_MARK_ID`. Ids 11-15 are unwritten today (Plan 6 reserved them), so
/// this is deliberately the chain's bound and not the catalogue's ten.
const MAX_MARK_ID = 15;

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
    // 15.11. The `address` above is a NODE-SIDE filter, and viem's
    // parseEventLogs does not re-apply it -- read at source in viem 2.56.0, it
    // matches on topic0, event name and args only, and the string "address"
    // does not appear in it. So one RPC's filtering was the only thing between
    // a foreign `Transfer` and `q.setOwner` rewriting a token's owner. Any
    // ERC-721 emits a topic-compatible Transfer, so this is not a hypothetical
    // shape; it is the most common event on the chain.
    const ours = logs.filter((l) => l.address?.toLowerCase() === contract.toLowerCase());
    events.push(...parseEventLogs({ abi: MRO_ABI, logs: ours }));
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
  const applied = {
    Rested: 0, Transfer: 0, Rebound: 0, Minted: 0, MarkApplied: 0, skipped: 0,
    // 4.M8. THE THREE EVENTS THAT ARE SEEN AND NOT APPLIED, counted rather than
    // discarded, because "the mirror ignored it" and "the chain never said it"
    // used to look identical from here.
    //
    // BatchCheckedIn carries NO TOKEN IDS -- the contract emits one event for a
    // whole day's chunk -- so no reconcile can ever heal a check-in from it.
    // The chain's STATE is the only source, which is what `lastDayOf` and
    // healDayNotAdvanced in batch.mjs read. Counting it here is still worth
    // doing: it says a day landed, which is the fact an operator is looking for
    // when a night is in doubt.
    //
    // Seeded is OURS since 2026-09-07: the tool reserves a child and the
    // Clock's fourth pass sends `seed`. Counting it says a child landed, which
    // is the fact an operator is looking for when a night is in doubt. It
    // cannot heal a seed on its own -- `markSeedWritten` is driven by the
    // receipt in that pass, not by this log -- and `seed` is onlyWarden, so an
    // event this service did not send would mean another signer holds the
    // role.
    //
    // SunsetAt is the operator closing the piece. The tools already read it
    // live from the chain on every gated call, so nothing is admitted after it;
    // what was missing was anyone being TOLD.
    BatchCheckedIn: 0, Seeded: 0, SunsetAt: 0,
  };

  for (const event of events) {
    const name = event.eventName;
    if (!(name in applied)) continue;

    // The three above name no token this mirror has to find, and two of them
    // name no token at all.
    if (name === "BatchCheckedIn" || name === "Seeded" || name === "SunsetAt") {
      applied[name] += 1;
      if (name === "SunsetAt") log("clock: the chain says the piece has been SUNSET -- no further write will be accepted");
      // `Seeded(parentId, childId, generation)` -- NEITHER `tokenId` NOR `id`,
      // which is what this read until 2026-09-07, so it printed "?" every
      // time. It went unnoticed because nothing sent the event and the test
      // double was written with the names the code read rather than the ones
      // the ABI emits.
      if (name === "Seeded") {
        log(
          `clock: the chain confirms child ${String(event.args?.childId ?? "?")} ` +
            `was seeded from parent ${String(event.args?.parentId ?? "?")}`
        );
      }
      continue;
    }

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
      case "Rebound": {
        // The chain stores a bytes32 and the mirror stores the thumbprint the
        // door speaks, and the hash between them is ONE WAY. That is why this
        // case did nothing but log until 2026-09-05 -- and the cost was that
        // `tokens.keyId` never converged with the chain in either direction:
        // the seller of a token kept authority over it forever, and the buyer
        // was refused forever.
        //
        // The way out is not to invert the hash but to have stored it going
        // forwards. `keys.keyIdHash` is written at registration, so a Rebound
        // naming a key this Warden has seen resolves to its thumbprint with an
        // index hit.
        const newKeyId = q.keyForHash(String(event.args?.newKeyId ?? "").toLowerCase());
        if (newKeyId) {
          q.setKeyId(tokenId, newKeyId);
          log(`clock: token ${tokenId} was rebound on chain to ${newKeyId}`);
        } else {
          // A key this Warden has never seen, which is entirely legitimate --
          // an agent may rebind to a key it has not registered here. What must
          // NOT happen is the mirror carrying on believing the old binding, so
          // the tools that can act irreversibly read the chain directly rather
          // than trusting this column. Logged loudly because it is the one case
          // where the mirror knowingly holds a value it cannot correct.
          log(
            `clock: token ${tokenId} was rebound on chain to an UNREGISTERED key ` +
              `${event.args?.newKeyId} -- the mirror's binding is stale until that key registers`
          );
        }
        applied.Rebound += 1;
        break;
      }
      case "Minted":
        q.markMintWritten(tokenId);
        applied.Minted += 1;
        break;
      case "MarkApplied": {
        // 4.L8. `?? 0` WOULD HAVE SET BIT 0, WHICH IS NOT A MARK. Ids run
        // 1..15 on chain (MachineReadableOnly.sol MAX_MARK_ID), so a decode
        // that lost the argument wrote a bit no Mark owns into `tokens.marks`
        // and marked an order 'written' for upgrade 0 -- silently, and
        // permanently, because nothing ever clears a bit. A missing id is a
        // decode failure and not a Mark: it is counted as skipped and reported,
        // and the order stays queued for a run that can read it.
        const upgradeId = Number(event.args?.upgradeId);
        if (!Number.isInteger(upgradeId) || upgradeId < 1 || upgradeId > MAX_MARK_ID) {
          applied.skipped += 1;
          log(`clock: a MarkApplied on token ${tokenId} carried no usable upgradeId (${String(event.args?.upgradeId)}); nothing written`);
          break;
        }
        q.markOrderWritten(tokenId, upgradeId);
        applied.MarkApplied += 1;
        break;
      }
    }
  }
  return applied;
}
