// What a slip looks like: the token that came back, beside the tokens that did not.
//
// This sheet exists to settle ONE decision (creative review C2.2, quality
// review 1.H1): as built, a token that misses a single day and returns renders
// PALER than a token that has been gone for a month. Both reviews found it
// independently, from opposite directions, and it is a contract change, so it
// is permanent from the mainnet deploy.
//
// The proposal is not a new colour. It is the SAME lapse ladder applied a
// second time, to the run that fell, from the day it fell:
//
//     rung = max(lapsedRung(streak, lastDay, today),
//                lapsedRung(fellFrom, fellDay, today))
//
// so nothing here needs a decode sweep beyond the existing suite -- every tile
// below is one of the five inks already shipped. The decode column proves it
// rather than asserting it.
//
// render-token.mjs is NOT modified: it is the reference the Solidity Renderer
// is diffed against byte for byte, and nothing here has been agreed. The
// proposal is prototyped by choosing the rung the proposed rule would choose
// and rendering the state that already produces it.
//
// CAVEAT, stated because the project's own rule says a sheet is only worth the
// fidelity of what is on it: this is the `example.com` heart, not the
// `machinereadableonly.com` one that will actually mint (creative C2.8). That
// matters for judging the HEART, and not for this question -- the bitmap is
// identical in every tile here, and the only thing under review is which of
// five already-shipped inks the heart is drawn in.
//
//   ~/scripts/safe-build.sh node tools/slip-sheet.mjs
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, lapsedRung, rungOf, colourAt, TIERS } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const DOMAIN = "example.com";
const PAYLOAD = payloadFor(DOMAIN, 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const OUT = new URL("./out/slip", import.meta.url).pathname;

const TILE = 460;
const SIZES = [256, 500, 848];   // enough to prove the ink decodes; the full
                                 // sweep lives in the suite and is unchanged.

// The day the unbroken 100-day run last checked in. Same epoch the other
// sheets use, so a tile from here can be laid beside one from there.
const D = 20700;
const RUN = 100;

/**
 * The five scenarios, each as the state the CHAIN would actually hold.
 *
 * `fellFrom` / `fellDay` are the two proposed fields. They are zero for a token
 * that has never slipped, which is what a freshly minted token holds and what
 * every already-minted token would hold forever -- the reason the change
 * cannot be made after the deploy.
 */
const CASES = [
  {
    key: "unbroken",
    title: "Unbroken",
    caption: `Checked in every day. Run of ${RUN}.`,
    streak: RUN, lastDay: D, today: D, fellFrom: 0, fellDay: 0,
  },
  {
    key: "returned-day-0",
    title: "Missed ONE day, came back",
    caption: "Today is the day it returned. This is the token the piece is about.",
    streak: 1, lastDay: D + 2, today: D + 2, fellFrom: RUN, fellDay: D,
  },
  {
    key: "returned-day-5",
    title: "Missed one day, back 5 days",
    caption: "Returned and has checked in every day since. New run of 6.",
    streak: 6, lastDay: D + 7, today: D + 7, fellFrom: RUN, fellDay: D,
  },
  {
    key: "absent-6",
    title: "Gone 6 days",
    caption: "Has not come back at all.",
    streak: RUN, lastDay: D, today: D + 6, fellFrom: 0, fellDay: 0,
  },
  {
    key: "absent-29",
    title: "Gone 29 days",
    caption: "Has not come back at all.",
    streak: RUN, lastDay: D, today: D + 29, fellFrom: 0, fellDay: 0,
  },
];

/// What ships today.
const builtRung = c => lapsedRung(c.streak, c.lastDay, c.today);

/// What C2.2 proposes: the same ladder, applied a second time to the run that
/// fell. A token that never fell carries zeros, and lapsedRung of a zero run
/// from day zero is rung 0, so the max() leaves it exactly as it is.
const proposedRung = c =>
  Math.max(builtRung(c), lapsedRung(c.fellFrom, c.fellDay, c.today));

/**
 * A third reading, not in either review, added because rendering C2.2 showed
 * a cost neither report names: on the day of the return it puts the slipped
 * token at the SAME rung as one that never slipped, so the slip is invisible
 * for three days. The locked copy says the opposite -- "Miss a day and the run
 * restarts at one: the cells you earned stay, the colour goes" -- and that
 * sentence survived nine drafts and 24 cold reads.
 *
 * So: remember the fall the way C2.2 does, but never let the memory of it be
 * worth as much as the run that is still standing. One rung below the run that
 * fell, decaying from there on the same ladder. The slip costs something the
 * day it happens, and it still costs less than walking away.
 */
const cappedRung = c => Math.max(
  builtRung(c),
  Math.min(lapsedRung(c.fellFrom, c.fellDay, c.today),
           c.fellFrom ? rungOf(c.fellFrom) - 1 : 0));

/**
 * Render a token AT a chosen rung.
 *
 * The proposal changes which rung is selected and nothing else, so a faithful
 * prototype is the state that already yields that rung: a live run whose tier
 * floor is the rung's own. Both the heart ink and the noise ink come from the
 * rung, exactly as they do on chain, so the tile is a real token image and not
 * a recolouring.
 */
function drawAtRung(rung) {
  const streak = TIERS[TIERS.length - 1 - rung].min;
  if (rungOf(streak) !== rung) throw new Error(`rung ${rung} is not reachable from streak ${streak}`);
  return renderSvg(CODE.modules, TARGET.want, CODE.size, {
    level: 200, streak, years: 0, marks: [], lastDay: D, today: D,
  });
}

/// Render, reading `.pixels` exactly once -- it is a copying getter.
const pixels = (svg, px) => {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  return { px: r.pixels, w: r.width, h: r.height };
};

function tilePng(svg, px) {
  const a = pixels(svg, px);
  const png = new PNG({ width: px, height: a.h });
  for (let i = 0; i < a.w * a.h * 4; i += 4) {
    png.data[i] = a.px[i]; png.data[i + 1] = a.px[i + 1];
    png.data[i + 2] = a.px[i + 2]; png.data[i + 3] = 255;
  }
  return png;
}

/**
 * Compose the tiles into one grid image.
 *
 * The HTML sheet is the readable artefact, but it embeds its tiles as data
 * URIs and therefore needs a browser. A single PNG opens in anything, which is
 * how these get looked at in practice.
 *
 * Rows are separated by a rule rather than a caption: the point of the image is
 * the left-to-right comparison within a row, and a legend belongs in the HTML
 * beside it.
 */
function grid(tiles, cols, cell, pad = 14, rule = 3) {
  const rowsN = Math.ceil(tiles.length / cols);
  const W = cols * cell + (cols + 1) * pad;
  const H = rowsN * cell + (rowsN + 1) * pad + (rowsN - 1) * rule;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H * 4; i += 4) {
    out.data[i] = 250; out.data[i + 1] = 249; out.data[i + 2] = 248; out.data[i + 3] = 255;
  }
  const rowTop = r => pad + r * (cell + pad) + r * rule;
  tiles.forEach((t, i) => {
    const r = (i / cols) | 0, c = i % cols;
    const ox = pad + c * (cell + pad);
    const oy = rowTop(r);
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const s = (y * t.width + x) * 4, d = ((oy + y) * W + ox + x) * 4;
        out.data[d] = t.data[s]; out.data[d + 1] = t.data[s + 1];
        out.data[d + 2] = t.data[s + 2]; out.data[d + 3] = 255;
      }
    }
  });
  // A rule under every row but the last, so the reading order is unambiguous.
  for (let r = 0; r < rowsN - 1; r++) {
    const ry = rowTop(r) + cell + (pad >> 1);
    for (let y = ry; y < ry + rule; y++)
      for (let x = 0; x < W; x++) {
        const d = (y * W + x) * 4;
        out.data[d] = 34; out.data[d + 1] = 29; out.data[d + 2] = 31;
      }
  }
  return out;
}

const uri = png => "data:image/png;base64," + PNG.sync.write(png).toString("base64");
const decodes = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
}).length;

// ---------------------------------------------------------------------------

const rows = [
  { label: "As built", rungFn: builtRung },
  { label: "C2.2 as written", rungFn: proposedRung },
  { label: "C2.2 capped one rung", rungFn: cappedRung },
];

const cells = {};
for (const row of rows) {
  for (const c of CASES) {
    const rung = row.rungFn(c);
    const svg = drawAtRung(rung);
    const png = tilePng(svg, TILE);
    cells[`${row.label}|${c.key}`] = {
      rung,
      colour: colourAt(rung),
      raw: png,
      png: uri(png),
      decoded: decodes(svg),
    };
  }
}

// The finding, restated as an assertion so this sheet cannot quietly stop
// making its point if the palette moves.
const built = k => cells[`As built|${k}`].rung;
if (!(built("returned-day-0") < built("absent-6") && built("returned-day-0") < built("absent-29"))) {
  throw new Error("the defect this sheet exists to show is not present in the current palette");
}

const th = s => `<th>${s}</th>`;
const head = `<tr><th></th>${CASES.map(c =>
  th(`${c.title}<div class="sub">${c.caption}</div>`)).join("")}</tr>`;

const body = rows.map(row => `<tr><th class="row">${row.label}</th>${CASES.map(c => {
  const cell = cells[`${row.label}|${c.key}`];
  const changed = row.label !== "As built"
    && cell.rung !== cells[`As built|${c.key}`].rung;
  return `<td class="${changed ? "changed" : ""}">
    <img src="${cell.png}" alt="${c.title}, ${row.label}">
    <div class="meta">rung ${cell.rung} &middot; <code>${cell.colour}</code>
      <span class="dec">${cell.decoded}/${SIZES.length} decode</span></div>
  </td>`;
}).join("")}</tr>`).join("");

const html = `<!doctype html><meta charset="utf-8">
<title>What a slip looks like</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:32px;background:#faf9f8;color:#221d1f}
 h1{font-size:20px;margin:0 0 4px}
 p.lede{margin:0 0 24px;max-width:80ch;color:#4a4247}
 table{border-collapse:collapse}
 th,td{padding:10px;vertical-align:top;text-align:left}
 th{font-weight:600;font-size:13px;max-width:22ch}
 th.row{writing-mode:horizontal-tb;white-space:nowrap;vertical-align:middle;font-size:15px}
 .sub{font-weight:400;color:#6b6167;font-size:12px;margin-top:3px}
 img{width:${TILE / 2}px;height:auto;display:block;border:1px solid #e3dedf}
 .meta{font-size:12px;color:#6b6167;margin-top:6px}
 .dec{display:block;color:#8a8085}
 td.changed{background:#fffbe8;outline:2px solid #e8d48a}
 code{font:12px ui-monospace,monospace}
</style>
<h1>What a slip looks like</h1>
<p class="lede">One token, a hundred-day run, five futures. Read the top row
left to right: <strong>the token that missed one day and came back is paler
than the tokens that never came back at all.</strong> That is creative finding
C2.2 and quality finding 1.H1, which are the same stored field. The bottom row
is the proposal: the same lapse ladder applied a second time to the run that
fell. Highlighted cells are the ones that change; the two absent tokens are
untouched. Every tile is the <code>example.com</code> heart and one of the five
inks already shipped.</p>
<table>${head}${body}</table>`;

writeFileSync(`${OUT}.html`, html);
writeFileSync(`${OUT}.png`, PNG.sync.write(grid(
  rows.flatMap(row => CASES.map(c => cells[`${row.label}|${c.key}`].raw)),
  CASES.length, TILE)));
console.log(`wrote ${OUT}.html and ${OUT}.png`);
for (const row of rows) {
  console.log(`${row.label.padEnd(16)} ${CASES.map(c =>
    `${c.key}=rung ${cells[`${row.label}|${c.key}`].rung}`).join("  ")}`);
}
