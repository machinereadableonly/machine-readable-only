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
import { tokenUri } from "./render-token.mjs";

/// The six life stages the differential test covers, plus the Marks case.
export const STAGES = [
  ["day one",          { level: 1,        streak: 1,   lastDay: 1000, today: 1000 }],
  ["day 200",          { level: 200,      streak: 45,  lastDay: 1000, today: 1000,
                         agentKeyId: 0xa9en }],
  ["whole, one ring",  { level: 365,      streak: 140, lastDay: 1000, today: 1000,
                         generation: 1, parent: 7, seedsGiven: 2 }],
  ["whole and lapsed", { level: 365,      streak: 140, lastDay: 1000, today: 1040 }],
  ["ten years, capped",{ level: 365 * 10, streak: 400, lastDay: 1000, today: 1000 }],
  ["every drawn mark", { level: 365 * 10, streak: 400, lastDay: 1000, today: 1000,
                         marks: ["vein", "blueblood", "voice", "bloom", "halo", "crown", "singularity"] }],
  ["sealed at rest",   { level: 365 * 3,  streak: 200, lastDay: 1000, today: 9999, resting: true }],
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
