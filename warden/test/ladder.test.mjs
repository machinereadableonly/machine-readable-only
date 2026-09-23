// The Warden's Mark catalogue, checked against the three things it can drift
// from: the contract (by hash, from contracts/test/Ladder.t.sol), the payment
// library (by parsing every price with x402's own parser), and itself (the
// display price against the integer the chain publishes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMoney } from "@x402/core/utils";
import { LADDER, VARIANT_NAMES, FINISHER_IDS, FINISHER_MASK, requestable, assertLadderSane } from "../src/mcp/ladder.mjs";

// IDS 1-10. A finisher Mark is a THIRD route -- given for a place, never bought
// and never earned by a run -- so it is neither side of this rule by design.
test("every Mark in the five pairs is priced XOR earned, and never both", () => {
  for (const [id, m] of Object.entries(LADDER)) {
    if (m.route === "finisher") continue;
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
    if (m.route === "earned" || m.route === "finisher") {
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
    if (m.route !== "bought") continue;
    assert.doesNotThrow(() => parseMoney(m.price), `${m.name}: x402 rejects ${m.price}`);
  }
});

// IDS 1-10 again. The five finisher Marks exclude each other as a GROUP rather
// than in pairs -- a token finishes once -- so they are symmetric but not
// pair-internal, and that group is asserted on its own below.
test("exclusions are symmetric and pair-internal", () => {
  const pairs = Object.values(LADDER).filter((m) => m.route !== "finisher").map((m) => m.id);
  for (const a of pairs) {
    for (const b of pairs) {
      const aExB = (LADDER[a].excludes & (1 << b)) !== 0;
      const bExA = (LADDER[b].excludes & (1 << a)) !== 0;
      assert.equal(aExB, bExA, `${a}/${b} exclusion is not symmetric`);
      if (aExB) {
        assert.equal(Math.ceil(a / 2), Math.ceil(b / 2), `${a} excludes ${b} across a pair`);
      }
    }
  }
});

// NOTHING IN THE PAIRS is limited, which is narrower than the old claim.
// Ids 11-15 are the finisher Marks and they ARE capped, at the size of the place
// band each one covers -- a cap on something that cannot be bought at all, which
// is not the sales funnel caps were removed for on 2026-09-01.
test("nothing in the five pairs is limited", () => {
  for (const m of Object.values(LADDER)) {
    if (m.route === "finisher") continue;
    assert.equal(m.supply, Infinity, `${m.name} is limited`);
  }
});

test("a reintroduced cap is a startup error, not a silent sales funnel", () => {
  const broken = structuredClone(LADDER);
  broken[1].supply = 100;
  assert.throws(() => assertLadderSane(broken), /limited/);
});

test("the five finisher Marks are given, never sold", () => {
  for (const id of [11, 12, 13, 14, 15]) {
    assert.equal(LADDER[id].route, "finisher");
    assert.equal(LADDER[id].priceUsdc6, 0);
    assert.equal(LADDER[id].needsWhole, true);
  }
  assert.deepEqual([11, 12, 13, 14, 15].map(id => LADDER[id].name),
    ["aorta", "chamber", "valve", "atrium", "apex"]);
  assert.deepEqual([11, 12, 13, 14, 15].map(id => LADDER[id].supply),
    [Infinity, 50, 10, 3, 1]);
});

test("a cap on anything but a finisher Mark is still a startup error", () => {
  const bad = structuredClone(LADDER);
  bad[3] = { ...bad[3], supply: 5 };
  assert.throws(() => assertLadderSane(bad), /limited/);
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
// The masks as LITERALS. The loop below derives them with the same expression
// ladder.mjs builds them with, so any shared mistake cancels out -- the trap
// Ladder.t.sol documents at test_theExclusionMasksAreTheseExactNumbers and the
// reason that file writes its numbers out too. Bits 11-15 are 0xF800; each Mark
// carries that minus its own bit.
test("each finisher Mark excludes the other four, and these are the numbers", () => {
  assert.deepEqual(FINISHER_IDS.map((id) => LADDER[id].excludes), [
    0xF000,   // 11 aorta   -> 12, 13, 14, 15
    0xE800,   // 12 chamber -> 11, 13, 14, 15
    0xD800,   // 13 valve   -> 11, 12, 14, 15
    0xB800,   // 14 atrium  -> 11, 12, 13, 15
    0x7800,   // 15 apex    -> 11, 12, 13, 14
  ]);
  assert.equal(FINISHER_MASK, 0xF800, "the group is bits 11-15");
  for (const id of FINISHER_IDS) {
    assert.equal(LADDER[id].excludes & (1 << id), 0, `mark ${id} excludes itself`);
  }
});

// ONE DEFINITION of "what an agent may ask for", because three surfaces read it
// -- the `ladder` tool's pairs, the published price table and `upgradeId`'s
// description -- and a fourth hand-rolled filter is how one of them quietly
// starts offering a Mark that cannot be bought.
test("requestable() is exactly the five pairs", () => {
  assert.deepEqual(requestable().map((m) => m.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const m of requestable()) assert.notEqual(m.route, "finisher");
});

test("both sides of pair five wait on an Iris", () => {
  const anIris = (1 << 5) | (1 << 6);
  assert.equal(LADDER[9].requiresAny, anIris, "Tint must need an Iris");
  assert.equal(LADDER[10].requiresAny, anIris, "Aura must need an Iris too");
  for (const m of Object.values(LADDER)) {
    if (m.id !== 9 && m.id !== 10) assert.equal(m.requiresAny, 0, `${m.name} should need nothing`);
  }
});

// A Mark that offers a choice and does not name it used to reach an agent as a
// raw TypeError out of the PAID `upgrade` tool: the payment demand indexes
// VARIANT_NAMES[id][variant] to say WHICH shape or ink is being bought, and the
// most expensive Mark with a choice costs $250.00. A missing name table is a
// wiring error of exactly the same kind as a missing price, so it belongs at
// boot, where it stops the service instead of one agent's purchase.
test("a Mark offering variants it cannot name is a startup error", () => {
  const broken = structuredClone(LADDER);
  broken[1].variants = 2;                 // Hush has one look and no name table
  assert.throws(() => assertLadderSane(broken), /VARIANT_NAMES/);

  const short = structuredClone(LADDER);
  short[5].variants = 4;                  // the Iris names three shapes, not four
  assert.throws(() => assertLadderSane(short), /VARIANT_NAMES/);
});

// The control: the real ladder satisfies the obligation, so `upgrade` may index
// the table without a guard.
test("every Mark with a choice names exactly as many options as it offers", () => {
  for (const m of Object.values(LADDER)) {
    if (m.variants > 1) assert.equal(VARIANT_NAMES[m.id].length, m.variants, `mark ${m.id}`);
    else assert.equal(VARIANT_NAMES[m.id], undefined, `mark ${m.id} names variants it does not offer`);
  }
});

// ---------------------------------------------------------------------------
// The catalogue still hashes to what the CONTRACT pins -- test gap 46 / 5.I1
// ---------------------------------------------------------------------------

// THE GUARD EXISTED AND THE WARDEN SUITE COULD NOT REACH IT.
// tools/test/ladder-fixture.test.mjs runs this comparison, but it lives in the
// `tools` package -- so a warden-only checkout, or anyone running just
// `cd warden && npm test`, could move the catalogue and see four green suites.
//
// The direction matters. Ladder.t.sol asserts keccak256(abi.encode(Ladder.all()))
// against a literal pasted in from the generator, so changing the SOLIDITY
// ladder fails correctly. Changing the JAVASCRIPT catalogue fails NOTHING:
// Ladder.all() still hashes to the pasted constant and nothing re-runs the
// generator. Proven 2026-09-02 -- setting LADDER[3].minLevel from 30 to 10 left
// all four suites green while the Warden would sell Static to a level-10 token,
// take $5.00, queue the order, and watch the chain revert MarkGate at 00:05.
//
// Skips rather than fails when the Solidity file is absent, so a partial
// checkout produces a skip and not a red suite: a guard that fails for the
// wrong reason gets deleted, and then it guards nothing.
const LADDER_TEST = fileURLToPath(new URL("../../contracts/test/Ladder.t.sol", import.meta.url));

let ladderSource = null;
try {
  ladderSource = readFileSync(LADDER_TEST, "utf8");
} catch {
  ladderSource = null;
}

test(
  "the Warden catalogue still hashes to what Ladder.t.sol pins",
  { skip: ladderSource ? false : "contracts/test/Ladder.t.sol is not in this checkout" },
  async () => {
    const { ladderHash } = await import("../../tools/ladder-fixture.mjs");

    // The only 64-digit hex literal in that file, asserted to be the only one:
    // a second would make this pick whichever came first and pass for the
    // wrong reason.
    const pinned = ladderSource.match(/0x[0-9a-fA-F]{64}/g);
    assert.equal(
      pinned?.length,
      1,
      "expected exactly one 32-byte literal in Ladder.t.sol -- this test can no longer tell which is the ladder hash",
    );
    assert.equal(
      ladderHash(),
      pinned[0].toLowerCase(),
      "the Warden's catalogue moved -- re-run `node tools/ladder-fixture.mjs`, paste the result into "
        + "contracts/test/Ladder.t.sol, and check the two ladders really do agree",
    );
  },
);
