// Does the bitmap this worker produced actually scan?
//
// ZXing IS THE ORACLE, not jsqr. Measured 2026-08-28 on the same image: jsqr
// stopped at the first non-text byte and reported a clean 24-character URL
// where ZXing returned all 101. A suite that asked jsqr passed 25 tests while
// every tile failed on a real phone. jsqr is kept only to assert the two agree.
//
// NOT named *.test.mjs on purpose: it spawns the worker (a ~10s, ~500MB
// resvg solve) and rasterises the result, so it must never run inside
// `npm test` and must always be run through the memory cap.
//
// Run:  ~/scripts/safe-build.sh node test/bitmap.decode.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renderModules, scanResult } from "../../tools/test/helpers/decode.mjs";
import { payloadFor, unpackModules, VERSION_SIZE } from "../../tools/qart.mjs";

const DOMAIN = "example.com";
const TOKEN_ID = 1;

const out = execFileSync("node", ["--max-old-space-size=768", "src/solve/worker.mjs", DOMAIN, String(TOKEN_ID)], {
  encoding: "utf8",
});
const solved = JSON.parse(out.trim());
assert.equal(solved.ok, true, "the worker must report success on its stdout line");

// The brief's original call here was `scanResult(solved.qr, { domain, tokenId })`,
// which does not match scanResult's real signature -- see
// tools/test/helpers/decode.mjs: `scanResult(svg, px = 700)` takes an SVG
// string and a raster width, not a bitmap and an options object. The worker's
// stdout carries the packed bitmap as unprefixed hex (worker.mjs's own
// comment explains why), so it has to be unpacked into modules and rendered
// to an SVG before a decoder can look at it -- exactly the round trip
// tools/test/token-bitmap.test.mjs already exercises for tokenBitmap().
const modules = unpackModules(Uint8Array.from(Buffer.from(solved.hex, "hex")), VERSION_SIZE);
const scan = scanResult(renderModules(modules, VERSION_SIZE));
assert.equal(scan.ok, true, `the stored bitmap must decode: ${JSON.stringify(scan)}`);
assert.equal(scan.destination, payloadFor(DOMAIN, TOKEN_ID).slice(0, -1),
  "the destination (origin + path, fragment stripped) must be the intended one");

console.log(`bitmap for token ${TOKEN_ID} decodes, mask ${solved.mask}, match ${(solved.match * 100).toFixed(1)}%`);
