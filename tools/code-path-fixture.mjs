// Prints the constants CodeRenderer.t.sol asserts against: one token's bitmap
// and the exact path data tools/render-token.mjs draws from it.
//
// The Solidity test embeds these rather than reading a file, because tools/out
// is gitignored and a test that read from there would fail on a clean clone.
// Re-run this and paste the output back into the test if the QArt solver, the
// heart target or the path format ever changes -- a difference between the two
// renderers is exactly what that test exists to catch.
//
//   node tools/code-path-fixture.mjs [tokenId] [domain]
import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartMaskBytes } from "./heart-mask.mjs";
import { unpackModules } from "./qart.mjs";
import { pathFor, canvasFor, QUIET, GAP } from "./render-token.mjs";
import { THICK } from "./frame-geometry.mjs";

export function codePathFixture(domain, tokenId) {
  const bitmap = tokenBitmap(domain, tokenId);
  const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
  const want = unpackModules(heartMaskBytes(), SIZE);

  const canvas = canvasFor(0);              // year zero, the plain case
  const codeOff = GAP + THICK + QUIET;      // where the modules start on it

  const heart = new Set(), noise = new Set();
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      if (!modules[j * SIZE + i]) continue;
      const p = (codeOff + j) * canvas + (codeOff + i);
      (want[j * SIZE + i] ? heart : noise).add(p);
    }
  }

  return {
    size: SIZE, canvas, codeOff,
    bitmapHex: bitmap.hex,
    heartCells: heart.size, noiseCells: noise.size,
    heartD: pathFor(heart, canvas),
    noiseD: pathFor(noise, canvas),
  };
}

if (process.argv[1] && process.argv[1].endsWith("code-path-fixture.mjs")) {
  const [tokenId = "1", domain = "example.com"] = process.argv.slice(2);
  const f = codePathFixture(domain, tokenId);
  const wrap = (s, w = 90) => s.match(new RegExp(`.{1,${w}}`, "g")).map(l => `        "${l}"`).join("\n");
  const wrapHex = s => s.match(/.{1,88}/g).map(l => `        hex"${l}"`).join("\n");
  console.log(`// token ${tokenId} on ${domain}`);
  console.log(`uint256 constant SIZE = ${f.size};`);
  console.log(`uint256 constant CODE_OFF = ${f.codeOff};   // canvas ${f.canvas}, year zero`);
  console.log(`uint256 constant HEART_CELLS = ${f.heartCells};`);
  console.log(`uint256 constant NOISE_CELLS = ${f.noiseCells};`);
  console.log(`\n_bitmap():\n${wrapHex(f.bitmapHex)};`);
  console.log(`\n_heartD():\n${wrap(f.heartD)};`);
  console.log(`\n_noiseD():\n${wrap(f.noiseD)};`);
}
