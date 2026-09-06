// C4.10, take two: what colour can the unearned year END on and be SEEN?
//
// The review said fade the ghost toward the page. Measured (absence-delta.mjs),
// that moves at most 17 of 255 on a colour already at 1.145:1 against the page:
// a step between two things both indistinguishable from white. The diagnosis
// was right and the prescription cannot work, because it fades something that
// was already invisible.
//
// So the direction has to reverse: the unearned year DARKENS as the token stays
// away -- dust settling on the part of the picture that was never earned. This
// renders the candidates side by side at the end of the ladder, with a live
// token as the control, because a colour is only judgeable next to what it is
// meant to differ from.
//
//   node tools/absence-candidates.mjs
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { renderSvg, GHOST } from "./render-token.mjs";
import { CODE, TARGET } from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const OUT = "out/absence-candidates";
const PX = 460;
const TODAY = 20702;
const NEVER = { level: 1, streak: 1, years: 0, marks: [] };
const SIZES = [256, 500, 848, 1080, 1600];

mkdirSync(OUT, { recursive: true });

// Rendered at gap 0 so the ghost is the unique string GHOST, then substituted.
// The renderer is not given a debug parameter for a question a sheet can ask.
const live = renderSvg(CODE.modules, TARGET.want, CODE.size,
  { ...NEVER, lastDay: TODAY, today: TODAY });
if (live.split(GHOST).length - 1 !== 1) {
  throw new Error(`expected exactly one ${GHOST} to substitute, found ${live.split(GHOST).length - 1}`);
}

const candidates = [
  ["control-live", GHOST, "a live token, unchanged"],
  ["a-page", "#ffffff", "what is committed now: the page"],
  ["b-faint", "#e7dfe2", "one step darker than the ghost"],
  ["c-soft", "#d5c8cd", "clearly there, still quiet"],
  ["d-dust", "#bfb0b6", "dust settled on the unearned year"],
  ["e-slate", "#a2949a", "unmistakable at a glance"],
];

const rows = [];
for (const [tag, colour, note] of candidates) {
  const svg = live.split(GHOST).join(colour);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: PX } }).render().asPng();
  writeFileSync(`${OUT}/${tag}.png`, png);

  // A frame colour sits outside the quiet zone, so in principle it cannot reach
  // the binarizer. This project has been wrong about "in principle" before.
  const fails = SIZES.filter((px) => !scanResult(svg, px).ok);
  rows.push({ tag, colour, note, fails });
}

const CELL = 460, LABEL = 56, PAD = 12, HEAD = 46;
const w = rows.length * (CELL + PAD) + PAD;
const h = CELL + LABEL + PAD * 2 + HEAD;
const tiles = rows.map((r, i) => {
  const x = PAD + i * (CELL + PAD), y = HEAD + PAD;
  const png = readFileSync(`${OUT}/${r.tag}.png`).toString("base64");
  return `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" href="data:image/png;base64,${png}"/>
    <text x="${x}" y="${y + CELL + 20}" font-family="monospace" font-size="16">${r.tag}  ${r.colour}</text>
    <text x="${x}" y="${y + CELL + 40}" font-family="monospace" font-size="14" fill="#555">${r.note}</text>
    <text x="${x}" y="${y + CELL + 56}" font-family="monospace" font-size="13" fill="${r.fails.length ? "#b00020" : "#2a7"}">${r.fails.length ? `FAILS DECODE at ${r.fails.join(", ")}px` : "decodes at all five sizes"}</text>`;
}).join("\n");

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <text x="${PAD}" y="30" font-family="monospace" font-size="19">C4.10 -- what the unearned year looks like after a year away. Leftmost is a LIVE token for comparison.</text>
  ${tiles}</svg>`;
writeFileSync(`${OUT}/contact-sheet.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: Math.min(w, 2600) } }).render().asPng());

for (const r of rows) console.log(`${r.tag.padEnd(14)} ${r.colour}  ${r.fails.length ? "DECODE FAILS " + r.fails.join(",") : "decodes"}`);
console.log(`\nSheet  tools/${OUT}/contact-sheet.png`);

// THE CASE THAT COULD SINK THE WHOLE IDEA. A token that earned half a year and
// then stopped has 180 LIT cells and 185 unearned ones. Darkening the unearned
// ones moves them TOWARD the lit colour, so an abandoned token could end up
// reading as a fuller frame than a live one -- the opposite of what absence
// should look like. Rendered rather than reasoned about.
const HALF = { level: 180, streak: 1, years: 0, marks: [] };
const halfLive = renderSvg(CODE.modules, TARGET.want, CODE.size,
  { ...HALF, lastDay: TODAY, today: TODAY });
const halfRows = [["control-live", GHOST, "earned 180 days, still checking in"]]
  .concat(candidates.slice(1).map(([tag, colour, ]) => [tag, colour, "earned 180 days, then a year away"]));

const halfTiles = halfRows.map(([tag, colour, note], i) => {
  const svg = halfLive.split(GHOST).join(colour);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: PX } }).render().asPng();
  writeFileSync(`${OUT}/half-${tag}.png`, png);
  const x = PAD + i * (CELL + PAD), y = HEAD + PAD;
  return `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" href="data:image/png;base64,${png.toString("base64")}"/>
    <text x="${x}" y="${y + CELL + 20}" font-family="monospace" font-size="16">${tag}  ${colour}</text>
    <text x="${x}" y="${y + CELL + 40}" font-family="monospace" font-size="14" fill="#555">${note}</text>`;
}).join("\n");

const halfSheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <text x="${PAD}" y="30" font-family="monospace" font-size="19">The case that could sink it: a token that EARNED 180 days and then left. Does the darker unearned year read as fuller?</text>
  ${halfTiles}</svg>`;
writeFileSync(`${OUT}/half-earned-sheet.png`,
  new Resvg(halfSheet, { fitTo: { mode: "width", value: Math.min(w, 2600) } }).render().asPng());
console.log(`Sheet  tools/${OUT}/half-earned-sheet.png`);
