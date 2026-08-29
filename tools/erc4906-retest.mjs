// Does Alchemy actually re-read a token after MetadataUpdate? Measured properly.
//
// WHY THIS EXISTS. The first attempt, on 2026-08-29, concluded that the refresh
// "did not happen" and that conclusion was too strong. Three flaws, all found by
// reading Alchemy's own docs afterwards:
//
//   1. Ninety minutes of polling WITHOUT a refresh flag only reads the cache. It
//      never asks for a re-read, so it can only show that the cache does not
//      self-expire -- which is expected, not a defect.
//   2. "The backend only allows one refresh per token every 15 minutes, globally
//      for all users." The two refresh calls were TEN minutes apart, so at most
//      one of them was ever enqueued.
//   3. Refreshes are QUEUED, not synchronous -- the refresh endpoint returns a
//      status and an estimatedMsToRefresh. invalidateContract got four minutes.
//
// And `timeLastUpdated` is documented as the LAST REFRESH TIME. Its staying
// frozen is therefore consistent with "no refresh ever ran", which is exactly
// what rate limiting or queueing produces. The first test read that as "it is
// not re-reading at all", which does not follow.
//
// THE DISCRIMINATOR THIS TEST IS BUILT AROUND. Watch `timeLastUpdated`, not the
// Level:
//   - timeLastUpdated MOVES and Level updates -> refresh works. No problem.
//   - timeLastUpdated MOVES and Level does not -> it re-read and got a stale
//     answer. A real and serious problem.
//   - timeLastUpdated does NOT move -> the refresh never ran. Our problem, or a
//     rate limit, NOT evidence about ERC-4906.
//
// Only the middle case justifies the alarm the first finding raised.
//
//   node tools/erc4906-retest.mjs read    <contract> <tokenId>
//   node tools/erc4906-retest.mjs refresh <contract> <tokenId>
import { createPublicClient, http, parseAbi } from "viem";

import { loadEnv, nftApiBase, getNftMetadata, redact } from "./alchemy-nft.mjs";
import { decodeTokenUri, attributesOf } from "./verify-tokenuri.mjs";

const ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);

/// The Level attribute as the CHAIN reports it, read straight through RPC with
/// no indexer in the path. This is the ground truth every comparison is against.
async function onChainLevel(client, contract, tokenId) {
  const uri = await client.readContract({
    address: contract, abi: ABI, functionName: "tokenURI", args: [BigInt(tokenId)],
  });
  const { json } = decodeTokenUri(uri);
  return { level: attributesOf(json).Level, name: json.name };
}

/// What Alchemy is serving, and WHEN it last refreshed. Read without the
/// refresh flag on purpose: this must not consume the 15-minute window.
async function cached({ base, contract, tokenId, refreshCache = false }) {
  const m = await getNftMetadata({ base, contract, tokenId, refreshCache });
  // v3 nests the token's own JSON under `raw.metadata`; `timeLastUpdated` is a
  // sibling of it at the top level. Getting this wrong reads as an empty
  // response rather than an error, which cost a wrong reading once already.
  const attrs = {};
  for (const a of m.raw?.metadata?.attributes ?? []) attrs[a.trait_type] = a.value;
  return { level: attrs.Level, name: m.name, timeLastUpdated: m.timeLastUpdated };
}

async function main() {
  const [mode, contract, tokenId] = process.argv.slice(2);
  if (!mode || !contract || !tokenId) {
    console.error("usage: erc4906-retest.mjs <read|refresh> <contract> <tokenId>");
    process.exit(2);
  }

  const env = loadEnv();
  const rpcUrl = env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
  const base = nftApiBase(rpcUrl);
  const client = createPublicClient({ transport: http(rpcUrl) });

  const chain = await onChainLevel(client, contract, tokenId);
  const seen = await cached({ base, contract, tokenId });

  console.log(`contract        ${contract}  token ${tokenId}`);
  console.log(`chain says      Level ${chain.level}   (${chain.name})`);
  console.log(`Alchemy says    Level ${seen.level}   (${seen.name})`);
  console.log(`timeLastUpdated ${seen.timeLastUpdated}`);
  console.log(`agree           ${String(chain.level) === String(seen.level) ? "YES" : "NO"}`);

  if (mode === "refresh") {
    // ONE call, and the timestamp before it, so movement is unambiguous.
    const before = seen.timeLastUpdated;
    const after = await cached({ base, contract, tokenId, refreshCache: true });
    console.log(`\nrefresh requested; timeLastUpdated now ${after.timeLastUpdated}`);
    console.log(`moved immediately: ${after.timeLastUpdated !== before ? "YES" : "no (expected -- it is queued)"}`);
    console.log(`\nNow run the read mode every few minutes for at least 30, and`);
    console.log(`watch timeLastUpdated rather than Level. See this file's header.`);
  }
}

if (process.argv[1]?.endsWith("erc4906-retest.mjs")) await main();
