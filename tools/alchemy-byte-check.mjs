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

// TWO DEFECTS FIXED 2026-09-22, both of which reported NOT INGESTED against a
// token Alchemy had ingested perfectly.
//
// 1. IT ASKED FOR A REFRESH AND THEN JUDGED THE ANSWER IMMEDIATELY. Media
//    processing is ASYNCHRONOUS: refreshCache restarts it, and the very next
//    response carries the metadata with the media fields empty, because the CDN
//    has not finished. Measured on the byte-gate token -- one call with
//    refreshCache reported no contentType, no size and no pngUrl; a plain read
//    a minute later reported image/svg+xml, 21,594 bytes and both CDN urls. So
//    the read comes FIRST, and a refresh is a fallback that is then POLLED.
//
// 2. IT ASSERTED AN EXACT NAME. `Renderer._suffix` appends the token's state --
//    " (Whole)" and so on -- so the exact match failed for every token past day
//    one. The suffix is itself proof the document was parsed; a PREFIX match
//    keeps the assertion (Basescan's synthesised title could never produce the
//    `%23`) without failing on a token that has lived.
//
// The two questions are now reported SEPARATELY, because they have different
// answers and different consequences: a size refusal would show as metadata
// parsed and media absent, which the old single verdict could not express.
const WAIT_MS = 15_000;
const TRIES = 8;

const read = () => getNftMetadata({ base, contract, tokenId, refreshCache: false });
const mediaDone = m =>
  m?.image?.contentType === "image/svg+xml" && typeof m?.image?.size === "number" && m.image.size > 0;

console.log(`contract ${contract} token ${tokenId}`);

let res = await read();
if (!mediaDone(res)) {
  console.log("no media yet -- forcing a refresh and polling, because the CDN is asynchronous");
  await getNftMetadata({ base, contract, tokenId, refreshCache: true });
  for (let i = 0; i < TRIES && !mediaDone(res); i++) {
    await new Promise(r => setTimeout(r, WAIT_MS));
    res = await read();
    console.log(`  try ${i + 1}/${TRIES}: contentType=${res?.image?.contentType ?? "none"} size=${res?.image?.size ?? "none"}`);
  }
}

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
// A PREFIX, not an exact match: Renderer._suffix appends the token's state.
// The `%23` is what makes this assertion mean something -- a consumer that
// synthesised a title from the contract's name() could never produce it.
const NAME = "Machine Readable Only %231";
const parsed = typeof meta.name === "string" && meta.name.startsWith(NAME)
  && Array.isArray(attrs) && attrs.length > 0;
const rasterised = mediaDone(meta);

console.log("");
console.log(`metadata  ${parsed ? "PARSED" : "NOT PARSED"} -- name read from the JSON, ${Array.isArray(attrs) ? attrs.length : 0} attributes`);
console.log(`media     ${rasterised ? `RASTERISED -- ${image.size}-byte SVG flattened on their CDN` : "ABSENT"}`);

if (parsed && rasterised) {
  console.log(`\nINGESTED at this size. A third-party parser read this tokenURI,`);
  console.log(`extracted a ${image.size}-byte SVG from it and rasterised it itself.`);
  console.log(`\nWHAT THIS DOES AND DOES NOT SHOW. It shows ingestion at THIS`);
  console.log(`token's size, and says nothing about a larger one. Read the`);
  console.log(`tokenURI length alongside it, and run tools/third-party-check.mjs`);
  console.log(`to ask the harder question -- whether the QR still decodes from`);
  console.log(`THEIR rasters rather than ours.`);
  process.exit(0);
}

if (parsed && !rasterised) {
  console.log(`\nMETADATA INGESTED, MEDIA NOT. This is the shape a SIZE refusal`);
  console.log(`would take, and it is also the shape of a CDN that is merely slow.`);
  console.log(`The poll above ran ${TRIES} times over ${(TRIES * WAIT_MS) / 1000}s, so slowness is`);
  console.log(`less likely than it looks -- but re-run before recording a refusal.`);
  process.exit(1);
}

console.log("\nNOT INGESTED: the metadata came back empty or errored.");
console.log("Before recording that as a size refusal, check the SHAPE of the");
console.log("response above -- this probe has been wrong about that twice.");
process.exit(1);
