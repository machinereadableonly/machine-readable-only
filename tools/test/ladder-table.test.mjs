// The published prices ARE the ladder's prices, or the suite fails.
//
// llms.txt names what all ten Marks cost (added 2026-09-19, the operator's
// call on an outside-in probe finding: an agent could not see a $1,250 ceiling
// until after it had been admitted and could call `ladder`). Ten prices in
// prose beside ten prices in code is how a document goes quietly wrong, and
// this project has watched exactly that happen to an address, a gas figure, a
// suite count and a combination count.
//
// So nothing is transcribed. `tools/ladder-table.mjs` BUILDS the block from
// `warden/src/mcp/ladder.mjs`, and this asserts the served file contains it
// verbatim. Change a price in the ladder and this goes red until llms.txt is
// regenerated -- the same mirror-by-test that Ladder.sol and ladder.mjs use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ladderTable } from "../ladder-table.mjs";
import { FINISHER_IDS, LADDER } from "../../warden/src/mcp/ladder.mjs";

const llms = readFileSync(new URL("../../warden/public/llms.txt", import.meta.url), "utf8");

test("llms.txt publishes the ladder exactly as the ladder defines it", () => {
  assert.ok(
    llms.includes(ladderTable()),
    "llms.txt no longer contains the generated table -- run `node tools/ladder-table.mjs` and paste it in"
  );
});

test("every Mark's price appears in the published document", () => {
  // The belt to the table's braces: if the block above were ever reformatted
  // by hand, this still catches a price that is not on the page at all.
  // The BOUGHT Marks only. An earned Mark has no price, and neither does one
  // given for a place, which is why this asks for the route rather than for
  // "not earned".
  for (const id of Object.keys(LADDER)) {
    const m = LADDER[id];
    if (m.route !== "bought") continue;
    assert.ok(llms.includes(m.price), `${m.name} costs ${m.price} and llms.txt does not say so`);
  }
});

// THE FIVE GIVEN FOR FINISHING ARE PUBLISHED TOO, and they are published the
// way they work. An agent deciding whether to come back every day for a year
// should be able to read what finishing is worth before it is admitted -- the
// same reason the prices are on the page -- and the band and its size are the
// whole of that. Generated, because a cap typed into prose is a cap that
// drifts from Ladder.sol.
test("the five Marks given for finishing are published with their band and its size", () => {
  const table = ladderTable();
  for (const id of FINISHER_IDS) {
    const m = LADDER[id];
    const row = table.split("\n").find((line) => line.trim().startsWith(`${id} `));
    assert.ok(row, `the table does not carry a row for ${m.name}`);
    assert.match(row, new RegExp(`\\b${m.name}\\b`), `row ${id} does not name ${m.name}`);
    assert.ok(row.includes(m.places), `row ${id} does not say which places wear it`);
    assert.ok(
      row.includes(m.supply === Infinity ? "no limit" : String(m.supply)),
      `row ${id} does not say how large the band is`
    );
  }
});

// AND THEY CARRY NO PRICE ANYWHERE. This is the one way the block could start
// selling something the chain gives away: a money string on a finisher row
// would read as a Mark with a cost, and `upgrade` refuses all five at any
// price. The pairs' own price column is asserted above, so this looks only at
// the rows this block added.
test("no Mark given for finishing carries a price", () => {
  const rows = ladderTable().split("\n").filter((line) => /^\s+1[1-5]\s/.test(line));
  assert.equal(rows.length, FINISHER_IDS.length, "the finisher block lost a row");
  for (const row of rows) {
    assert.doesNotMatch(row, /\$|free/, `a Mark that is given is quoted a price: ${row.trim()}`);
  }
});

test("the document no longer claims the tool is the ONLY place a price is given", () => {
  // It said "that field is the only place you are told the cost while you can
  // still decline to pay it". That was true until the table above existed,
  // and publishing prices without fixing the sentence would have made the
  // page contradict itself on the same screen.
  assert.ok(
    !llms.includes("the only place\nyou are told the cost"),
    "llms.txt still carries the pre-2026-09-19 'only place' claim"
  );
});
