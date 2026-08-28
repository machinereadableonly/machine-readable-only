// The shared decode oracle for every test that claims a code "scans".
//
// Use decodeStrict by default. jsqr, the lenient reader, stops at the first byte
// that is not valid text and returns the clean prefix -- which once let a code
// carrying 77 bytes of binary junk pass as a tidy URL through the whole suite,
// while real phones scanned it and offered no link at all. ZXing is the library a
// phone's scanner descends from and returns the WHOLE payload, junk included.
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { QRCodeReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource,
         DecodeHintType } from "@zxing/library";

const HINTS = new Map([[DecodeHintType.TRY_HARDER, true]]);
export const QUIET = 4;

// Render bare modules the way the token image does: quiet zone, crisp edges.
export function renderModules(modules, size, px = 700, ink = "#111") {
  const dim = size + 2 * QUIET;
  let d = "";
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (modules[j * size + i]) d += `M${QUIET + i} ${QUIET + j}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" `
    + `shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/>`
    + `<path fill="${ink}" d="${d}"/></svg>`;
}

function rasterise(svg, px) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  return { pixels: new Uint8ClampedArray(img.pixels), w: img.width, h: img.height };
}

export function decodeStrict(svg, px = 700) {
  const { pixels, w, h } = rasterise(svg, px);
  const lum = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
  try { return new QRCodeReader().decode(bitmap, HINTS).getText(); } catch { return null; }
}

export function decodeLenient(svg, px = 700) {
  const { pixels, w, h } = rasterise(svg, px);
  const r = jsQR(pixels, w, h);
  return r ? r.data : null;
}

// What "it scans" actually has to mean: a phone reads a URL, that URL is one a
// browser will take as written, and it goes to the destination we intended. The
// QArt free bytes live in the fragment, so they are expected in the string -- but
// the fragment is never sent to a server, so they cost the visitor nothing.
export function scanResult(svg, px = 700) {
  const text = decodeStrict(svg, px);
  if (text === null) return { ok: false, why: "no decode", text: null };
  if (!text.startsWith("https://")) return { ok: false, why: "not a URL", text };
  let url;
  try { url = new URL(text); } catch { return { ok: false, why: "unparseable URL", text }; }
  if (url.href !== text) return { ok: false, why: "a browser would rewrite it", text };
  const bad = [...text].filter(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e);
  if (bad.length) return { ok: false, why: `${bad.length} unprintable characters`, text };
  return { ok: true, why: null, text, destination: `${url.origin}${url.pathname}` };
}
