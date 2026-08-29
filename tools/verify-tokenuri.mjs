// Reads tokenURI off a deployed contract and proves the image a chain returns
// still scans.
//
// This is the check no Solidity test can make. A forge test never crosses the
// RPC boundary, so it cannot tell you that a provider's eth_call gas cap or
// response-size limit rejects the call, and it cannot rasterise the SVG and put
// a decoder on it. A rendered image that a decoder cannot read is a failed
// spike, and only the on-chain output settles that.
//
//   node tools/verify-tokenuri.mjs <address> <id> [rpcUrl] [domain]
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";

import { svgToPng } from "./svg-to-png.mjs";
import { payloadFor } from "./qart.mjs";
// The one decode oracle. It lives under test/helpers because the tests were
// written first; importing it here rather than copying it is the point -- two
// definitions of "it scans" is exactly the failure this project already had
// once, when jsqr and a real phone disagreed.
import { scanResult } from "./test/helpers/decode.mjs";

const ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);

const JSON_PREFIX = "data:application/json;utf-8,";
const IMAGE_PREFIX = "data:image/svg+xml;base64,";

/**
 * Split a tokenURI into its JSON and its decoded SVG.
 * Pure string work: no network, so the tests can use it without a chain.
 */
export function decodeTokenUri(uri) {
  if (!uri.startsWith(JSON_PREFIX)) {
    throw new Error(`expected a ${JSON_PREFIX} URI, got ${uri.slice(0, 40)}...`);
  }
  // Parsing rather than regexing the JSON is deliberate: it proves the payload
  // is valid JSON, which is the thing a raw "#" would break.
  const json = JSON.parse(uri.slice(JSON_PREFIX.length));

  if (!json.image?.startsWith(IMAGE_PREFIX)) {
    throw new Error(`expected a ${IMAGE_PREFIX} image`);
  }
  const svg = Buffer.from(json.image.slice(IMAGE_PREFIX.length), "base64").toString("utf8");
  return { json, svg };
}

/** The attributes as a plain object, so a caller can assert on one by name. */
export function attributesOf(json) {
  return Object.fromEntries((json.attributes ?? []).map(a => [a.trait_type, a.value]));
}

/**
 * Check a tokenURI that has already been fetched.
 *
 * Split out from verifyToken so a URI obtained any other way can be put through
 * the identical checks -- `cast call` against a provider whose URL holds an API
 * key, or OpenSea's own copy in Task 11. The checking must not differ by how the
 * string arrived.
 */
export function verifyUriString({ uri, id, domain, px = 700, pngPath = null }) {
  const { json, svg } = decodeTokenUri(uri);
  const scan = scanResult(svg, px);
  const expected = payloadFor(domain, id);

  let ok = scan.ok;
  let why = scan.why;

  // "It scans" is not enough. The destination has to be THIS token's URL --
  // a code that decodes cleanly to the wrong id is still a failure.
  if (ok && !expected.startsWith(scan.destination)) {
    ok = false;
    why = `decoded to ${scan.destination}, expected ${expected.replace(/#$/, "")}`;
  }

  if (pngPath) writeFileSync(pngPath, svgToPng(svg, 1024));

  return {
    ok, why,
    decoded: scan.text,
    destination: scan.destination ?? null,
    bytes: uri.length,
    svgBytes: svg.length,
    json,
    attributes: attributesOf(json),
    pngPath,
  };
}

/**
 * Read one token off a chain and check everything about it that can fail.
 *
 * @returns { ok, why, decoded, gas, bytes, svgBytes, json, pngPath }
 */
export async function verifyToken({ rpcUrl, address, id, domain, px = 700, pngPath = null }) {
  const client = createPublicClient({ transport: http(rpcUrl) });

  const uri = await client.readContract({ address, abi: ABI, functionName: "tokenURI", args: [BigInt(id)] });

  // What the call costs through a node, not through a test EVM. This is the
  // number a provider's cap is applied to.
  const gas = await client.estimateGas({
    to: address,
    data: encodeFunctionData({ abi: ABI, functionName: "tokenURI", args: [BigInt(id)] }),
  });

  return { ...verifyUriString({ uri, id, domain, px, pngPath }), gas: Number(gas) };
}

if (process.argv[1] && process.argv[1].endsWith("verify-tokenuri.mjs")) {
  const args = process.argv.slice(2);
  let r, id;

  // A PNG of what the chain returned, for eyeballing and for the OpenSea
  // comparison in Task 11 -- their flattened PNG has to be checked against
  // ours, not against the SVG. tools/out is gitignored.
  if (args[0] === "--file") {
    // Offline: the URI was already fetched, by cast or by anything else. Used
    // against providers whose RPC URL carries an API key, so the URL never has
    // to reach this process.
    const [, path, rawId, domain = "example.com", gas = "0"] = args;
    id = rawId;
    const uri = readFileSync(path, "utf8").trim();
    r = { ...verifyUriString({ uri, id: Number(id), domain, pngPath: `out/token-${id}.png` }),
          gas: Number(gas) };
  } else {
    const [address, rawId, rpcUrl = "http://127.0.0.1:8545", domain = "example.com"] = args;
    id = rawId;
    if (!address || !id) {
      console.error("usage: node verify-tokenuri.mjs <address> <id> [rpcUrl] [domain]");
      console.error("       node verify-tokenuri.mjs --file <path> <id> [domain] [gas]");
      process.exit(1);
    }
    r = await verifyToken({ rpcUrl, address, id: Number(id), domain, pngPath: `out/token-${id}.png` });
  }

  console.log(
    `token ${id}: ${r.ok ? "OK" : `FAIL (${r.why})`}  ` +
    `${r.gas} gas, ${r.bytes} uri bytes, ${r.svgBytes} svg bytes`
  );
  console.log(`  name       ${r.json.name}`);
  console.log(`  decoded    ${r.decoded}`);
  console.log(`  heart      ${r.attributes.Heart}, streak ${r.attributes.Streak}, marks ${JSON.stringify(r.attributes.Marks)}`);
  console.log(`  png        tools/${r.pngPath}`);
  process.exit(r.ok ? 0 : 1);
}
