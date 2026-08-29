// The parts of the verifier that do not need a chain.
//
// verifyToken itself is exercised end to end by script/anvil-verify.sh against
// a real anvil, because the whole reason it exists is to cross the RPC boundary
// -- mocking that away here would test nothing worth testing. What IS worth
// pinning without a chain is the string surgery: a tokenURI that a marketplace
// cannot split apart is broken however well it decodes.
import test from "node:test";
import assert from "node:assert/strict";

import { decodeTokenUri, attributesOf } from "../verify-tokenuri.mjs";
import { tokenBitmap, SIZE } from "../token-bitmap.mjs";
import { heartMaskBytes } from "../heart-mask.mjs";
import { unpackModules } from "../qart.mjs";
import { tokenUri } from "../render-token.mjs";
import { scanResult } from "./helpers/decode.mjs";

const DOMAIN = "example.com";
const ID = 4;

function uriFor(state) {
  const bitmap = tokenBitmap(DOMAIN, ID);
  const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
  const want = unpackModules(heartMaskBytes(), SIZE);
  return tokenUri(modules, want, SIZE, { tokenId: ID, mintDay: 900, ...state });
}

const WORST = { level: 364, streak: 400, lastDay: 1000, today: 1000,
                marks: ["vein", "pulse", "voice", "bloom", "halo", "crown"] };

test("a tokenURI splits into parseable JSON and a decodable SVG", () => {
  const { json, svg } = decodeTokenUri(uriFor(WORST));
  assert.equal(json.name, "Machine Readable Only %234");
  assert.ok(svg.startsWith("<svg "), "the image did not base64-decode to an SVG");
  assert.ok(svg.endsWith("</svg>"), "the SVG is truncated");
});

test("the worst-case token still scans, off the decoded SVG", () => {
  // Level 364 is the dearest token to render. It is also the one whose frame
  // is most fragmented, so if any state were going to interfere with the code
  // it would be this one.
  const { svg } = decodeTokenUri(uriFor(WORST));
  const scan = scanResult(svg);
  assert.ok(scan.ok, `did not scan: ${scan.why} (${scan.text})`);
  assert.equal(scan.destination, `https://${DOMAIN}/t/${ID}`);
});

test("the attributes carry the spec's full list", () => {
  const { json } = decodeTokenUri(uriFor(WORST));
  const a = attributesOf(json);
  for (const key of ["Level", "Streak", "Heart", "Years", "Whole", "Mint Day",
                     "Last Day", "Agent Key", "Generation", "Parent", "Children",
                     "Resting", "Sunset", "Marks"]) {
    assert.ok(key in a, `attribute ${key} is missing`);
  }
  assert.equal(a.Heart, "364/365");
  assert.equal(a.Whole, "no");
  assert.equal(a.Level, 364);
});

test("a whole token is named (Whole) and a sealed one (At Rest)", () => {
  const whole = decodeTokenUri(uriFor({ ...WORST, level: 365 })).json;
  assert.equal(whole.name, "Machine Readable Only %234 (Whole)");
  assert.equal(attributesOf(whole).Heart, "365/365");

  const rested = decodeTokenUri(uriFor({ ...WORST, level: 365, resting: true })).json;
  assert.equal(rested.name, "Machine Readable Only %234 (At Rest)");
});

test("decodeTokenUri refuses anything that is not a utf-8 JSON data URI", () => {
  assert.throws(() => decodeTokenUri("data:application/json;base64,e30="), /expected a data:application\/json;utf-8,/);
  assert.throws(() => decodeTokenUri("https://example.com/1.json"), /expected a data:application\/json;utf-8,/);
});

test("decodeTokenUri refuses a JSON payload whose image is not a base64 SVG", () => {
  const uri = "data:application/json;utf-8," + JSON.stringify({ name: "x", image: "https://cdn/x.png" });
  assert.throws(() => decodeTokenUri(uri), /expected a data:image\/svg\+xml;base64,/);
});

test("a raw hash in the JSON would break the parse, which is why none is emitted", () => {
  // Not a test of our output -- a test of the claim. The whole tokenURI is
  // itself a URI, so a raw "#" opens a fragment; this shows what that costs.
  const broken = "data:application/json;utf-8," + '{"name":"MRO #1","image":"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}';
  assert.throws(() => decodeTokenUri(broken.slice(0, broken.indexOf("#"))), SyntaxError);

  const ours = decodeTokenUri(uriFor(WORST));
  assert.ok(!ours.json.name.includes("#"), "a raw hash reached the name");
});
