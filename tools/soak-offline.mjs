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
import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartMaskBytes } from "./heart-mask.mjs";
import { unpackModules } from "./qart.mjs";
import { renderSvg } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";
import { decodeCases, decodeExtremes, DECODE_SIZES } from "./state-matrix.mjs";

const DOMAIN = "example.com";
const ID = 1;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const extremes = process.argv.includes("--extremes");
const from = Number(arg("--from", 0));
const count = Number(arg("--count", 10));

const all = extremes ? decodeExtremes() : decodeCases();
const slice = all.slice(from, from + count);

if (slice.length === 0) process.exit(0);

const bitmap = tokenBitmap(DOMAIN, ID);
const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
const want = unpackModules(heartMaskBytes(), SIZE);
const expected = `https://${DOMAIN}/t/${ID}`;

let failed = 0;

for (const [n, c] of slice.entries()) {
  const years = Math.floor(c.level / 365);
  const svg = renderSvg(modules, want, SIZE, { ...c, years });
  const sizes = extremes ? DECODE_SIZES : [700];

  for (const px of sizes) {
    const scan = scanResult(svg, px);
    const ok = scan.ok && scan.destination === expected;
    const why = !scan.ok ? scan.why : (ok ? "" : `wrong destination ${scan.destination}`);
    if (!ok) failed++;
    console.log(
      `${String(from + n).padStart(3)}  ${String(px).padStart(4)}px  ` +
      `${ok ? "OK  " : "FAIL"}  ${c.label}${why ? "  -- " + why : ""}`
    );
  }
}

process.exit(failed === 0 ? 0 : 1);
