// Prints the constants Renderer.t.sol asserts against: the keccak256 and the
// byte length of the complete tokenURI that tools/render-token.mjs produces for
// each life stage.
//
// Hashes rather than the strings themselves, because one tokenURI is around
// 10,000 bytes and six of them embedded in a test file would be unreadable. The
// byte length is asserted alongside the hash so a failure says whether the two
// renderers disagree on length or only on content.
//
// Re-run and paste back if the image, the attribute list or the encoding ever
// changes -- a difference between the two renderers is what that test exists to
// catch.
//
//   node tools/token-uri-fixture.mjs [tokenId] [domain]
import { keccak256, toBytes } from "viem";
import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartMaskBytes } from "./heart-mask.mjs";
import { unpackModules } from "./qart.mjs";
import { tokenUri, HUSH, BEAT, IRIS_BOUGHT, VESSEL, AURA, TINT } from "./render-token.mjs";

/// The six life stages the differential test covers, plus the Marks case.
export const STAGES = [
  ["day one",          { level: 1,        streak: 1,   lastDay: 1000, today: 1000 }],
  ["day 200",          { level: 200,      streak: 45,  lastDay: 1000, today: 1000,
                         agentKeyId: 0xa9en }],
  ["whole, one ring",  { level: 365,      streak: 140, lastDay: 1000, today: 1000,
                         generation: 1, parent: 7, seedsGiven: 2 }],
  ["whole and lapsed", { level: 365,      streak: 140, lastDay: 1000, today: 1040 }],
  ["ten years, capped",{ level: 365 * 10, streak: 400, lastDay: 1000, today: 1000 }],
  // One Mark per pair -- the legal maximum a real token can hold, since
  // MachineReadableOnly.applyMark excludes pair partners. Hush over Ache and
  // Beat over Static draw the larger amount of image (Hush adds a rect, Beat
  // adds a gradient defs block), which makes this also the byte-worst-case
  // fixture. Iris Bought is included, and it draws, so the
  // fixture reflects a token that took every pair rather than four of five.
  ["every drawn mark", { level: 365 * 10, streak: 400, lastDay: 1000, today: 1000,
                         marks: [HUSH, BEAT, IRIS_BOUGHT, VESSEL, AURA] }],
  ["sealed at rest",   { level: 365 * 3,  streak: 200, lastDay: 1000, today: 9999, resting: true }],
  // The two echo-bearing extremes. Nothing else in either fixture family sets
  // `echo`: the render matrix does not carry the field, and RenderFixture is
  // generated from it, so without these two cases the dashed ring is never
  // compared between the two renderers on a whole tokenURI at all.
  //
  // A newborn child draws the ring at depth 0 on a 53-cell canvas, where it is
  // 717 bytes; a child at the cap draws the same 54 runs at depth 18, where
  // every coordinate is two digits and it is 756. Those are the shortest and
  // longest the ring can be, and THESE PINS MOVE WHENEVER THE RING'S RULE DOES
  // -- this file is the generator for the three child references in
  // contracts/test/Renderer.t.sol, so it has to be re-read when they change,
  // not only re-run.
  ["a newborn child",  { level: 1,        streak: 1,   lastDay: 1000, today: 1000,
                         generation: 1, parent: 7, echo: 365 }],
  ["a child at the cap", { level: 365 * 10, streak: 400, lastDay: 1000, today: 1000,
                         generation: 2, parent: 7, echo: 3650 }],
  // A child wearing the maximal LEGAL Mark set. Fix round 1: without this,
  // TWO of the six _blockOff call sites were never reached with a non-zero
  // echo, because both are Mark-gated -- _eyes returns early with no Iris and
  // _quiet returns "" with no Hush -- and every echo-bearing case above is
  // Mark-free. A regression at either would have shipped green, and a
  // misplaced Hush rect paints a 45-cell cream square over the code and kills
  // the decode.
  //
  // FIVE Marks, which is the legal maximum: the exclusive pairs make six
  // unreachable. Hush over Ache, Beat over Static, the BOUGHT Iris in leaf
  // (shape 2), Vessel, and Tint in gold (ink 1) over Aura. The two non-default
  // variants are deliberate -- they put the shape and ink bits at 16-23 and
  // 24-31 to work rather than reading 0 by default.
  //
  // Level 365 * 5, not the cap, because the cap CANNOT discriminate: with ten
  // or more own years ringBudget caps `own` at nine and rings(3650, 3650)
  // equals rings(3650, 0), so passing 0 for echo yields the same offset. Five
  // years gives 6 rings against 5. Its heart is also WHOLE, so its dim set is
  // empty and the ghost element exists ONLY to carry the echo ring -- which
  // pins the `if (ghostPath)` guard that replaced `if (dim.size)`.
  ["a child with every drawn mark", { level: 365 * 5, streak: 400, lastDay: 1000,
                         today: 1000, generation: 2, parent: 7, echo: 1825,
                         marks: [HUSH, BEAT, IRIS_BOUGHT, VESSEL, TINT],
                         irisVariant: 2, tintVariant: 1 }],
];

export function uriFixtures(domain, tokenId) {
  const bitmap = tokenBitmap(domain, tokenId);
  const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
  const want = unpackModules(heartMaskBytes(), SIZE);
  return STAGES.map(([label, state]) => {
    const uri = tokenUri(modules, want, SIZE, { tokenId, mintDay: 900, ...state });
    return { label, state, uri, bytes: uri.length, hash: keccak256(toBytes(uri)) };
  });
}

if (process.argv[1] && process.argv[1].endsWith("token-uri-fixture.mjs")) {
  const [tokenId = "1", domain = "example.com"] = process.argv.slice(2);
  const rows = uriFixtures(domain, Number(tokenId));
  console.log(`// token ${tokenId} on ${domain}`);
  for (const r of rows) {
    console.log(`// ${r.label}: ${r.bytes} bytes`);
    console.log(`//   ${r.hash}`);
  }
}
