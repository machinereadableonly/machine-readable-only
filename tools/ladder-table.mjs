// The Mark ladder as a table for the published documents.
//
// GENERATED FROM `warden/src/mcp/ladder.mjs`, never typed by hand. llms.txt
// publishes what every Mark costs so an agent -- or the person funding it --
// can see the size of the commitment BEFORE it enters, rather than after it
// has been admitted and can call `ladder`. Ten prices living in prose beside
// ten prices living in code is exactly how a document goes quietly wrong, so
// nothing is transcribed: this builds the block, and
// `tools/test/ladder-table.test.mjs` asserts the served file contains it
// verbatim. Change a price in ladder.mjs and the test fails until llms.txt is
// regenerated.
//
// TWO BLOCKS, because the two kinds of Mark answer different questions. The
// first is a price list: what a Mark costs before you enter. The second is the
// five given for finishing, which cost nothing and cannot be asked for, so a
// price column would be an empty cell against exactly the rows where money is
// not the point. Their bands and their sizes are generated for the same reason
// the prices are: a cap typed into prose is a cap that drifts from the chain.
//
//   node tools/ladder-table.mjs          # print it
import { LADDER, requestable } from "../warden/src/mcp/ladder.mjs";

/// What a side is waiting for, in the words llms.txt already uses.
function gateOf(m) {
  if (m.needsWhole) return "a whole heart, 365 days";
  if (m.minStreak) return `a run of ${m.minStreak} days`;
  if (m.minLevel) return `level ${m.minLevel}`;
  return "nothing";
}

export function ladderTable() {
  const rows = [];
  // THE REQUESTABLE MARKS ONLY. This block is a price list -- the reason it
  // exists is that an agent could not see a $1,250 ceiling before being admitted
  // -- and a Mark that is given for finishing has no price to publish, so it
  // gets a block of its own below rather than an empty cell here.
  for (const m of requestable(LADDER).sort((a, b) => a.id - b.id)) {
    const price = m.route === "earned" ? "free" : m.price;
    const shapes = m.variants > 1 ? `, ${m.variants} shapes` : "";
    rows.push(
      `   ${String(m.pair).padEnd(4)} ${String(m.id).padEnd(3)} ${m.name.padEnd(7)} ` +
        `${m.route.padEnd(7)} ${price.padEnd(9)} ${gateOf(m)}${shapes}`
    );
  }
  return [
    "   pair id  name    route   price     waiting on",
    "   ---- --- ------- ------- --------- ----------",
    ...rows,
    "",
    ...finisherTable(),
  ].join("\n");
}

/// The five given for finishing, best place first.
///
/// DESCENDING ID, matching the `ladder` tool and the contract's own table
/// (MachineReadableOnly.finisherMark), which runs 1st, 2nd-4th, 5th-14th and
/// on. Read in id order the block would open on "everyone else".
///
/// `how many` is the band's size, taken from the catalogue rather than counted
/// off the band's words, so a cap that moves in Ladder.sol moves here. Aorta's
/// band has no end, which is stated rather than left blank.
function finisherTable() {
  const marks = Object.values(LADDER)
    .filter((m) => m.route === "finisher")
    .sort((a, b) => b.id - a.id);
  const given = (m) => `finishing ${m.places}`;
  const nameWidth = Math.max(...marks.map((m) => m.name.length), "name".length);
  const givenWidth = Math.max(...marks.map((m) => given(m).length), "given for".length);
  return [
    `   id  ${"name".padEnd(nameWidth)} ${"given for".padEnd(givenWidth)} how many`,
    `   --- ${"-".repeat(nameWidth)} ${"-".repeat(givenWidth)} --------`,
    ...marks.map(
      (m) =>
        `   ${String(m.id).padEnd(3)} ${m.name.padEnd(nameWidth)} ${given(m).padEnd(givenWidth)} ` +
        `${m.supply === Infinity ? "no limit" : m.supply}`
    ),
  ];
}

if (process.argv[1] && process.argv[1].endsWith("ladder-table.mjs")) {
  console.log(ladderTable());
}
