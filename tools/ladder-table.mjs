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
  // -- and a Mark that is given for finishing has no price to publish. What the
  // finisher Marks are belongs in the page's prose, not in a table of costs.
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
  ].join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("ladder-table.mjs")) {
  console.log(ladderTable());
}
