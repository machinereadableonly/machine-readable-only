// Strict decode tests.
//
// Why this file exists: every earlier decode test used jsqr as its only oracle.
// jsqr stops reading a byte segment when it meets bytes that are not valid text,
// and returns the clean prefix. Our QArt free bytes ARE arbitrary binary, so jsqr
// reported the bare URL and every test passed while the code actually carried the
// URL plus ~77 bytes of garbage. A phone decoded that, saw something that is not
// a URL, and offered no link -- the code "did not work" while the suite was green.
//
// ZXing is the reference implementation a phone's scanner descends from. It
// returns the WHOLE payload, so it is the oracle that can see this class of bug.
import test from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { QRCodeReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource,
         DecodeHintType } from "@zxing/library";
import { bestOfAllMasks, payloadFor } from "../qart.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const HINTS = new Map([[DecodeHintType.TRY_HARDER, true]]);

// Render modules to pixels the way the token image does: quiet zone, crisp edges.
function render(modules, size, scale = 8) {
  const Q = 4, N = size + 2 * Q, px = N * scale;
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (modules[y * size + x]) d += `M${x + Q} ${y + Q}h1v1h-1z`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" `
    + `width="${px}" height="${px}" shape-rendering="crispEdges">`
    + `<rect width="${N}" height="${N}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  return { pixels: new Uint8ClampedArray(img.pixels), w: img.width, h: img.height };
}

// ZXing reads the complete payload, binary bytes included.
function decodeStrict({ pixels, w, h }) {
  const lum = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
  try { return new QRCodeReader().decode(bitmap, HINTS).getText(); } catch { return null; }
}
const decodeLenient = ({ pixels, w, h }) => { const r = jsQR(pixels, w, h); return r ? r.data : null; };

test("a phone-grade decoder reads a URL that goes to the right place", () => {
  // The free bytes are meant to be in the string -- they are the fragment. What
  // matters is that the whole thing still parses as a URL and the destination,
  // everything before the "#", is untouched. A fragment is never sent to the
  // server, so the junk costs the visitor nothing.
  const best = bestOfAllMasks(PAYLOAD);
  const text = decodeStrict(render(best.modules, best.size));
  assert.notEqual(text, null, "ZXing could not decode the code at all");
  assert.ok(text.startsWith(PAYLOAD), `decoded ${JSON.stringify(text.slice(0, 40))}`);
  const url = new URL(text);
  assert.equal(`${url.origin}${url.pathname}`, PAYLOAD.slice(0, -1));
  assert.equal(url.href, text, "a browser would rewrite this URL rather than take it as-is");
});

test("every free byte is a character that survives a URL fragment", () => {
  const best = bestOfAllMasks(PAYLOAD);
  const text = decodeStrict(render(best.modules, best.size));
  assert.notEqual(text, null, "ZXing could not decode the code at all");
  const bad = [...text].filter(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e);
  assert.equal(bad.length, 0,
    `${bad.length} non-printable characters in the payload; a scanner will not offer a link`);
});

test("the lenient and the strict decoder agree on what the code says", () => {
  // The whole reason this bug survived: they disagreed and only the lenient one
  // was ever asked. Any future divergence is a bug, not a curiosity.
  const best = bestOfAllMasks(PAYLOAD);
  const img = render(best.modules, best.size);
  assert.equal(decodeLenient(img), decodeStrict(img));
});
