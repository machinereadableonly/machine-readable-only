// The Warden's Mark catalogue, checked against the three things it can drift
// from: the contract (by hash, from contracts/test/Ladder.t.sol), the payment
// library (by parsing every price with x402's own parser), and itself (the
// display price against the integer the chain publishes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "@x402/core/utils";
import { LADDER, VARIANT_NAMES, assertLadderSane } from "../src/mcp/ladder.mjs";

test("every Mark is priced XOR earned, and never both", () => {
  for (const [id, m] of Object.entries(LADDER)) {
    const priced = typeof m.price === "string";
    const earned = m.route === "earned";
    assert.equal(priced, !earned, `mark ${id} is neither priced nor earned, or both`);
  }
});

test("a catalogue entry that is both is a STARTUP error, not a runtime refusal", () => {
  const broken = structuredClone(LADDER);
  broken[2].price = "$5.00";        // Ache is earned and must not carry a price
  assert.throws(() => assertLadderSane(broken), /priced and earned/);
});

test("a priced entry with no price is a startup error", () => {
  const broken = structuredClone(LADDER);
  delete broken[1].price;
  assert.throws(() => assertLadderSane(broken), /no price/);
});

// THE MONEY CHECK. The display string is what an agent is charged; priceUsdc6
// is what the chain publishes and what the mirror hash covers. Two fields
// holding one fact is how they drift, so they are checked against each other.
test("the display price and priceUsdc6 are the same number", () => {
  for (const m of Object.values(LADDER)) {
    if (m.route === "earned") {
      assert.equal(m.priceUsdc6, 0, `${m.name} is earned and must cost nothing`);
      continue;
    }
    assert.equal(m.price, `$${(m.priceUsdc6 / 1_000_000).toFixed(2)}`,
      `${m.name}: the string and the integer disagree`);
  }
});

test("a display price that disagrees with the chain's integer is a startup error", () => {
  const broken = structuredClone(LADDER);
  broken[3].price = "$1.00";        // Static is 5_000_000 on chain
  assert.throws(() => assertLadderSane(broken), /the chain agrees with/);
});

// Verified live 2026-09-02: "$1,250.00" throws Invalid money format. A comma
// would not fail until an agent's first payment attempt, so it fails here.
test("every price survives x402's own parser, not a regex of ours", () => {
  for (const m of Object.values(LADDER)) {
    if (m.route === "earned") continue;
    assert.doesNotThrow(() => parseMoney(m.price), `${m.name}: x402 rejects ${m.price}`);
  }
});

test("exclusions are symmetric and pair-internal", () => {
  for (const a of Object.keys(LADDER).map(Number)) {
    for (const b of Object.keys(LADDER).map(Number)) {
      const aExB = (LADDER[a].excludes & (1 << b)) !== 0;
      const bExA = (LADDER[b].excludes & (1 << a)) !== 0;
      assert.equal(aExB, bExA, `${a}/${b} exclusion is not symmetric`);
      if (aExB) {
        assert.equal(Math.ceil(a / 2), Math.ceil(b / 2), `${a} excludes ${b} across a pair`);
      }
    }
  }
});

test("nothing is limited", () => {
  for (const m of Object.values(LADDER)) assert.equal(m.supply, Infinity);
});

test("a reintroduced cap is a startup error, not a silent sales funnel", () => {
  const broken = structuredClone(LADDER);
  broken[1].supply = 100;
  assert.throws(() => assertLadderSane(broken), /limited/);
});

test("the four earned Marks are exactly Ache, Beat, the earned Iris and Break", () => {
  const earned = Object.values(LADDER).filter(m => m.route === "earned").map(m => m.id);
  assert.deepEqual(earned, [2, 4, 6, 8]);
});

// The contract is the authority on variant bounds -- MachineReadableOnly's
// private _variantCount, which has no accessor and so cannot be reached by the
// mirror hash. This asserts the same table on the JS side; the contract's own
// BadVariant boundary test is what actually enforces it.
test("only the bought Iris and Tint accept a variant, and the names match the count", () => {
  for (const m of Object.values(LADDER)) {
    const expected = m.id === 5 ? 3 : m.id === 9 ? 2 : 1;
    assert.equal(m.variants, expected, `${m.name} (${m.id}) has the wrong variant count`);
  }
  assert.equal(VARIANT_NAMES[5].length, LADDER[5].variants);
  assert.equal(VARIANT_NAMES[9].length, LADDER[9].variants);
  assert.deepEqual(Object.keys(VARIANT_NAMES).map(Number), [5, 9]);
});

// Both sides of pair five open at the same moment -- when the token holds an
// Iris by either route -- so the choice between loud-and-expensive and
// quiet-and-cheap is informed. Aura was ungated once, and being buyable on day
// one silently forfeited Tint, which needs 100 days.
test("both sides of pair five wait on an Iris", () => {
  const anIris = (1 << 5) | (1 << 6);
  assert.equal(LADDER[9].requiresAny, anIris, "Tint must need an Iris");
  assert.equal(LADDER[10].requiresAny, anIris, "Aura must need an Iris too");
  for (const m of Object.values(LADDER)) {
    if (m.id !== 9 && m.id !== 10) assert.equal(m.requiresAny, 0, `${m.name} should need nothing`);
  }
});
