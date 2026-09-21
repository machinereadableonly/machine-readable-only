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
import { pathFor, QUIET, GAP } from "./render-token.mjs";
import { THICK } from "./frame-geometry.mjs";

export function codePathFixture(domain, tokenId) {
  const bitmap = tokenBitmap(domain, tokenId);
  const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
  const want = unpackModules(heartMaskBytes(), SIZE);

  const codeOff = GAP + THICK + QUIET;      // an offset to prove it is applied

  // The grid the MODULES are laid on, which is not the canvas.
  //
  // This used to be canvasFor(0) -- 51 cells -- and that was only ever right
  // while a module and a frame cell were the same size and 45 of them fitted
  // inside. At version 10 the code is 57 modules and columns past 51 wrapped
  // onto the next row, where the Set silently swallowed 92 collisions: the
  // fixture reported 2,240 dark modules for a bitmap that holds 2,332.
  // Solidity was right and the reference was wrong, which is the one direction
  // this differential is not built to catch.
  const grid = codeOff + SIZE;

  const heart = new Set(), noise = new Set();
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      if (!modules[j * SIZE + i]) continue;
      const p = (codeOff + j) * grid + (codeOff + i);
      (want[j * SIZE + i] ? heart : noise).add(p);
    }
  }

  // The same heart with no offset at all. CodeRenderer.t.sol asserts this
  // against the offset version to prove the offset is APPLIED rather than
  // baked into the path, and it was the one constant this generator did not
  // print -- so a version raise left the test with three fresh constants and
  // one stale one, which reads as a renderer bug.
  const heartAtZero = new Set();
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      if (modules[j * SIZE + i] && want[j * SIZE + i]) heartAtZero.add(j * grid + i);
    }
  }

  return {
    size: SIZE, grid, codeOff,
    bitmapHex: bitmap.hex,
    heartCells: heart.size, noiseCells: noise.size,
    heartD: pathFor(heart, grid),
    noiseD: pathFor(noise, grid),
    heartDAtZero: pathFor(heartAtZero, grid),
  };
}

if (process.argv[1] && process.argv[1].endsWith("code-path-fixture.mjs")) {
  const [tokenId = "1", domain = "example.com"] = process.argv.slice(2);
  const f = codePathFixture(domain, tokenId);
  const wrap = (s, w = 90) => s.match(new RegExp(`.{1,${w}}`, "g")).map(l => `        "${l}"`).join("\n");
  const wrapHex = s => s.match(/.{1,88}/g).map(l => `        hex"${l}"`).join("\n");
  console.log(`// token ${tokenId} on ${domain}`);
  console.log(`uint256 constant SIZE = ${f.size};`);
  console.log(`uint256 constant CODE_OFF = ${f.codeOff};   // on a ${f.grid}-module grid`);
  console.log(`uint256 constant HEART_CELLS = ${f.heartCells};`);
  console.log(`uint256 constant NOISE_CELLS = ${f.noiseCells};`);
  console.log(`\n_bitmap():\n${wrapHex(f.bitmapHex)};`);
  console.log(`\n_heartD():\n${wrap(f.heartD)};`);
  console.log(`\n_noiseD():\n${wrap(f.noiseD)};`);
  console.log(`\n_heartDAtZero():\n${wrap(f.heartDAtZero)};`);
}
