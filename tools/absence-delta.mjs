// How different do the absence steps actually LOOK?
//
// The hashes differ, which is what absence-check.mjs measures, and the operator's eye says
// the tiles are the same picture. Both can be true: a changed byte is not a
// changed image. This measures the SEEN difference -- how many pixels move, and
// by how much -- so the question is settled by a number rather than by whose
// monitor it is.
//
//   node tools/absence-delta.mjs
import { Resvg } from "@resvg/resvg-js";
import { renderSvg } from "./render-token.mjs";
import { CODE, TARGET } from "./sheet-code.mjs";

const PX = 560;
const TODAY = 20702;
const NEVER = { level: 1, streak: 1, years: 0, marks: [] };

const pixels = (gap) => {
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { ...NEVER, lastDay: TODAY - gap, today: TODAY });
  return new Resvg(svg, { fitTo: { mode: "width", value: PX } }).render().pixels;
};

// WCAG relative luminance, the same measure the ink decisions use.
const lum = (r, g, b) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [a, b].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const base = pixels(0);
console.log("gap   pixels changed   max channel delta   mean delta over changed px");
for (const gap of [29, 30, 364, 365, 365 * 3]) {
  const other = pixels(gap);
  let changed = 0, maxDelta = 0, sum = 0;
  for (let i = 0; i < base.length; i += 4) {
    const d = Math.max(
      Math.abs(base[i] - other[i]),
      Math.abs(base[i + 1] - other[i + 1]),
      Math.abs(base[i + 2] - other[i + 2])
    );
    if (d > 0) { changed += 1; sum += d; maxDelta = Math.max(maxDelta, d); }
  }
  const total = base.length / 4;
  const pct = ((changed / total) * 100).toFixed(1);
  const mean = changed ? (sum / changed).toFixed(1) : "0";
  console.log(`${String(gap).padStart(4)}  ${pct.padStart(13)}%  ${String(maxDelta).padStart(17)}  ${mean.padStart(25)}`);
}

// The three colours the rule moves between, against the page.
console.log("");
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
for (const [name, h] of [["ghost   #f4eef0", "#f4eef0"], ["half    #faf7f8", "#faf7f8"], ["page    #ffffff", "#ffffff"]]) {
  const l = lum(...hex(h));
  console.log(`${name}  luminance ${l.toFixed(4)}  contrast against the page ${contrast(l, lum(255, 255, 255)).toFixed(3)}:1`);
}
console.log("");
console.log("A contrast under about 1.1:1 is at or below the threshold most eyes");
console.log("resolve on a screen, so a step between two such colours is a step");
console.log("between two things already indistinguishable from the page.");
