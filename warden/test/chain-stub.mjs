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

/// Everything open: writes accepted, token alive, wallet has room.
export function openChain(overrides = {}) {
  return {
    boundKeyOf: async () => null,
    writesOpen: async () => null,
    lifecycleOf: async () => ({ exists: true, resting: false, sunset: false, level: 1, lastDay: 0 }),
    // An open chain holds no token at the proposed id, so the id the mirror
    // proposed is the id that lands. A stub returning something else here
    // would silently renumber every token these suites assert on.
    freeIdFrom: async (from) => from,
    walletRoomFor: async () => 20,
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

/// A chain whose ids are already taken, so freeIdFrom must skip past them.
export const takenIdsChain = (taken = [1]) =>
  openChain({ freeIdFrom: async (from) => { let id = from; while (taken.includes(id)) id += 1; return id; } });
