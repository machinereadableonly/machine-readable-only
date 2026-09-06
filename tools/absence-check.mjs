// C4.10: does a token that never returned really look like one minted
// yesterday?
//
// The finding asserts it. This measures it, because the finding was written
// against commit 11fb40d and Plan 6 rewrote the run and palette logic since --
// the lesson of check-the-finding-before-fixing-it.
//
// It renders three states of the SAME token and diffs them:
//   fresh   -- minted today, checked in today
//   absent  -- minted 364 days ago, never checked in again
//   sealed  -- the same absence, but the operator has sunset the piece
//
// A byte-identical pair is the defect. Run:
//   node tools/absence-check.mjs
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { renderSvg } from "./render-token.mjs";
import { CODE, TARGET } from "./sheet-code.mjs";

const OUT = "out/absence";
const PX = 560;
const TODAY = 20702;          // the day the live contract reports
const YEAR = 365;

mkdirSync(OUT, { recursive: true });

// A token mints with level 1 and streak 1 on its mint day, and a token that
// never comes back keeps exactly that forever: nothing else can change it.
const NEVER_RETURNED = { level: 1, streak: 1, years: 0, marks: [] };

// BOTH SIDES OF EVERY BOUND, because a step rule is only proven by the day
// before it as well as the day of it.
const states = [
  ["gap-000-fresh-mint", { ...NEVER_RETURNED, lastDay: TODAY, today: TODAY }],
  ["gap-029-still-fresh", { ...NEVER_RETURNED, lastDay: TODAY - 29, today: TODAY }],
  ["gap-030-first-fade", { ...NEVER_RETURNED, lastDay: TODAY - 30, today: TODAY }],
  ["gap-364-still-faded", { ...NEVER_RETURNED, lastDay: TODAY - YEAR + 1, today: TODAY }],
  ["gap-365-year-gone", { ...NEVER_RETURNED, lastDay: TODAY - YEAR, today: TODAY }],
  ["gap-3yr-year-gone", { ...NEVER_RETURNED, lastDay: TODAY - YEAR * 3, today: TODAY }],
  // A sealed token's frame is final: it must NOT fade, whatever the gap.
  ["resting-after-3yr", { ...NEVER_RETURNED, lastDay: TODAY - YEAR * 3, today: TODAY, resting: true }],
];

const rendered = [];
for (const [tag, state] of states) {
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, state);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: PX } }).render().asPng();
  writeFileSync(`${OUT}/${tag}.svg`, svg);
  writeFileSync(`${OUT}/${tag}.png`, png);
  rendered.push({
    tag,
    bytes: svg.length,
    svgHash: createHash("sha256").update(svg).digest("hex").slice(0, 16),
    pngHash: createHash("sha256").update(png).digest("hex").slice(0, 16),
  });
}

console.log("state                 bytes  svg sha256[0:16]  png sha256[0:16]");
for (const r of rendered) {
  console.log(`${r.tag.padEnd(20)} ${String(r.bytes).padStart(6)}  ${r.svgHash}  ${r.pngHash}`);
}

const base = rendered[0];
const identical = rendered.slice(1).filter((r) => r.svgHash === base.svgHash);
const expectedSame = new Set(["gap-029-still-fresh", "resting-after-3yr"]);
console.log("");
const wrong = identical.filter((r) => !expectedSame.has(r.tag));
if (wrong.length) {
  console.log(`ABSENCE IS INVISIBLE for: ${wrong.map((r) => r.tag).join(", ")} -- byte-identical to a fresh mint.`);
} else {
  console.log("Absence is visible. The two states that SHOULD match a fresh mint do:");
  console.log(`  ${identical.map((r) => r.tag).join(", ")}`);
}
// ONE SHEET, because these three pictures are only judgeable side by side --
// the question is whether an absent token still reads as an artwork about
// absence rather than as a broken render.
const CELL = 420, LABEL = 40, PAD = 12, HEAD = 44;
const w = rendered.length * (CELL + PAD) + PAD;
const h = CELL + LABEL + PAD * 2 + HEAD;
const tiles = rendered.map((r, i) => {
  const x = PAD + i * (CELL + PAD);
  const y = HEAD + PAD;
  const png = readFileSync(`${OUT}/${r.tag}.png`).toString("base64");
  return `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" href="data:image/png;base64,${png}"/>
    <text x="${x}" y="${y + CELL + 20}" font-family="monospace" font-size="15">${r.tag}</text>
    <text x="${x}" y="${y + CELL + 38}" font-family="monospace" font-size="14" fill="${r.svgHash === base.svgHash ? "#777" : "#b00020"}">${r.svgHash === base.svgHash ? "same as a fresh mint" : "distinct picture"}</text>`;
}).join("\n");
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <text x="${PAD}" y="28" font-family="monospace" font-size="18">C4.10 -- a token that never returned, at every step of the absence rule. Token ${1}, level 1, streak 1, no Marks.</text>
  ${tiles}</svg>`;
writeFileSync(`${OUT}/contact-sheet.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: Math.min(w, 2600) } }).render().asPng());

console.log(`Files in tools/${OUT}/`);
console.log(`Sheet  tools/${OUT}/contact-sheet.png`);
