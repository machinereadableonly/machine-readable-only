import test from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { solve, payloadFor } from "../qart.mjs";
import { heartTarget } from "../heart-target.mjs";
import { renderSvg, canvasFor, tierColour, TIERS, NOISE } from "../render-token.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const CODE = solve(PAYLOAD, 0);
const TARGET = heartTarget(CODE.size);

const render = state => renderSvg(CODE.modules, TARGET.want, CODE.size, state);
function decode(svg, px = 700) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  const got = jsQR(new Uint8ClampedArray(img.pixels), img.width, img.height);
  return got ? got.data : null;
}
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
  ]) assert.equal(decode(render(state)), PAYLOAD, `failed at ${JSON.stringify(state)}`);
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
  assert.equal(tierColour(0), "#6f6f6f");
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
    assert.equal(decode(svg), PAYLOAD, `mark ${mark} broke the scan`);
  }
});
