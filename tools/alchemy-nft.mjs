// Alchemy's NFT API as a third-party consumer of this token.
//
// WHY THIS EXISTS. Every decode this project has ever done ran through our own
// resvg + ZXing pipeline against an SVG we rendered ourselves. Nobody else's
// JSON parser, base64 decoder, SVG rasteriser or image CDN has ever touched the
// artwork. Sweep D found a token that failed only at a raster size we did not
// choose, which is precisely the class of defect an in-house pipeline cannot
// see.
//
// Alchemy is not OpenSea. But the failure mode this piece is exposed to is not
// an OpenSea quirk -- it is "a rasteriser we do not control picks its own pixel
// size", and Alchemy does exactly that: it ingests the tokenURI, flattens the
// SVG to PNG on its own CDN, and serves a 256px thumbnail plus arbitrary
// resizes. It runs on Base Sepolia and it is free, so it answers the same SHAPE
// of question without spending anything.
//
// THE KEY IS NEVER PRINTED. It is read out of contracts/.env, kept in memory,
// and every URL that carries it is redacted before it reaches a log line.
//
// Live-checked 2026-08-29:
//   getNFTMetadata v3, refreshCache param  https://www.alchemy.com/docs/reference/nft-api-endpoints/nft-api-endpoints/nft-metadata-endpoints/get-nft-metadata-v-3
//   30,000-byte tokenURI limit, /convert-png, /w_NNN/scaled/  https://www.alchemy.com/docs/reference/nft-api-faq
//   invalidateContract replaces reingestContract  https://www.alchemy.com/support/how-can-i-update-the-nfts-metadata-using-alchemy-s-nft-api
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", "contracts", ".env");

/**
 * Read contracts/.env into a map.
 *
 * Deliberately hand-rolled rather than pulled from a package: this file is the
 * one place in the tools tree that touches a secret, and a nine-line parser is
 * easier to be sure of than a dependency. Values are returned, never logged.
 */
export function loadEnv(path = ENV_PATH) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Turn an Alchemy RPC URL into its NFT API base.
 *
 * https://base-sepolia.g.alchemy.com/v2/KEY  ->  .../nft/v3/KEY
 * The network subdomain comes from the RPC URL rather than being hardcoded, so
 * pointing this at another chain means changing the env file and nothing else.
 */
export function nftApiBase(rpcUrl) {
  const u = new URL(rpcUrl);
  const m = u.pathname.match(/^\/v2\/(.+)$/);
  if (!m) throw new Error("expected an Alchemy RPC URL of the form /v2/<key>");
  return `${u.origin}/nft/v3/${m[1]}`;
}

/** Strip anything that looks like an API key out of a URL before printing it. */
export function redact(url) {
  return String(url)
    .replace(/\/(v2|nft\/v3)\/[^/?]+/, "/$1/<key>")
    .replace(/([?&]apiKey=)[^&]+/i, "$1<key>");
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${redact(url)}: ${body.slice(0, 300)}`);
  }
  try { return JSON.parse(body); }
  catch { throw new Error(`non-JSON from ${redact(url)}: ${body.slice(0, 300)}`); }
}

/** One token's metadata as Alchemy sees it. */
export async function getNftMetadata({ base, contract, tokenId, refreshCache = false }) {
  const url = `${base}/getNFTMetadata?contractAddress=${contract}`
    + `&tokenId=${tokenId}&refreshCache=${refreshCache}`;
  return getJson(url);
}

/** Force a re-ingest of every token under one contract. */
export async function invalidateContract({ base, contract }) {
  return getJson(`${base}/invalidateContract?contractAddress=${contract}`);
}

/**
 * The image URLs Alchemy offers, derived the way its FAQ documents.
 *
 * The transform is a PATH SEGMENT, not a suffix. Measured 2026-08-29, the real
 * shape is:
 *
 *   https://res.cloudinary.com/alchemyapi/image/upload/<transform>/<network>/<hash>
 *
 * so "replace /thumbnail with /convert-png" in the FAQ means replacing that
 * segment, not appending to the end. Swapping thumbnailv2 for w_NNN/scaled asks
 * the CDN for an arbitrary width. Every one of these is THEIR rasterisation of
 * our SVG, which is the entire point of this module -- we must not render them
 * ourselves.
 */
export function imageUrls(image, widths = [256, 500, 1000, 1080]) {
  const urls = [];
  if (image?.thumbnailUrl) urls.push({ label: "thumbnail", url: image.thumbnailUrl });
  if (image?.pngUrl) urls.push({ label: "convert-png", url: image.pngUrl });

  // Anchor the resizes on whichever transformed URL exists, so a change to one
  // of Alchemy's two shapes does not silently drop the whole resize sweep.
  const anchor = image?.thumbnailUrl ?? image?.pngUrl;
  const m = anchor?.match(/^(.*\/image\/upload)\/[^/]+(?:\/scaled)?\/(.+)$/);
  if (m) {
    const [, prefix, tail] = m;
    for (const w of widths) urls.push({ label: `w_${w}`, url: `${prefix}/w_${w}/scaled/${tail}` });
  }

  if (image?.cachedUrl) urls.push({ label: "cachedUrl", url: image.cachedUrl });
  return urls;
}

/**
 * Fetch an image and decode it as a PNG into RGBA pixels.
 *
 * pngjs is used rather than resvg because the bytes coming back are already
 * raster -- this is THEIR flattening, not ours, and re-rendering it through our
 * own pipeline would quietly put the thing under test back in our own hands.
 * Anything that is not a PNG is reported as such rather than guessed at.
 */
export async function fetchImagePixels(url) {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, why: `${res.status} ${res.statusText}` };

  const contentType = res.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) {
    return { ok: false, why: `not a PNG (${contentType}, ${bytes.length} bytes)`, contentType, bytes };
  }

  const png = PNG.sync.read(bytes);
  return {
    ok: true,
    contentType,
    bytes,
    pixels: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  };
}
