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
// THE THIRD MODE, added 2026-08-29, and what it found. `read` and `refresh`
// between them cannot tell row 3 apart from a request that was never accepted,
// because getNFTMetadata?refreshCache=true reports nothing about the refresh
// itself. The DEDICATED endpoint does: it answers with `status` and
// `estimatedMsToRefresh`.
//
// MEASURED: it is not available here.
//
//   POST .../nft/v3/<key>/refreshNftMetadata  ->  400 Bad Request
//   {"error":{"message":"This endpoint isn't enabled for that chain or network
//    just yet - please contact the Alchemy team for support!"}}
//
// So the question cannot be answered on this testnet at all -- which is a very
// different statement from "ERC-4906 is being ignored", and the difference must
// be preserved in every write-up.
//
// WHAT THE THREE REACHABLE MECHANISMS DO, each given 20 clean minutes on
// 2026-08-29 against a verified chain/cache divergence (chain Level 200, cache
// Level 300):
//
//   refreshCache=true alone .................. timeLastUpdated never moved
//   invalidateContract alone ................. timeLastUpdated never moved
//   invalidateContract then refreshCache=true  timeLastUpdated never moved
//
// One re-read HAS been observed, 12:38:35Z -> 20:49:07Z, and it is UNATTRIBUTED:
// the third sequence above reproduces the calls made one minute before it and
// does nothing. An 8.2-hour gap collecting an 8-hour-old change looks far more
// like a slow internal re-crawl. tools/out/passive-longwatch.mjs tests that by
// making no refresh requests at all.
//
// DO NOT re-run this expecting the endpoint mode to work. Re-run it on a network
// where the endpoint exists -- Base MAINNET does, Base Sepolia does not.
//
//   node tools/erc4906-retest.mjs read     <contract> <tokenId>
//   node tools/erc4906-retest.mjs refresh  <contract> <tokenId>
//   node tools/erc4906-retest.mjs endpoint <contract> <tokenId> [watchMinutes]
import { createPublicClient, http, parseAbi } from "viem";

import {
  loadEnv, nftApiBase, getNftMetadata, refreshNftMetadata, redact,
} from "./alchemy-nft.mjs";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19) + "Z";

/**
 * POST the dedicated refresh endpoint, then watch the timestamp.
 *
 * The watch is part of the same command rather than a separate one, because the
 * two halves are only meaningful together: an accepted request that never
 * lands, and a refused request, look the same if you only run the first half.
 * It stops early the moment `timeLastUpdated` moves -- that is the whole signal.
 */
async function endpointMode({ base, client, contract, tokenId, watchMinutes }) {
  const before = await cached({ base, contract, tokenId });

  const r = await refreshNftMetadata({ base, contract, tokenId });
  console.log(`\nPOST ${r.url}`);
  console.log(`http            ${r.httpStatus} ${r.statusText}`);
  console.log(`body            ${r.text.slice(0, 400)}`);

  if (!r.ok) {
    // Not a failure of the test. The endpoint refusing on this network is an
    // answer, and the wording of the refusal is the evidence -- record it.
    console.log(`\nREFUSED. The dedicated endpoint did not accept the request on this`);
    console.log(`network, so it cannot be used to settle the question here. This says`);
    console.log(`nothing about whether ERC-4906 is honoured.`);
    return;
  }

  const status = r.json?.status;
  const eta = r.json?.estimatedMsToRefresh;
  console.log(`status          ${status ?? "(absent)"}`);
  console.log(`estimatedMs     ${eta ?? "(absent)"}`);
  console.log(`\nACCEPTED. This is the first time a refresh is known to have been`);
  console.log(`enqueued, so a timestamp that still refuses to move now means`);
  console.log(`something. Watching for ${watchMinutes} minutes.`);
  console.log(`\ntimeLastUpdated before  ${before.timeLastUpdated}`);

  for (let minute = 1; minute <= watchMinutes; minute++) {
    await sleep(60_000);
    const now = await cached({ base, contract, tokenId });
    const moved = now.timeLastUpdated !== before.timeLastUpdated;
    console.log(`[${stamp()}] minute ${String(minute).padStart(2)}  `
      + `Level ${now.level}  timeLastUpdated ${now.timeLastUpdated}  `
      + `moved ${moved ? "YES" : "no"}`);
    if (moved) {
      const chain = await onChainLevel(client, contract, tokenId);
      const agrees = String(chain.level) === String(now.level);
      console.log(`\nTIMESTAMP MOVED. Chain Level ${chain.level}, Alchemy Level ${now.level}.`);
      console.log(agrees
        ? `ROW 1: it re-read and got the current state. The refresh path WORKS.`
        : `ROW 2: it re-read and served a stale answer. This is the serious case.`);
      return;
    }
  }

  console.log(`\nROW 3 after an ACCEPTED request: ${watchMinutes} minutes and the`);
  console.log(`timestamp never moved. Report exactly that, and nothing stronger.`);
}

async function main() {
  const [mode, contract, tokenId, watchArg] = process.argv.slice(2);
  if (!mode || !contract || !tokenId) {
    console.error("usage: erc4906-retest.mjs <read|refresh|endpoint> <contract> <tokenId> [watchMinutes]");
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

  if (mode === "endpoint") {
    await endpointMode({
      base, client, contract, tokenId,
      watchMinutes: Number(watchArg ?? 20),
    });
  }
}

if (process.argv[1]?.endsWith("erc4906-retest.mjs")) await main();
