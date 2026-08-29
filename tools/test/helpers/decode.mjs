// The shared decode oracle for every test that claims a code "scans".
//
// Use decodeStrict by default. jsqr, the lenient reader, stops at the first byte
// that is not valid text and returns the clean prefix -- which once let a code
// carrying 77 bytes of binary junk pass as a tidy URL through the whole suite,
// while real phones scanned it and offered no link at all. ZXing is the library a
// phone's scanner descends from and returns the WHOLE payload, junk included.
//
// The file is split into three layers on purpose: pixels -> text (decodePixels),
// text -> verdict (judge), and the SVG conveniences that sit on top. Task 10c
// Phase 2 has to put a THIRD PARTY's PNG through the identical checks, and it
// enters at the pixel layer rather than the SVG one. Two definitions of "it
// scans" is the exact failure this project already had once, when jsqr and a
// real phone disagreed -- so a new consumer gets a new entry point, never a new
// copy of the rules.
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
  return { pixels: new Uint8ClampedArray(img.pixels), width: img.width, height: img.height };
}

/**
 * Pixels to text: the only place ZXing is ever called.
 *
 * @param {{pixels: Uint8ClampedArray, width: number, height: number}} img RGBA.
 * @returns {string|null} the whole payload, or null if nothing decoded.
 */
export function decodePixels({ pixels, width, height }) {
  const lum = new Int32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    lum[i] = (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height)));
  try { return new QRCodeReader().decode(bitmap, HINTS).getText(); } catch { return null; }
}

export function decodeStrict(svg, px = 700) {
  return decodePixels(rasterise(svg, px));
}

export function decodeLenient(svg, px = 700) {
  const { pixels, width, height } = rasterise(svg, px);
  const r = jsQR(pixels, width, height);
  return r ? r.data : null;
}

// What "it scans" actually has to mean: a phone reads a URL, that URL is one a
// browser will take as written, and it goes to the destination we intended. The
// QArt free bytes live in the fragment, so they are expected in the string -- but
// the fragment is never sent to a server, so they cost the visitor nothing.
//
// Pure text in, verdict out. Everything that claims a code scans -- our own
// renders and other people's PNGs alike -- comes through here.
export function judge(text) {
  if (text === null) return { ok: false, why: "no decode", text: null };
  if (!text.startsWith("https://")) return { ok: false, why: "not a URL", text };
  let url;
  try { url = new URL(text); } catch { return { ok: false, why: "unparseable URL", text }; }
  if (url.href !== text) return { ok: false, why: "a browser would rewrite it", text };
  const bad = [...text].filter(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e);
  if (bad.length) return { ok: false, why: `${bad.length} unprintable characters`, text };
  return { ok: true, why: null, text, destination: `${url.origin}${url.pathname}` };
}

/** Our own SVG, rasterised by us. */
export function scanResult(svg, px = 700) {
  return judge(decodeStrict(svg, px));
}

/** Somebody else's already-rasterised image. Same rules, different doorway. */
export function scanPixels(img) {
  return judge(decodePixels(img));
}
