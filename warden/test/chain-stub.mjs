// A chain reader for tests, open by default.
//
// NOT a *.test.mjs file, so `node --test "test/**/*.test.mjs"` does not try to
// run it as a suite.
//
// Every tool that queues a write now reads the contract's own gates -- sunset,
// pause, resting, wallet cap -- because the mirror cannot know any of them.
// The tool factories REFUSE to build without a chain reader (gates.mjs
// requireChain), so a test that forgot one would otherwise look like a test of
// a tool with no gates at all. That is the failure this file exists to make
// impossible: an open chain has to be asked for explicitly.
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";

/**
 * Everything open: writes accepted, token alive, wallet has room, and every
 * token bound to `boundTo`.
 *
 * WHY THE BINDING HAS A DEFAULT AT ALL. It used to answer null, which was right
 * when only `checkin` read it and only in the direction "the mirror does not
 * recognise this caller, ask the chain before refusing" -- there, null means
 * "could not ask" and refusing is the safe answer. Since 2026-09-05 `upgrade`
 * and `seed` read it on EVERY call, in both directions, so a null default would
 * make an open chain refuse every irreversible write in every suite. `"k1"` is
 * the key id these fixtures overwhelmingly use.
 *
 * A test whose caller is not `k1` will be refused `not-bound-to-caller`, which
 * is the correct answer to what it actually asked. Pass `boundTo` rather than
 * relaxing the assertion.
 */
export function openChain({ boundTo = "k1", ...overrides } = {}) {
  return {
    boundKeyOf: async () => keyIdToBytes32(boundTo),
    writesOpen: async () => null,
    lifecycleOf: async () => ({ exists: true, resting: false, sunset: false, level: 1, lastDay: 0 }),
    // An open chain holds no token at the proposed id, so the id the mirror
    // proposed is the id that lands. A stub returning something else here
    // would silently renumber every token these suites assert on.
    freeIdFrom: async (from) => from,
    walletRoomFor: async () => 20,
    // Room left in the COLLECTION. Read from the chain since 2026-09-06; it
    // used to be the constant 10_000 compared against the mirror's row count,
    // which is a fact about the database rather than about the contract.
    supplyRoom: async () => 9_998,
    // Seeds left for the parent's key, read from the chain since 2026-09-07.
    // ONE, not many: the contract grants one per completed agent-year, so an
    // open chain is a key that has run a year and not yet spent it. A stub
    // answering a large number would hide every off-by-one in the subtraction
    // `seedBudgetBlock` does against the mirror's reservations.
    seedsAvailable: async () => 1,
    ...overrides,
  };
}

export const sunsetChain = () => openChain({ writesOpen: async () => "sunset" });
export const pausedChain = () => openChain({ writesOpen: async () => "paused" });
export const unreadableChain = () =>
  openChain({
    writesOpen: async () => "unreadable",
    lifecycleOf: async () => null,
    freeIdFrom: async () => null,
    walletRoomFor: async () => null,
    supplyRoom: async () => null,
    boundKeyOf: async () => null,
    seedsAvailable: async () => null,
  });
export const restingChain = () =>
  openChain({
    lifecycleOf: async () => ({ exists: true, resting: true, sunset: false, level: 400, lastDay: 0 }),
  });
export const unknownTokenChain = () =>
  openChain({
    lifecycleOf: async () => ({ exists: false, resting: false, sunset: false, level: 0, lastDay: 0 }),
  });
export const walletFullChain = () => openChain({ walletRoomFor: async () => 0 });
/// The collection is full: the contract would revert SupplyCap().
export const supplyFullChain = () => openChain({ supplyRoom: async () => 0 });
/// The parent's key has no seed left for this agent-year: NoSeedAvailable().
export const noSeedChain = () => openChain({ seedsAvailable: async () => 0 });

/// A chain whose ids are already taken, so freeIdFrom must skip past them.
export const takenIdsChain = (taken = [1]) =>
  openChain({ freeIdFrom: async (from) => { let id = from; while (taken.includes(id)) id += 1; return id; } });
