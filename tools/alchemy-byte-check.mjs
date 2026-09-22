// THE BYTE GATE: does a third party ingest a tokenURI this size at all?
//
// WHY THIS EXISTS. The byte limit was raised from 20,000 to 24,000 on
// 2026-09-22, because QR version 10 measured 18,246 at the byte worst case and
// the finisher's digit band needs another 3,360. The only real external
// ceiling anyone documents is Alchemy's:
//
//   "This can also happen if the content length of the response is larger
//    than 30 000 bytes."   -- https://www.alchemy.com/docs/reference/nft-api-faq
//
// That sentence sits among reasons an HTTP-HOSTED metadata url fails to FETCH.
// This piece's tokenURI is a data URI: nothing is fetched, so whether the cap
// applies to inline metadata has never been measured. Everywhere that number
// is written down says so. This is how it stops being untested.
//
// Alchemy is not OpenSea, and this does not pretend to be an OpenSea check.
// What it is: the only third-party metadata consumer this project has ever had
// working, on the only chain it can be exercised for free.
//
//   node tools/alchemy-byte-check.mjs <contract> <tokenId>
//
// A REFUSAL IS A RESULT, not a crash: an ingest that fails on size is exactly
// the finding this exists to produce, so it is reported and the process exits
// non-zero rather than throwing a stack trace over the answer.
import { loadEnv, nftApiBase, getNftMetadata } from "./alchemy-nft.mjs";

const [contract, tokenId = "1"] = process.argv.slice(2);
if (!/^0x[0-9a-fA-F]{40}$/.test(contract ?? "")) {
  console.error("usage: alchemy-byte-check.mjs <contract> [tokenId]");
  process.exit(2);
}

const env = loadEnv();
// The name the environment file actually uses, taken from erc4906-retest.mjs
// rather than guessed. A guessed name fails as "no url configured", which
// reads as a missing key rather than as a wrong lookup.
const rpc = env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
if (!rpc || !rpc.includes("alchemy")) {
  console.error("FAIL: no Alchemy RPC url in the environment file, so there is no NFT API base to derive.");
  process.exit(1);
}

const base = nftApiBase(rpc);
// refreshCache, so this reads what Alchemy makes of the token NOW rather than
// whatever it cached before the redeploy.
const res = await getNftMetadata({ base, contract, tokenId, refreshCache: true });

console.log(`contract ${contract} token ${tokenId}`);

// The response IS the metadata object -- getJson returns Alchemy's body, not a
// wrapper. The first version of this read res.json and res.httpStatus and
// reported NOT INGESTED against a token Alchemy had ingested perfectly well.
// A probe that reads the wrong field produces a finding that looks exactly
// like the failure it was written to detect.
const meta = res ?? {};
const image = meta.image ?? {};

console.log(`name     ${JSON.stringify(meta.name ?? null)}`);
console.log(`tokenType ${JSON.stringify(meta.tokenType ?? null)}`);
console.log(`image    type=${JSON.stringify(image.contentType ?? null)} size=${image.size ?? "none"}`);
console.log(`         cached=${(image.cachedUrl ?? "none").slice(0, 60)}`);
console.log(`         png=${(image.pngUrl ?? "none").slice(0, 60)}`);
console.log(`updated  ${JSON.stringify(meta.timeLastUpdated ?? null)}`);

const attrs = meta.raw?.metadata?.attributes ?? null;
console.log(`attrs    ${Array.isArray(attrs) ? attrs.length : "none"}`);

// THE ASSERTION THAT MATTERS IS THE NAME, and specifically the name out of the
// JSON rather than anything derived from the contract. Basescan's page title
// is the contract's name() plus the id and LOOKS like ingested metadata when
// none was ingested; the same trap applies to any field a consumer could have
// synthesised without reading the document. The hash is written %23 by the
// renderer, so that is what a parser that actually read it reports.
const NAME = "Machine Readable Only %231";
const ingested = meta.name === NAME
  && image.contentType === "image/svg+xml"
  && typeof image.size === "number" && image.size > 0;

if (ingested) {
  console.log(`\nINGESTED. A third-party parser read this tokenURI, extracted a`);
  console.log(`${image.size}-byte SVG from it and rasterised it on its own CDN.`);
  console.log(`\nWHAT THIS DOES AND DOES NOT SHOW. It shows ingestion at THIS`);
  console.log(`token's size. It does not exercise the 24,000-byte limit, nor the`);
  console.log(`worst case a maximal-Mark child reaches. Read the tokenURI length`);
  console.log(`alongside this number before calling the byte question settled.`);
  process.exit(0);
}
console.log("\nNOT INGESTED: the metadata came back empty or errored.");
console.log("Before recording that as a size refusal, check the SHAPE of the");
console.log("response above -- this probe has been wrong about that once.");
process.exit(1);
