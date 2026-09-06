// C4.10, take three: can the PAGE carry absence?
//
// Neither of the first two mechanisms works. Fading the unearned year toward
// the page is invisible (absence-delta.mjs: 17 of 255 on a colour already at
// 1.145:1). Darkening it is visible but collapses the earned/unearned reading
// on a token that had a run (absence-candidates.mjs, half-earned-sheet).
//
// The reason is structural: a token that never returned has ONE lit cell out of
// 365, so any rule that works on what it earned has nothing to work with. The
// page is the only surface that covers a token holding almost no ink.
//
// The page is also the light side of the code AND the quiet zone, so this is
// the one candidate that can actually break scanning. Every tile goes through
// the five-size gate and the sheet says so.
//
//   node tools/absence-page.mjs
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { renderSvg, FIELD } from "./render-token.mjs";
import { CODE, TARGET } from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const OUT = "out/absence-page";
const PX = 460;
const TODAY = 20702;
const SIZES = [256, 500, 848, 1080, 1600];

mkdirSync(OUT, { recursive: true });

const NEVER = { level: 1, streak: 1, years: 0, marks: [] };
const HALF = { level: 180, streak: 1, years: 0, marks: [] };

const base = (state) => {
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { ...state, lastDay: TODAY, today: TODAY });
  if (svg.split(FIELD).length - 1 !== 1) {
    throw new Error(`expected exactly one ${FIELD} to substitute, found ${svg.split(FIELD).length - 1}`);
  }
  return svg;
};

// Cool greys rather than tints: the page going COLD is the reading, and a
// coloured page would collide with Aura, which already owns a tinted field.
const pages = [
  ["control-live", FIELD, "a live token, on white"],
  ["p1-breath", "#f6f6f6", "a breath of grey"],
  ["p2-cool", "#efefef", "cool"],
  ["p3-cold", "#e6e6e6", "cold"],
  ["p4-stone", "#dcdcdc", "stone"],
];

function sheet(state, title, file) {
  const live = base(state);
  const rows = pages.map(([tag, colour, note]) => {
    const svg = live.split(FIELD).join(colour);
    const png = new Resvg(svg, { fitTo: { mode: "width", value: PX } }).render().asPng();
    const fails = SIZES.filter((px) => !scanResult(svg, px).ok);
    return { tag, colour, note, png, fails };
  });

  const CELL = 460, PAD = 12, HEAD = 46, LABEL = 60;
  const w = rows.length * (CELL + PAD) + PAD;
  const h = CELL + LABEL + PAD * 2 + HEAD;
  // A NEUTRAL SHEET GROUND, not white: a white sheet behind a white page hides
  // exactly the edge being judged.
  const tiles = rows.map((r, i) => {
    const x = PAD + i * (CELL + PAD), y = HEAD + PAD;
    return `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" href="data:image/png;base64,${r.png.toString("base64")}"/>
      <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="none" stroke="#bbb" stroke-width="1"/>
      <text x="${x}" y="${y + CELL + 20}" font-family="monospace" font-size="16" fill="#111">${r.tag}  ${r.colour}</text>
      <text x="${x}" y="${y + CELL + 40}" font-family="monospace" font-size="14" fill="#444">${r.note}</text>
      <text x="${x}" y="${y + CELL + 58}" font-family="monospace" font-size="13" fill="${r.fails.length ? "#b00020" : "#175"}">${r.fails.length ? `FAILS DECODE at ${r.fails.join(", ")}px` : "decodes at all five sizes"}</text>`;
  }).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#cfcfcf"/>
    <text x="${PAD}" y="30" font-family="monospace" font-size="19" fill="#111">${title}</text>
    ${tiles}</svg>`;
  writeFileSync(`${OUT}/${file}`,
    new Resvg(svg, { fitTo: { mode: "width", value: Math.min(w, 2600) } }).render().asPng());
  for (const r of rows) {
    console.log(`${file.padEnd(22)} ${r.tag.padEnd(13)} ${r.colour}  ${r.fails.length ? "DECODE FAILS " + r.fails.join(",") : "decodes"}`);
  }
}

sheet(NEVER, "C4.10 -- the page carries the absence. A token that NEVER returned, a year on. Sheet ground is grey so the page edge is visible.", "never-returned.png");
sheet(HALF, "The same pages on a token that EARNED 180 days and then left. The earned arc must still read.", "half-earned.png");
console.log(`\nSheets tools/${OUT}/never-returned.png and half-earned.png`);
