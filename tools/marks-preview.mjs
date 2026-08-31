// Renders one token with each Mark applied on its own, so the ladder can be
// eyeballed side by side.
//   npm run marks-preview          -- token 1
//   npm run marks-preview -- 42    -- token 42
//
// ONE STATE shows all seven surfaces, which is why there is only one here:
// level 200 leaves unearned frame cells for Vein to colour, and years 1 draws
// the year ring Crown gilds. A whole heart would hide Vein entirely (no dim
// cells remain) and a year-zero token would hide half of Crown.
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { unpackModules } from "./qart.mjs";
import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, MARKS } from "./render-token.mjs";

const DOMAIN = process.env.MRO_DOMAIN ?? "example.com";
const PX = 560;
const OUT = "out/marks";
const id = Number(process.argv[2]) || 1;

// lastDay === today, so nothing has lapsed and the tier colour is the one the
// streak earns. A lapsed token pales, which would confuse a colour comparison.
const BASE = { level: 200, streak: 45, years: 1, lastDay: 20700, today: 20700 };

mkdirSync(OUT, { recursive: true });

// The SHIPPED bitmap, not a fresh solve with different luck -- the same rule
// preview.mjs follows. Reviewing a code the token would not carry is reviewing
// a placeholder.
const bitmap = tokenBitmap(DOMAIN, id);
const modules = unpackModules(Uint8Array.from(Buffer.from(bitmap.hex, "hex")), SIZE);
const { want } = heartTarget(SIZE);

const variants = [
  ["base", []],
  ...MARKS.map(m => [m, [m]]),
  ["all", MARKS],
];

const rows = [];
for (const [tag, marks] of variants) {
  const svg = renderSvg(modules, want, SIZE, { ...BASE, marks });
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
