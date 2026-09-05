// The Mark catalogue: the Warden's mirror of contracts/src/Ladder.sol.
//
// WHY IT IS A MIRROR AND NOT A SECOND DESIGN. `gates.mjs` exists because the
// gates were once written from the design document rather than from the
// contract's reverts, and four real gates were missed. The same discipline
// applies here: every field below has a twin in Ladder.sol, and
// contracts/test/Ladder.t.sol asserts the two agree by hash via
// tools/ladder-fixture.mjs. A catalogue that drifts from the chain sells an
// agent something the chain will refuse -- after it has paid.
//
// Five pairs. In four of them one side is bought and one earned by a run of
// days; pair five is BOUGHT ON BOTH SIDES and both sides are gated on holding an
// Iris, which is what stops a cheap day-one Aura forfeiting a Tint that needs
// 100 days. Taking either side closes the other permanently; a token may take
// neither. EVERY EXCLUSION IS PAIR-INTERNAL. Nothing is limited.
//
// TWO FIELDS HOLD THE PRICE, deliberately. `price` is the x402 demand string an
// agent is charged; `priceUsdc6` is what the contract publishes and what the
// mirror hash covers. assertLadderSane checks they are the same number, because
// two fields holding one fact is how they drift.
const pairOf = (id) => Math.ceil(id / 2);
const partnerOf = (id) => (id % 2 === 1 ? id + 1 : id - 1);
const ANY_IRIS = (1 << 5) | (1 << 6);

/// USDC has six decimals on Base, which is what the contract's `priceUsdc6`
/// counts. Rendered with two, because that is the money string x402 parses --
/// and verified against its parser in ladder.test.mjs rather than assumed.
const usd = (usdc6) => `$${(usdc6 / 1_000_000).toFixed(2)}`;

const bought = (id, name, priceUsdc6, { minLevel = 0, needsWhole = false, requiresAny = 0, variants = 1 } = {}) => ({
  id, name, pair: pairOf(id), route: "bought", price: usd(priceUsdc6), priceUsdc6,
  minLevel, minStreak: 0, needsWhole, supply: Infinity,
  excludes: 1 << partnerOf(id), requiresAny, variants,
});

const earned = (id, name, minStreak, { needsWhole = false, variants = 1 } = {}) => ({
  id, name, pair: pairOf(id), route: "earned", price: undefined, priceUsdc6: 0,
  minLevel: 0, minStreak, needsWhole, supply: Infinity,
  excludes: 1 << partnerOf(id), requiresAny: 0, variants,
});

/**
 * The run an earned Mark is measured against: the LONGEST this token has ever
 * completed, not the one standing today.
 *
 * MUST mirror `MachineReadableOnly._effectiveRun`. The contract is the
 * authority and it will refuse anything this admits wrongly -- after the agent
 * has been told it qualifies -- so a divergence here is an agent quoted a Mark
 * the chain then rejects.
 *
 * `streak` alone rewarded an agent that stopped over one that came back: a
 * token that reached 365 and went dark keeps its run forever, while one that
 * reached 365, missed a single day and RETURNED was reset to 1 and refused.
 * Decided 2026-09-05.
 *
 * `bestRun` is defaulted rather than assumed: a row written before the column
 * existed reads undefined, and `Math.max(n, undefined)` is NaN, which would
 * compare false against every gate and silently refuse every earned Mark.
 */
export const effectiveRun = (token) =>
  Math.max(token?.streak ?? 0, token?.bestRun ?? 0);

export const LADDER = {
  1:  bought(1,  "Hush",   1_000_000),
  2:  earned(2,  "Ache",   7),
  3:  bought(3,  "Static", 5_000_000,     { minLevel: 30 }),
  4:  earned(4,  "Beat",   30),
  5:  bought(5,  "Iris",   25_000_000,    { minLevel: 100, variants: 3 }),
  6:  earned(6,  "Iris",   100),
  7:  bought(7,  "Vessel", 1_250_000_000, { needsWhole: true }),
  8:  earned(8,  "Break",  365),
  9:  bought(9,  "Tint",   250_000_000,   { requiresAny: ANY_IRIS, variants: 2 }),
  10: bought(10, "Aura",   25_000_000,    { requiresAny: ANY_IRIS }),
};

/// The names of the three Iris shapes and the two Tint inks, by variant index.
/// The CONTRACT is the authority on the bounds -- MachineReadableOnly's private
/// _variantCount -- and it has no accessor, so the mirror hash cannot cover
/// this. ladder.test.mjs asserts the same table here.
export const VARIANT_NAMES = {
  5: ["target", "squircle", "leaf"],
  9: ["violet", "gold"],
};

/**
 * Refuse to start on a malformed catalogue.
 *
 * A Mark is either PRICED, in which case a price is mandatory and must equal
 * the integer the chain publishes, or EARNED, in which case a price is
 * forbidden. An entry that is neither, or both, is a wiring error and not
 * something an agent should meet as a runtime refusal -- the `upgrade` tool's
 * existing price guard exists so a missing price cannot sell a Vessel for the
 * price of a mint, and this is its sibling.
 */
export function assertLadderSane(ladder = LADDER) {
  for (const [id, m] of Object.entries(ladder)) {
    const priced = typeof m.price === "string" && /^\$\d/.test(m.price);
    const isEarned = m.route === "earned";
    if (priced && isEarned) throw new Error(`mark ${id} is both priced and earned`);
    if (!priced && !isEarned) throw new Error(`mark ${id} has no price and is not earned`);
    if (m.route === "bought" && !priced) throw new Error(`mark ${id} has no price`);
    if (priced && m.price !== usd(m.priceUsdc6)) {
      throw new Error(`mark ${id} has no price the chain agrees with: ${m.price} vs ${m.priceUsdc6}`);
    }
    if (isEarned && m.priceUsdc6 !== 0) throw new Error(`mark ${id} is earned and priced on chain`);
    // Caps were removed on 2026-09-01 because cold readers read scarcity as a
    // sales funnel. A cap reintroduced here would contradict Ladder.sol's
    // maxSupply = 0, and would be sold before the chain refused it.
    if (m.supply !== Infinity) throw new Error(`mark ${id} is limited, and nothing is limited`);
    // A MARK WITH A CHOICE MUST HAVE THE NAMES FOR IT. `upgrade` writes the
    // chosen shape or ink into the payment demand an agent reads before
    // spending up to $250.00, and it indexes this table to do it -- so a Mark
    // offering variants with no name table threw a TypeError out of a PAID tool
    // at the last possible moment. A missing name table is a wiring error like
    // a missing price, and a wiring error belongs at boot, where it stops the
    // service rather than one agent's purchase.
    if (m.variants > 1 && VARIANT_NAMES[m.id]?.length !== m.variants) {
      throw new Error(`mark ${id} offers ${m.variants} variants and VARIANT_NAMES does not name that many`);
    }
  }
  return ladder;
}
