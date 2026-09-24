// The contract's gates, mirrored.
//
// WHY THIS FILE EXISTS. The Warden queues writes the chain then refuses, and
// for `mint` and `upgrade` the agent has already PAID by the time it refuses.
// The gates below were originally written from the DESIGN DOCUMENT, which
// describes intent; the contract describes what will actually be refused, and
// where the two differ only one of them stops a transaction. Enumerating
// `revert [A-Z]` in MachineReadableOnly.sol found four gates this service did
// not check at all -- WalletCap, Resting, Sunset and Paused -- after weeks of
// design work had missed them.
//
// Every function here answers with a REASON STRING to refuse with, or null to
// proceed. Each caller shapes its own refusal, because `checkin` answers with
// `accepted: false` and everything else with `ok: false`.
//
// THE NULL RULE. Each underlying chain read returns a distinct "could not ask"
// value, and that is never treated as permission. An RPC outage refuses the
// write; it does not admit it. Refusing costs an agent a retry, admitting
// costs it a payment for a transaction that was always going to revert.

// The year's end, imported rather than written again. It is the contract's own
// constant and every place that reads it has to move with it; it lived here as
// a bare 365 beside a private copy in tokenView.mjs until 2026-09-24.
import { FINISH_LEVEL } from "./ladder.mjs";

/// Refuse when the contract will not accept ANY write right now.
/// Mirrors the `notSunset` and `whenNotPaused` modifiers every write carries.
export async function chainBlock(chain) {
  const state = await chain.writesOpen();
  if (state === null) return null;
  return state === "unreadable" ? "chain-unavailable" : state;
}

/**
 * Refuse when the token does not exist on chain, or its owner has sealed it.
 * Mirrors NoSuchToken (level == 0) and Resting.
 *
 * `q` is optional, and when given a discovered `resting` is WRITTEN DOWN. That
 * is the only way this service ever learns a token was sealed -- `rest(id)` is
 * called by the owner straight on chain and never routed through here -- so
 * without it `/t/<id>` would go on telling a scanner that a sealed token is
 * still running. Recording it is free: the read has already happened.
 */
export async function tokenBlock(chain, tokenId, q = null, prefetched) {
  // `prefetched` is one `lifecycleOf` record a caller has ALREADY read, for a
  // caller that runs two gates off the same fact and should pay for one
  // eth_call rather than two. `undefined` means "nothing was handed over";
  // null is a real answer and means the chain could not be read, so the two
  // cannot be collapsed into a truthiness test.
  const life = prefetched === undefined ? await chain.lifecycleOf(tokenId) : prefetched;
  if (life === null) return "chain-unavailable";
  if (!life.exists) return "unknown-token";
  if (!life.resting) return null;
  q?.setResting(tokenId);
  return "resting";
}

/**
 * Refuse a credit to a token whose year is already complete.
 *
 * Mirrors `revert AlreadyFinished(id)`, which lives in `_credit` -- the one
 * function `batchCheckIn` and `checkInWithVoucher` share -- and fires on
 * `s.level >= FINISH_LEVEL`. A finished record is final in the same way a
 * sealed one is, reached by completion rather than by the owner.
 *
 * WHY THE CHAIN AND NOT THE MIRROR. `checkin` refuses on its own level first,
 * which is cheaper and catches every ordinary case. This gate is for the case
 * the mirror cannot answer: a mirror BEHIND the chain, where a reconcile has
 * not yet copied the finishing credit back. There the mirror would queue a
 * credit that `batchCheckIn` reverts on, and one reverting credit fails the
 * whole night's chunk.
 *
 * FINISH_LEVEL is INCLUSIVE, exactly as the contract has it: at 365 the year
 * is over, and the credit that MAKES 365 is taken at level 364.
 *
 * A null from the chain refuses, like every other gate here.
 *
 * `prefetched` is the same option `tokenBlock` takes, and for the same reason:
 * `checkin` runs both gates and they ask the chain one identical question.
 */
export async function yearCompleteBlock(chain, tokenId, prefetched) {
  const life = prefetched === undefined ? await chain.lifecycleOf(tokenId) : prefetched;
  if (life === null) return "chain-unavailable";
  return life.level >= FINISH_LEVEL ? "year-complete" : null;
}

/// Refuse when the chain has already minted `walletCap` tokens to an address.
/// Mirrors WalletCap, which guards both mint and seed.
export async function walletCapBlock(chain, to) {
  const room = await chain.walletRoomFor(to);
  if (room === null) return "chain-unavailable";
  return room > 0 ? null : "wallet-cap-reached";
}

/**
 * Refuse when the collection is full.
 *
 * Mirrors SupplyCap, which guards `mint` and `seed` and nothing else -- a Mark
 * adds no token, so `upgrade` never asks this.
 *
 * READ FROM THE CHAIN, NOT COUNTED HERE. This was the one contract gate still
 * answered from the mirror: the constant 10_000 against `q.tokenCount()`. The
 * cap is an owner dial and the row count is a fact about this database, so both
 * halves could disagree with the chain at once. See read.mjs supplyRoom().
 */
export async function supplyBlock(chain) {
  const room = await chain.supplyRoom();
  if (room === null) return "chain-unavailable";
  return room > 0 ? null : "supply-cap-reached";
}

/**
 * Refuse when the parent's KEY has no seed left for this agent-year.
 *
 * Mirrors `revert NoSeedAvailable()`, which guards `seed` alone.
 *
 * READ FROM THE CHAIN, NOT COUNTED HERE. This was the last gate in `seed`
 * answered from the mirror, and it was answered off `tokens.keyId` -- the one
 * column `reconcile` REWRITES whenever it sees a `Rebound`. The contract keeps
 * tenure in per-key mappings `rebind` never touches, so a rebind moved the
 * Warden's answer and not the chain's: it granted a second seed the chain then
 * refused, and refused a first seed the chain would have granted. See
 * chain/read.mjs seedsAvailable() for the three measured divergences.
 *
 * THE ONE THING ONLY THE MIRROR KNOWS is a seed already RESERVED here and not
 * yet written, so that is subtracted from the chain's answer. The window is up
 * to a day wide -- a reservation waits for the next 00:05 UTC run -- and a
 * guard reading committed state alone would let two seeds out inside it. An
 * unwritten reservation cannot itself have been rebound, because `rebind` is a
 * call on a token the chain already holds.
 *
 * `q` is required rather than optional: a caller that forgot it would get the
 * chain's figure with nothing subtracted, which is the over-issue this exists
 * to prevent.
 */
export async function seedBudgetBlock(chain, q, parentId, keyId) {
  const onChain = await chain.seedsAvailable(parentId);
  if (onChain === null) return "chain-unavailable";
  return onChain - q.unwrittenSeeds(keyId) > 0 ? null : "no-seed-available";
}

/**
 * Refuse when the recipient cannot hold an ERC-721.
 *
 * Mirrors no named MRO error, which is what makes it different from every
 * other gate here: the revert comes from OpenZeppelin's `_safeMint` calling
 * `onERC721Received` on the recipient, or from the recipient's own code. It is
 * not in our ABI, so the Clock could only ever log a bare
 * `reverted-on-simulate` for it (F6).
 *
 * THE COST OF NOT HAVING THIS, measured on a Base mainnet fork 2026-09-15: the
 * agent pays, the mint is queued, and it reverts on simulate every night
 * forever -- and a check-in queued behind it is condemned `NoSuchToken` into
 * `stuckCredits`, so one bad recipient also fails the whole Clock run (F7).
 *
 * IT EXCLUDES NOBODY THE CONTRACT WOULD ACCEPT. `--to` is the OWNER address the
 * agent names, not the agent itself, so a refusal costs a retry with a
 * different address and no money at all.
 */
export async function receiverBlock(chain, to) {
  const canReceive = await chain.canReceiveERC721(to);
  if (canReceive === null) return "chain-unavailable";
  return canReceive ? null : "recipient-cannot-receive";
}

/**
 * What to tell an agent that named an address which cannot hold the token.
 *
 * A bare reason would leave it guessing at a problem it can fix in one call,
 * and the cold-read work says an agent acts on a refusal only when the refusal
 * names the remedy.
 */
export const RECIPIENT_REMEDY =
  "That address has code that does not accept ERC-721 tokens -- a contract with no " +
  "onERC721Received, or a delegated wallet whose delegate has none. Nothing was charged. " +
  "Call mint again with an ordinary wallet address, or one that accepts ERC-721.";

/**
 * Every gate a PAID write needs, in one call.
 *
 * `to` is optional: `upgrade` does not mint anything, so it has no wallet cap
 * to check. `mints` is the same distinction for the supply cap, and it is
 * declared rather than inferred from `to` so that a caller adding an address
 * for some other reason cannot silently acquire a gate it does not want.
 *
 * The reads run concurrently because they are independent, and the first reason
 * in gate order wins so the answer is stable rather than a race.
 */
export async function paidWriteBlock(chain, { tokenId, to, q, mints = false } = {}) {
  const [contractState, token, wallet, supply, receiver] = await Promise.all([
    chainBlock(chain),
    tokenId === undefined ? null : tokenBlock(chain, tokenId, q),
    to === undefined ? null : walletCapBlock(chain, to),
    mints ? supplyBlock(chain) : null,
    // Keyed off `to` like the wallet cap, and for the same reason: a write
    // with no recipient has nothing to deliver to. `upgrade` never asks.
    to === undefined ? null : receiverBlock(chain, to),
  ]);
  return contractState ?? token ?? wallet ?? supply ?? receiver ?? null;
}

/**
 * Refuse when the CHAIN does not say this token is bound to this caller.
 *
 * THE MIRROR IS NOT AN ANSWER TO THIS QUESTION. `rebind` is called by the token
 * owner straight on chain and never routed through this service, so
 * `tokens.keyId` learns of it only when the Clock next reconciles -- and only
 * then if the new key happens to be registered here. Until 2026-09-05 it never
 * learned at all.
 *
 * BOTH DIRECTIONS, which is what makes this different from the older check in
 * `checkin`. That one asks the chain only when the mirror does NOT recognise
 * the caller, so it lets a rebound buyer in but never shuts the seller out.
 * Here the chain is the only authority consulted, so a seller who has already
 * transferred and been rebound away from cannot act, whatever the mirror still
 * says. That matters because the calls guarded by this are irreversible: taking
 * one side of an exclusive pair forecloses the other permanently, and spending
 * a token's yearly seed cannot be undone.
 *
 * A null from the chain is refused, not admitted -- the same rule every other
 * gate here follows.
 */
export async function bindingBlock(chain, tokenId, keyId, toBytes32) {
  const onChain = await chain.boundKeyOf(tokenId);
  if (!onChain) return "chain-unavailable";
  return onChain === toBytes32(keyId) ? null : "not-bound-to-caller";
}

/// A dependency check for the tool factories. A tool that silently skipped its
/// gates because `chain` was not passed would be indistinguishable from one
/// that passed them -- which is exactly how these gates went missing.
export function requireChain(chain, toolName) {
  // 5.L1. THE LIST HAS TO BE THE METHODS THE TOOLS ACTUALLY CALL. It named
  // three, and `mint` crashes on `freeIdFrom` while `upgrade`, `seed` and
  // `checkin` crash on `boundKeyOf` -- both of which a reader would reasonably
  // assume this guard covers, since covering them is its whole purpose. That is
  // not hypothetical: `chain.freeIdFrom is not a function` reached production
  // in 2026-09-03 while every tool test passed, because the test double had the
  // methods the doubles were written with rather than the ones the code calls.
  for (const method of ["writesOpen", "lifecycleOf", "walletRoomFor", "supplyRoom", "freeIdFrom", "boundKeyOf", "seedsAvailable", "canReceiveERC721"]) {
    if (typeof chain?.[method] !== "function") {
      throw new Error(`${toolName} requires a chain reader with ${method}()`);
    }
  }
  return chain;
}
