// Renders one token with each Mark applied on its own, so the ladder can be
// eyeballed side by side.
//   npm run marks-preview          -- token 1
//   npm run marks-preview -- 42    -- token 42
//
// ONE STATE, chosen so most surfaces are visible at once: level 200 leaves
// unearned frame cells, and the streak sits on a middle rung so the tier
// colour is not the darkest. A whole heart would leave no dim cells at all.
//
// (This comment described Vein and Crown, two of the SEVEN Marks retired on
// 2026-09-02 when the ten-Mark ladder replaced them. Corrected 2026-09-19.)
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { unpackModules } from "./qart.mjs";
import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, MARKS, AORTA } from "./render-token.mjs";

const DOMAIN = process.env.MRO_DOMAIN ?? "example.com";
const PX = 560;
const OUT = "out/marks";
const id = Number(process.argv[2]) || 1;

// lastDay === today, so nothing has lapsed and the tier colour is the one the
// streak earns. A lapsed token pales, which would confuse a colour comparison.
const BASE = { level: 200, streak: 45, years: 0, lastDay: 20700, today: 20700 };

mkdirSync(OUT, { recursive: true });

// The SHIPPED bitmap, not a fresh solve with different luck -- the same rule
// preview.mjs follows. Reviewing a code the token would not carry is reviewing
// a placeholder.
const bitmap = tokenBitmap(DOMAIN, id);
const modules = unpackModules(Uint8Array.from(Buffer.from(bitmap.hex, "hex")), SIZE);
const { want } = heartTarget(SIZE);

// MARK IDS, NOT NAMES. `render-token.mjs` documents `state.marks` as "an array
// of Mark ids (1..10), not names", and this passed the names -- so every
// variant rendered the bare token, every row reported `+0 B`, and the tool
// that exists to show what a Mark looks like drew no Mark at all. MARKS is
// indexed bottom-up, so a name's id is its index plus one.
const ids = MARKS.map((_, i) => i + 1);
const variants = [
  ["base", []],
  ...MARKS.map((name, i) => [name, [i + 1]]),
  // Every Mark at once. NO TOKEN CAN LEGALLY WEAR THIS -- the ladder is five
  // exclusive pairs, and the five finisher Marks are one place each -- and it
  // is here as an upper bound on the drawing, not as a state to review.
  // `GasBudget.t.sol` holds the maximal LEGAL set.
  ["all-illegal", ids],
];

// A FINISHER MARK DRAWS NOTHING WITHOUT AN ORDINAL. The five write the
// finisher's number in their own ink, and `DigitBand.path` returns "" when the
// ordinal is 0 -- so without this every finisher row would render the bare
// token and report `+0 B`, which is exactly the bug the comment above records
// this tool already having had once.
const ordinalFor = marks => marks.some(id => id >= AORTA) ? 42 : 0;

const rows = [];
for (const [tag, marks] of variants) {
  const svg = renderSvg(modules, want, SIZE, { ...BASE, marks, ordinal: ordinalFor(marks) });
  writeFileSync(`${OUT}/${tag}.png`,
    new Resvg(svg, { fitTo: { mode: "width", value: PX } }).render().asPng());
  writeFileSync(`${OUT}/${tag}.svg`, svg);
  rows.push({ tag, bytes: svg.length });
}

// The byte cost of each Mark, measured rather than quoted. Singularity's zero
// is the point of the exercise: it draws nothing.
const base = rows.find(r => r.tag === "base").bytes;
console.log(`token ${id} on ${DOMAIN}: mask ${bitmap.mask}, heart ${(bitmap.match * 100).toFixed(1)}%`);
for (const r of rows) {
  const delta = r.tag === "base" ? "" : `  ${r.bytes - base >= 0 ? "+" : ""}${r.bytes - base} B`;
  console.log(`  ${r.tag.padEnd(12)} ${String(r.bytes).padStart(6)} B${delta}`);
}
