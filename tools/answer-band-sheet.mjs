// THE ANSWER BAND, drawn from the shipping geometry, for a person to look at.
//
// Every image the piece had been judged on predates the band. This renders the
// states it is drawn in -- a founding token as each side unlocks, an Aorta
// finisher at the top rung, a child with its echo ring, and token 1 -- through
// render-token.mjs, the reference RenderMatrix.t.sol diffs the Solidity
// renderer against. Each is written at 816 px (the declared size) and 64 px (a
// thumbnail), and each is decoded at 816 px, because a picture that no longer
// scans is a blocker however it looks.
//
//   ~/scripts/safe-build.sh node tools/answer-band-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { renderSvg, finisherMark } from "./render-token.mjs";
import { DEST, CODE, TARGET } from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const OUT = `${process.env.MRO_SHEET_OUT ?? "out"}/answer-band`;
mkdirSync(OUT, { recursive: true });

// A deterministic, roughly even scatter of answers: what a year of real
// answers looks like, rather than the all-ones worst case the gas pin uses.
const words = (() => {
  const w = [0n, 0n];
  for (let i = 0; i < 365; i++) if (((Math.imul(i + 1, 2654435761) >>> 13) & 1) === 1) w[i >> 8] |= 1n << BigInt(i & 255);
  return w;
})();

const DAY = 20700;
const at = (level, streak = level) => ({ level, streak, lastDay: DAY, today: DAY, answers: words });
const AORTA = finisherMark(65);

const STATES = [
  ["founding-122", "a founding token at 122, its first side drawn", at(122)],
  ["founding-244", "at 244, two sides", at(244)],
  ["founding-365", "at 365, finished in 9th place", { ...at(365), ordinal: 9, marks: [finisherMark(9)] }],
  ["aorta-top-rung", "an Aorta finisher at the top rung (65th)", { ...at(365, 365), ordinal: 65, marks: [AORTA] }],
  ["child-365", "a child at 365 with its echo ring, 2nd place", { ...at(365), ordinal: 2, marks: [finisherMark(2)], echo: 365, parent: 7, generation: 1 }],
  ["token-1-365", "token 1 at 365: Aorta's ink, no place", { ...at(365), ordinal: 0, marks: [AORTA] }],
];

let failures = 0;
for (const [name, label, state] of STATES) {
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, state);
  for (const px of [816, 64]) {
    writeFileSync(`${OUT}/${name}-${px}.png`, new Resvg(svg, { fitTo: { mode: "width", value: px } }).render().asPng());
  }
  const r = scanResult(svg, 816);
  const ok = r.ok && r.destination === DEST;
  if (!ok) failures++;
  console.log(`${name.padEnd(16)} ${ok ? "decodes" : `DOES NOT DECODE (${r.why ?? r.destination})`}  ${label}`);
}

console.log(`\nwritten to ${OUT}/ at 816 and 64 px`);
if (failures) {
  console.error(`${failures} state(s) failed to decode at 816 px. That is a blocker, not a note.`);
  process.exit(1);
}
