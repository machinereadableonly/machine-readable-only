// Task 10c Phase 2: put the token in front of a rasteriser we do not own.
//
// Every decode before this one was ours end to end -- our SVG, our resvg, our
// ZXing. This drives Alchemy's NFT API instead: it ingests the tokenURI, caches
// the SVG on its own CDN, and serves flattened PNGs at widths IT chooses. We
// decode THEIR bytes.
//
// THE CONTROL IS THE POINT. For every width, the same token is also rendered by
// our own pipeline and decoded the same way. Without that column a failure is
// unattributable -- "the artwork is fragile" and "their resize blurred it" look
// identical from one number. This is the same reasoning as tile 1 of the scan
// sheet and the plain-QR row of sweep C: never run a decode sweep without a
// control.
//
//   node tools/third-party-check.mjs <contract> [--ids 1,3,12] [--domain example.com]
//
// Run it through ~/scripts/safe-build.sh and in small batches of ids: this
// rasterises at up to 1600px, which is the shape of sweep that took the box down
// on 2026-08-28.
import { mkdirSync, writeFileSync } from "node:fs";

import { createPublicClient, http, parseAbi } from "viem";

import { loadEnv, nftApiBase, getNftMetadata, imageUrls, fetchImagePixels, redact } from "./alchemy-nft.mjs";
import { decodeTokenUri } from "./verify-tokenuri.mjs";
import { svgToRgba } from "./svg-to-png.mjs";
import { scanPixels } from "./test/helpers/decode.mjs";

const ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);

/// The widths a third party actually picks. 256 is Alchemy's own thumbnail;
/// 1080 is the size OpenSea displays an item at. None is a whole multiple of any
/// canvas this piece can produce, which is exactly why they are here.
export const WIDTHS = [256, 400, 500, 700, 850, 1000, 1080, 1600];

/**
 * How many distinct grey levels an image holds.
 *
 * The artwork is duotone on white: a crisp rasterisation of it has a handful of
 * levels. Measured 2026-08-29, Alchemy's resizes come back with about 170, which
 * is smoothing -- the CDN rasterises the SVG small and then interpolates it up,
 * and interpolation is what softens a module edge until a binarizer loses it.
 * One cheap number that tells a blurred image from a fragile one.
 */
export function greyLevels(img) {
  const seen = new Set();
  for (let i = 0; i < img.pixels.length; i += 4) seen.add(img.pixels[i]);
  return seen.size;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Ask for a token's metadata and wait until the CDN copy actually exists.
 *
 * A cold token comes back with cachedUrl set to the raw data URI and every
 * other image field null; refreshCache starts the ingest but does not wait for
 * it. Reading once and reporting "no image" would be wrong -- the same trap as
 * reading a tokenURI straight after a write during Task 10b, which returned
 * pre-sunset state for a full minute.
 */
export async function metadataWithImage({ base, contract, tokenId, tries = 10, waitMs = 3000 }) {
  let m = await getNftMetadata({ base, contract, tokenId, refreshCache: true });
  for (let i = 1; i < tries && !m.image?.thumbnailUrl; i++) {
    await sleep(waitMs);
    m = await getNftMetadata({ base, contract, tokenId });
  }
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const contract = args[0];
  if (!contract?.startsWith("0x")) {
    console.error("usage: node tools/third-party-check.mjs <contract> [--ids 1,3] [--domain d]");
    process.exit(1);
  }
  const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
  const ids = arg("--ids", "1,2,3").split(",").map(Number);
  const domain = arg("--domain", "example.com");

  const env = loadEnv();
  const rpcUrl = env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
  const base = nftApiBase(rpcUrl);
  const client = createPublicClient({ transport: http(rpcUrl) });

  mkdirSync("out/third-party", { recursive: true });
  let failures = 0;

  for (const id of ids) {
    const m = await metadataWithImage({ base, contract, tokenId: id });
    const expected = `https://${domain}/t/${id}`;

    // Our own copy of the same token, straight off the chain, so every "theirs"
    // number has an "ours" beside it at the identical width.
    const uri = await client.readContract({ address: contract, abi: ABI, functionName: "tokenURI", args: [BigInt(id)] });
    const { svg } = decodeTokenUri(uri);

    if (!m.image?.thumbnailUrl) {
      console.log(`token ${id}: NO CDN COPY after polling -- ${m.raw?.error ?? "no error reported"}`);
      failures++;
      continue;
    }

    console.log(`\ntoken ${id}  (their svg ${m.image.size} B, ${m.image.contentType})`);
    console.log(`  width   theirs            ours              verdict`);

    const named = imageUrls(m.image, WIDTHS);
    for (const { label, url } of named) {
      if (url.startsWith("data:")) continue;

      const img = await fetchImagePixels(url);
      const width = Number(label.replace("w_", "")) || null;

      if (!img.ok) {
        console.log(`  ${label.padEnd(12)} ${img.why}`);
        continue;
      }

      const theirs = scanPixels(img);
      const theirsOk = theirs.ok && theirs.destination === expected;

      // The control, at the size THEY produced, so the comparison is honest even
      // for thumbnail and convert-png where we did not pick the number.
      // svgToRgba names its buffer `data`; the decode oracle wants `pixels`.
      const raw = svgToRgba(svg, img.width);
      const ourImg = { pixels: raw.data, width: raw.width, height: raw.height };
      const ours = scanPixels(ourImg);
      const oursOk = ours.ok && ours.destination === expected;

      if (!theirsOk) {
        failures++;
        const path = `out/third-party/token-${id}-${label}.png`;
        writeFileSync(path, img.bytes);
        console.log(`  ${label.padEnd(12)} ${(img.width + "px").padEnd(8)} FAIL greys ${String(greyLevels(img)).padStart(3)}  ` +
          `ours ${oursOk ? "OK" : "FAIL"} greys ${String(greyLevels(ourImg)).padStart(3)}  ` +
          `<- ${theirs.ok ? `wrong destination ${theirs.destination}` : theirs.why}, saved ${path}`);
      } else {
        console.log(`  ${label.padEnd(12)} ${(img.width + "px").padEnd(8)} OK   greys ${String(greyLevels(img)).padStart(3)}  ` +
          `ours ${oursOk ? "OK" : "FAIL"} greys ${String(greyLevels(ourImg)).padStart(3)}`);
      }
    }
  }

  console.log(`\n${failures === 0 ? "OK: every third-party render decoded to its own url"
                                  : `FAIL: ${failures} third-party renders did not`}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1]?.endsWith("third-party-check.mjs")) await main();
