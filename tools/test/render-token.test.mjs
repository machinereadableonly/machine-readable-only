import test from "node:test";
import assert from "node:assert/strict";
import { solve, payloadFor } from "../qart.mjs";
import { heartTarget } from "../heart-target.mjs";
import { renderSvg, canvasFor, tierColour, TIERS, NOISE } from "../render-token.mjs";
import { scanResult } from "./helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const CODE = solve(PAYLOAD, 0);
const TARGET = heartTarget(CODE.size);

const render = state => renderSvg(CODE.modules, TARGET.want, CODE.size, state);
const DESTINATION = PAYLOAD.slice(0, -1);   // everything before the "#"
// WCAG relative luminance, for the contrast the scanner actually needs.
const expand = h => { const s = h.replace("#", ""); return s.length === 3 ? s.split("").map(c => c + c).join("") : s; };
const lum = h => {
  const s = expand(h);
  const c = [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("every streak tier clears the contrast a scanner needs", () => {
  for (const t of TIERS)
    assert.ok(contrast(t.colour, "#ffffff") >= 4.5,
      `tier ${t.min} (${t.colour}) is ${contrast(t.colour, "#ffffff").toFixed(2)}, under 4.5`);
  assert.ok(contrast(NOISE, "#ffffff") >= 4.5, "noise tone is too light to scan");
});

test("the token scans at every stage of its life", () => {
  for (const state of [
    { level: 0, streak: 0, years: 0 },
    { level: 12, streak: 2, years: 0 },
    { level: 200, streak: 45, years: 0 },
    { level: 365, streak: 140, years: 1 },
    { level: 365, streak: 1, years: 1 },       // whole but lapsed
    { level: 1095, streak: 400, years: 3 },
  ]) {
    const got = scanResult(render(state));
    assert.ok(got.ok, `${JSON.stringify(state)}: ${got.why} -- ${JSON.stringify(got.text)}`);
    assert.equal(got.destination, DESTINATION, `wrong destination at ${JSON.stringify(state)}`);
  }
});

test("the code is always dark ink on a light field, never inverted", () => {
  // A light-on-dark code is not a QR code as the standard defines it, and the
  // decoders that matter treat it that way. Measured 2026-08-28: an inverted
  // render -- light heart on black -- was never even DETECTED by ZXing at any
  // size, while jsqr read it happily, which is exactly the false confidence that
  // let the binary-payload bug survive. Inverted is ruled out, and this test is
  // what stops it coming back in through a Mark or a future palette edit.
  for (const state of [
    { level: 0, streak: 0, years: 0 },
    { level: 200, streak: 45, years: 0 },
    { level: 365, streak: 140, years: 1 },
    { level: 365, streak: 140, years: 1, marks: ["vein"] },
    { level: 365, streak: 140, years: 1, marks: ["halo"] },
    { level: 365, streak: 140, years: 1, marks: ["crown"] },
  ]) {
    const svg = render(state);
    // The field is the first rect: the ground everything else is painted on.
    const field = svg.match(/<rect[^>]*fill="(#[0-9a-fA-F]{3,6})"/)[1];
    const inks = [...svg.matchAll(/<path[^>]*fill="(#[0-9a-fA-F]{3,6})"/g)].map(m => m[1]);
    assert.ok(inks.length > 0, "no ink at all");
    for (const ink of inks) {
      assert.ok(lum(ink) < lum(field),
        `${JSON.stringify(state)}: ink ${ink} is lighter than the field ${field} -- `
        + "that is an inverted code, which standard decoders reject");
    }
  }
});

test("the day-one heart is visible against the noise", () => {
  // The heart and the noise used to be #6f6f6f and #767676: same hue, 1.11:1
  // apart, so a new token showed no heart. Neither a shared hue nor a shared
  // weight is acceptable on its own -- the two inks have to differ somehow.
  const day1 = tierColour(0);
  const sameHue = h => { const e = h.replace("#", "");
    const [r, g, b] = [0, 2, 4].map(i => parseInt(e.substr(i, 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) < 8; };   // near-neutral
  assert.ok(!(sameHue(day1) && sameHue(NOISE)) || contrast(day1, NOISE) >= 2,
    `day-one heart ${day1} and noise ${NOISE} are both neutral and only `
    + `${contrast(day1, NOISE).toFixed(2)}:1 apart -- the heart will not read`);
});

test("the real image scans at every size a viewer might see it", () => {
  // Contrast against white is necessary but NOT sufficient: the noise tone clears
  // WCAG at 4.54 and a scanner's binarizer still has to cope with three inks at
  // once. Only decoding the actual rendered token proves it, and it has to hold
  // across sizes -- a local binarizer behaves differently on a big raster than a
  // small one, so passing at one size says nothing about the others.
  for (const px of [900, 700, 500, 350, 250]) {
    for (const state of [
      { level: 0, streak: 0, years: 0 },          // day one, the palest state
      { level: 200, streak: 45, years: 0 },
      { level: 365, streak: 140, years: 1 },
    ]) {
      const got = scanResult(render(state), px);
      assert.ok(got.ok, `${px}px ${JSON.stringify(state)}: ${got.why}`);
    }
  }
});

test("the image stays inside the spec's size budget", () => {
  for (const years of [0, 1, 3]) {
    const svg = render({ level: 365, streak: 140, years });
    const b64 = Math.ceil(svg.length / 3) * 4;
    const tokenUri = Math.ceil((b64 + 400) / 3) * 4;   // plus the JSON envelope
    assert.ok(tokenUri < 20000, `tokenURI ${tokenUri} exceeds the 20,000 limit at ${years} years`);
  }
});

test("the frame seals only when the heart is whole", () => {
  const open = render({ level: 364, streak: 100, years: 0 });
  const sealed = render({ level: 365, streak: 100, years: 0 });
  assert.notEqual(open, sealed, "day 365 should differ from day 364");
  assert.ok(open.includes("#f4eef0"), "an unfinished year should still show ghost cells");
  assert.ok(!sealed.includes("#f4eef0"), "a whole heart should have no ghost cells left");
});

test("canvas grows one ring per completed year", () => {
  assert.equal(canvasFor(0), 51);
  assert.equal(canvasFor(1), 53);
  assert.equal(canvasFor(3), 57);
});

test("streak tiers map to the right colours", () => {
  assert.equal(tierColour(0), "#70575f");
  assert.equal(tierColour(3), "#8e5566");
  assert.equal(tierColour(7), "#a83a55");
  assert.equal(tierColour(30), "#bd2242");
  assert.equal(tierColour(100), "#c8102e");
  assert.equal(tierColour(9999), "#c8102e");
});

test("marks change the image without breaking the scan", () => {
  const base = render({ level: 200, streak: 45, years: 0 });
  for (const mark of ["vein", "halo", "crown"]) {
    const svg = render({ level: 200, streak: 45, years: 0, marks: [mark] });
    assert.notEqual(svg, base, `mark ${mark} changed nothing`);
    const got = scanResult(svg);
    assert.ok(got.ok, `mark ${mark} broke the scan: ${got.why}`);
    assert.equal(got.destination, DESTINATION, `mark ${mark} changed the destination`);
  }
});
