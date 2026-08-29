// Sweep C of the state soak: render every ink against every ring count, bare
// and fully marked, and put ZXing on each one.
//
// RUN THIS IN BATCHES, THROUGH ~/scripts/safe-build.sh. A sweep of exactly this
// shape -- many renders, each rasterised -- reached 6.28 GB resident on
// 2026-08-28 and took the whole tmux session down with it. Two habits keep it
// safe, and both are deliberate rather than cautious:
//
//   1. One raster size per case by default. The earlier sweep decoded at
//      fourteen, which is where the memory went.
//   2. --from / --count, so a caller can run ten cases per PROCESS. Node will
//      not reliably release resvg's buffers inside one long run; process exit
//      always does.
//
//   node tools/soak-offline.mjs --from 0 --count 10 [--extremes]
//
// --cross runs the state-against-bitmap sweep instead: twelve independent
// QArt solves crossed with five states, each decoded at the four sizes a
// third party picks plus its own exact multiple as a control. Batch it in
// fives, which is one token id per process.
//
//   node tools/soak-offline.mjs --from 0 --count 5 --cross
import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartMaskBytes } from "./heart-mask.mjs";
import { unpackModules } from "./qart.mjs";
import { renderSvg, canvasFor } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";
import { decodeCases, decodeExtremes, crossCases, DECODE_SIZES,
         THIRD_PARTY_SIZES } from "./state-matrix.mjs";

const DOMAIN = "example.com";
const ID = 1;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const extremes = process.argv.includes("--extremes");
const cross = process.argv.includes("--cross");
const from = Number(arg("--from", 0));
const count = Number(arg("--count", 10));

const all = cross ? crossCases() : extremes ? decodeExtremes() : decodeCases();
const slice = all.slice(from, from + count);

if (slice.length === 0) process.exit(0);

const want = unpackModules(heartMaskBytes(), SIZE);

// One QArt solve per token id, reused across that token's states. A solve costs
// about 650ms, and in cross mode the same id recurs once per state.
const solved = new Map();
function modulesFor(id) {
  if (!solved.has(id)) {
    const bitmap = tokenBitmap(DOMAIN, id);
    solved.set(id, unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE));
  }
  return solved.get(id);
}

let failed = 0;

for (const [n, c] of slice.entries()) {
  const id = c.id ?? ID;
  const years = Math.floor(c.level / 365);
  const svg = renderSvg(modulesFor(id), want, SIZE, { ...c, years });
  const expected = `https://${DOMAIN}/t/${id}`;

  // In cross mode each case also gets its OWN exact multiple as a control, so a
  // failure at a third-party size can be told apart from a broken token.
  const exact = canvasFor(years) * 16;
  const sizes = cross ? [...THIRD_PARTY_SIZES, exact]
              : extremes ? DECODE_SIZES
              : [700];

  for (const px of sizes) {
    const scan = scanResult(svg, px);
    const ok = scan.ok && scan.destination === expected;
    const why = !scan.ok ? scan.why : (ok ? "" : `wrong destination ${scan.destination}`);
    if (!ok) failed++;
    const tag = cross && px === exact ? " (exact)" : "";
    console.log(
      `${String(from + n).padStart(3)}  ${String(px).padStart(4)}px  ` +
      `${ok ? "OK  " : "FAIL"}  ${c.label}${tag}${why ? "  -- " + why : ""}`
    );
  }
}

process.exit(failed === 0 ? 0 : 1);
