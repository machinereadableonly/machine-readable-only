// The parts of the verifier that do not need a chain.
//
// verifyToken itself is exercised end to end by script/anvil-verify.sh against
// a real anvil, because the whole reason it exists is to cross the RPC boundary
// -- mocking that away here would test nothing worth testing. What IS worth
// pinning without a chain is the string surgery: a tokenURI that a marketplace
// cannot split apart is broken however well it decodes.
import test from "node:test";
import assert from "node:assert/strict";

import { decodeTokenUri, attributesOf, verifyUriString } from "../verify-tokenuri.mjs";
import { tokenBitmap, SIZE } from "../token-bitmap.mjs";
import { heartMaskBytes } from "../heart-mask.mjs";
import { unpackModules } from "../qart.mjs";
import { tokenUri, ACHE, STATIC, HUSH, BEAT, AURA, VESSEL,
         AORTA, CHAMBER, VALVE, ATRIUM, APEX } from "../render-token.mjs";
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
                marks: [ACHE, STATIC, HUSH, BEAT, AURA, VESSEL] };

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
  // `Echo` joined this list on 2026-09-07 with the spec's own attribute list,
  // which had omitted it since Plan 7 added it. A test whose name claims to
  // carry the full list has to actually carry it.
  for (const key of ["Level", "Streak", "Heart", "Years", "Whole", "Mint Day",
                     "Last Day", "Agent Key", "Generation", "Parent", "Children",
                     "Echo", "Resting", "Sunset", "Finisher", "Marks"]) {
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

// 2.M1. The Years ATTRIBUTE is read from the LEVEL, not from the ring. Both
// renderers used to derive it from the ring count, while three comments beside
// them and the Warden's own tokenView described the uncapped reading -- and
// because both renderers agreed, the JS/Solidity differential could not see
// it. `Level` was the only surviving record of a token's age.
//
// Spec 10f then stopped the chain at 365 credited days, so the levels below
// are no longer reachable: this is now a robustness assertion about what the
// renderer does with a level it is HANDED, which is the one thing a swapped
// renderer or a future seeding rule could still change. Its Solidity twin is
// Renderer.t.sol::test_theYearsAttributeIsReadFromTheLevelNotTheRing.
test("the Years attribute is read from the level, not from the ring", () => {
  const eleven = attributesOf(decodeTokenUri(uriFor({
    level: 4_015, streak: 5, lastDay: 20_700, today: 20_700,
  })).json);
  assert.equal(eleven.Years, 11, "a token handed an eleventh year must say so");
  assert.equal(eleven.Level, 4_015);

  // The control, at the level the chain can actually reach: one ring, one
  // year, so this is not an off-by-one dressed as a fix.
  const one = attributesOf(decodeTokenUri(uriFor({
    level: 365, streak: 5, lastDay: 20_700, today: 20_700,
  })).json);
  assert.equal(one.Years, 1);
});

// The finisher's place, and the Mark it earned. Both reach the metadata so an
// agent can read the rank without rasterising the image and decoding a border.
test("the finisher's place and Mark reach the metadata", () => {
  const a = attributesOf(decodeTokenUri(uriFor({
    level: 365, streak: 365, lastDay: 1000, today: 1000,
    marks: [CHAMBER], ordinal: 42,
  })).json);
  assert.equal(a.Finisher, 42);
  assert.deepEqual(a.Marks, ["chamber"]);

  // Emitted ALWAYS, 0 included, so a reader can filter on it rather than
  // special-casing absence -- the same rule `Echo` follows.
  const none = attributesOf(decodeTokenUri(uriFor({
    level: 364, streak: 100, lastDay: 1000, today: 1000,
  })).json);
  assert.equal(none.Finisher, 0);
  assert.deepEqual(none.Marks, []);

  // All five names, lower case, in ladder order after the ten paid Marks.
  for (const [id, name] of [
    [AORTA, "aorta"], [CHAMBER, "chamber"], [VALVE, "valve"],
    [ATRIUM, "atrium"], [APEX, "apex"],
  ]) {
    const one = attributesOf(decodeTokenUri(uriFor({
      level: 365, streak: 365, lastDay: 1000, today: 1000, marks: [VESSEL, id], ordinal: 7,
    })).json);
    assert.deepEqual(one.Marks, ["vessel", name]);
  }
});

// -- the destination check ---------------------------------------------------
//
// `verifyUriString` was imported by NO test until 2026-09-18, and this is the
// check that was wrong: it asked whether the expected URL STARTS WITH the
// decoded destination, so any id whose decimal string is a prefix of the
// claimed id passed. Token 1's bitmap verified as token 12, 123, 1000. The
// post-deploy gate in script/anvil-verify.sh runs ids 1-4, where no single
// digit is a prefix of another, so it never fired -- and a bitmap is permanent
// per token, so the first two-digit token would have carried the wrong URL
// into the artwork forever.
//
// These are slow (a real rasterise and ZXing decode each), which is why there
// are three and not thirty.

/// A real tokenURI whose bitmap encodes `id`, built the way the real one is.
function uriForId(id) {
  const bitmap = tokenBitmap(DOMAIN, id);
  const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
  const want = unpackModules(heartMaskBytes(), SIZE);
  return tokenUri(modules, want, SIZE, { tokenId: id, mintDay: 900, level: 10, lastDay: 1000, today: 1000 });
}

test("a token's own code verifies", () => {
  // The control. A destination check that refused everything would pass the
  // two tests below while breaking the deploy gate entirely.
  const result = verifyUriString({ uri: uriForId(12), id: 12, domain: DOMAIN });
  assert.equal(result.ok, true, result.why ?? "");
  assert.equal(result.destination, `https://${DOMAIN}/t/12`);
});

test("one token's code is refused as another whose id it is a prefix of", () => {
  // THE BUG: `expected.startsWith(destination)` made this pass.
  const result = verifyUriString({ uri: uriForId(1), id: 12, domain: DOMAIN });
  assert.equal(result.ok, false, "token 1's bitmap must not verify as token 12");
  assert.match(result.why, /decoded to https:\/\/example\.com\/t\/1, expected/);
});

test("a wholly unrelated id is refused too", () => {
  // The case that always worked, kept so a fix that only handles prefixes is
  // not mistaken for a fix of the whole check.
  const result = verifyUriString({ uri: uriForId(3), id: 99, domain: DOMAIN });
  assert.equal(result.ok, false);
});
