// Read a stored token bitmap as a phone would, before the Clock writes it on
// chain for ever. Lengths are all the contract checks; this checks the
// destination. The packing is tools/qart.mjs's: row-major, high bit first.
import { QRCodeReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType } from "@zxing/library";

/// Version 10's side, in modules: tools/qart.mjs VERSION_SIZE.
export const QR_SIZE = 57;
const QUIET = 4;
const SCALE = 4;
const HINTS = new Map([[DecodeHintType.PURE_BARCODE, true]]);

/// The text a packed bitmap (hex, no 0x) decodes to, or null.
export function decodeBitmap(hex, size = QR_SIZE) {
  const bytes = Buffer.from(hex ?? "", "hex");
  if (bytes.length !== Math.ceil((size * size) / 8)) return null;
  const side = (size + 2 * QUIET) * SCALE;
  const lum = new Uint8ClampedArray(side * side).fill(255);
  for (let i = 0; i < size * size; i++) {
    if (!((bytes[i >> 3] >> (7 - (i & 7))) & 1)) continue;
    const x0 = (QUIET + (i % size)) * SCALE;
    const y0 = (QUIET + Math.floor(i / size)) * SCALE;
    for (let y = y0; y < y0 + SCALE; y++) lum.fill(0, y * side + x0, y * side + x0 + SCALE);
  }
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, side, side)));
    return new QRCodeReader().decode(bitmap, HINTS).getText();
  } catch {
    return null;
  }
}

/**
 * Does this bitmap send a scanner to token `tokenId` on `domain`, and nowhere
 * else? Returns null when it does, or why not.
 */
export function qrProblem(hex, { domain, tokenId }) {
  const text = decodeBitmap(hex);
  if (text === null) return "its artwork does not decode as a QR code";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "its artwork decodes to something that is not a URL";
  }
  if (url.href !== text || [...text].some((c) => c < " " || c > "~")) return "its artwork decodes to a URL a browser would rewrite";
  const want = `https://${domain}/t/${tokenId}`;
  return `${url.origin}${url.pathname}` === want ? null : `its artwork points at ${url.origin}${url.pathname}, not ${want}`;
}
