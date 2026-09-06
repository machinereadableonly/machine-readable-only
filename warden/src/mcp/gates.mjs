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
export async function tokenBlock(chain, tokenId, q = null) {
  const life = await chain.lifecycleOf(tokenId);
  if (life === null) return "chain-unavailable";
  if (!life.exists) return "unknown-token";
  if (!life.resting) return null;
  q?.setResting(tokenId);
  return "resting";
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
  const [contractState, token, wallet, supply] = await Promise.all([
    chainBlock(chain),
    tokenId === undefined ? null : tokenBlock(chain, tokenId, q),
    to === undefined ? null : walletCapBlock(chain, to),
    mints ? supplyBlock(chain) : null,
  ]);
  return contractState ?? token ?? wallet ?? supply ?? null;
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
  for (const method of ["writesOpen", "lifecycleOf", "walletRoomFor", "supplyRoom"]) {
    if (typeof chain?.[method] !== "function") {
      throw new Error(`${toolName} requires a chain reader with ${method}()`);
    }
  }
  return chain;
}
