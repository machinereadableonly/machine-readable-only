// C2.8: the heart that will actually mint, looked at rather than assumed.
//
// Every Mark sheet this project has judged was drawn on a bitmap solved against
// `example.com`, which was never going to be the domain. The real payload is
// twelve characters longer, and the QArt budget it eats comes straight out of
// the heart: measured 2026-09-03, the match falls about 2.13 points. That
// measurement said the CODE stayed robust. It said nothing about whether the
// heart still reads as a heart, because nobody had looked at one.
//
// So this solves a run of ids against the real domain and reports two things
// per id: the overall match, and the CLEFT -- the notch between the two lobes,
// which is the feature that separates a heart from a blob and the first thing
// a shrinking budget fills in. A heart whose cleft is gone is a lump with a
// point on it, at every size, on every token, permanently.
//
//   ~/scripts/safe-build.sh node tools/domain-heart-sheet.mjs --ids 1-24
//   ~/scripts/safe-build.sh node tools/domain-heart-sheet.mjs --stage sheet
//
// Stage `solve` appends one row per id to out/domain-heart/rows.jsonl and
// writes one PNG each; stage `sheet` composes them. They are separate because
// resvg's buffers are native and only a process exit returns them -- the
// 2026-08-28 incident was exactly this shape of job run in one process. The
// runner batches ids across child processes for the same reason, and the JSONL
// is append-only so a batch that dies costs only its own ids.
import { writeFileSync, appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";

import { payloadFor } from "./qart.mjs";
import { robustSolve } from "./robust-solve.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg } from "./render-token.mjs";

// The domain is a parameter and not a constant, because the only way to read
// the real number is against the CONTROL: `example.com` is the heart every Mark
// sheet in this project was judged on, so "the cleft is 42% open" is a fact
// about nothing until the same measurement has been taken there.
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : []))
);
const DOMAIN = args.domain ?? "machinereadableonly.com";
const OUT = new URL(`./out/domain-heart/${DOMAIN}/`, import.meta.url).pathname;
const ROWS = `${OUT}rows.jsonl`;
/// Six per child. One solve is about 4.4 seconds and holds a handful of raster
/// buffers; six is comfortably inside the wrapper's cap and keeps a died batch
/// cheap to redo.
const BATCH = 6;

/**
 * The cells that make the cleft, taken from the target rather than guessed.
 *
 * A cleft cell is a target-OFF cell with target-ON cells somewhere to its left
 * AND somewhere to its right in the same row, in the top 40% of the grid. That
 * is exactly the notch between the lobes and nothing else: below the lobes the
 * heart is solid, so no row down there has an OFF cell fenced in on both sides.
 *
 * Deriving it from the target matters. A hardcoded rectangle would keep
 * reporting the same cells if the mask ever changes shape, and the whole point
 * of this measurement is to survive a change to HeartMask.
 */
export function cleftCells(target, size) {
  const at = (x, y) => target[y * size + x];
  const cells = [];
  for (let y = 0; y < Math.floor(size * 0.4); y += 1) {
    let left = -1;
    for (let x = 0; x < size; x += 1) if (at(x, y)) { left = x; break; }
    let right = -1;
    for (let x = size - 1; x >= 0; x -= 1) if (at(x, y)) { right = x; break; }
    if (left < 0 || right <= left) continue;
    for (let x = left + 1; x < right; x += 1) if (!at(x, y)) cells.push([x, y]);
  }
  return cells;
}

/// How much of the cleft survived: the share of cleft cells the solve left OFF,
/// which is what keeps the notch visible. 1 is a perfect notch, 0 is filled in.
export function cleftScore(modules, target, size) {
  const cells = cleftCells(target, size);
  if (cells.length === 0) return { cells: 0, kept: 0, score: 1 };
  const kept = cells.filter(([x, y]) => !modules[y * size + x]).length;
  return { cells: cells.length, kept, score: kept / cells.length };
}

/// The whole-heart state: 365 days, a run long enough for the deepest colour,
/// no Marks. The state every sheet in this project judges a silhouette in.
const WHOLE = { level: 365, streak: 365, years: 1, today: 365, lastDay: 365 };

function solveOne(tokenId) {
  const payload = payloadFor(DOMAIN, tokenId);
  const best = robustSolve(payload);
  // heartTarget answers `{ want, order }`; `want` is the Uint8Array grid. The
  // first draft of this file indexed the OBJECT, which is always undefined, so
  // it found zero cleft cells and reported a perfect notch on every token.
  const { want } = heartTarget(best.size);
  const cleft = cleftScore(best.modules, want, best.size);

  const svg = renderSvg(best.modules, want, best.size, WHOLE);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 420 } }).render().asPng();
  writeFileSync(`${OUT}id-${String(tokenId).padStart(2, "0")}.png`, png);

  return {
    tokenId, domain: DOMAIN, payload, payloadChars: payload.length,
    mask: best.mask, rejected: best.gate.rejected,
    match: Number((best.match * 100).toFixed(2)),
    cleftCells: cleft.cells, cleftKept: cleft.kept,
    cleft: Number((cleft.score * 100).toFixed(1)),
  };
}

/// Parse `1-24` or `1,5,9` into a list of ids.
function parseIds(spec) {
  if (spec.includes("-")) {
    const [a, b] = spec.split("-").map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return spec.split(",").map(Number);
}

mkdirSync(OUT, { recursive: true });

if (args.stage === "batch") {
  // One child process per batch. `execFileSync` inherits stdio so a failure is
  // visible rather than swallowed, and a non-zero exit stops the run instead of
  // quietly producing a short sheet.
  const ids = parseIds(args.ids ?? "1-24");
  if (existsSync(ROWS)) writeFileSync(ROWS, "");
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    console.log(`solving ${slice[0]}-${slice[slice.length - 1]}`);
    execFileSync(process.execPath,
      [new URL(import.meta.url).pathname, "--stage", "solve", "--domain", DOMAIN, "--ids", slice.join(",")],
      { stdio: "inherit" });
  }
} else if (args.stage === "sheet") {
  const rows = readFileSync(ROWS, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .sort((a, b) => a.tokenId - b.tokenId);

  const COLS = 6, CELL = 420, LABEL = 46, PAD = 10;
  const rowsN = Math.ceil(rows.length / COLS);
  const w = COLS * (CELL + PAD) + PAD;
  const h = rowsN * (CELL + LABEL + PAD) + PAD + 40;

  const tiles = rows.map((r, i) => {
    const x = PAD + (i % COLS) * (CELL + PAD);
    const y = 40 + PAD + Math.floor(i / COLS) * (CELL + LABEL + PAD);
    const png = readFileSync(`${OUT}id-${String(r.tokenId).padStart(2, "0")}.png`).toString("base64");
    return `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" href="data:image/png;base64,${png}"/>
      <text x="${x}" y="${y + CELL + 18}" font-family="monospace" font-size="15">id ${r.tokenId} -- mask ${r.mask} -- match ${r.match}%</text>
      <text x="${x}" y="${y + CELL + 36}" font-family="monospace" font-size="15" fill="${r.cleft < 60 ? "#b00020" : "#333"}">cleft ${r.cleft}% (${r.cleftKept}/${r.cleftCells}) -- rejected ${r.rejected}</text>`;
  }).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#ffffff"/>
    <text x="${PAD}" y="26" font-family="monospace" font-size="19">${DOMAIN} -- ids ${rows[0].tokenId}-${rows[rows.length - 1].tokenId}, whole heart. Cleft is the share of the notch between the lobes still OPEN.</text>
    ${tiles}</svg>`;

  writeFileSync(`${OUT}contact-sheet.png`,
    new Resvg(svg, { fitTo: { mode: "width", value: Math.min(w, 2600) } }).render().asPng());

  const matches = rows.map((r) => r.match), clefts = rows.map((r) => r.cleft);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(`ids            ${rows.length}`);
  console.log(`match          min ${Math.min(...matches)}  mean ${mean(matches).toFixed(2)}  max ${Math.max(...matches)}`);
  console.log(`cleft open     min ${Math.min(...clefts)}%  mean ${mean(clefts).toFixed(1)}%  max ${Math.max(...clefts)}%`);
  console.log(`cleft lost     ${clefts.filter((c) => c < 60).length} of ${rows.length} below 60%`);
  console.log(`gate rejects   ${rows.filter((r) => r.rejected > 0).length} of ${rows.length} needed a fallback mask`);
  console.log(`sheet          ${OUT}contact-sheet.png`);
} else {
  for (const id of parseIds(args.ids ?? "1")) {
    const row = solveOne(id);
    appendFileSync(ROWS, `${JSON.stringify(row)}\n`);
    console.log(`id ${row.tokenId}: mask ${row.mask}, match ${row.match}%, cleft ${row.cleft}%, rejected ${row.rejected}`);
  }
}
