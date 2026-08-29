// Does Alchemy re-crawl on its own, and how long does it take?
//
// WHY. One re-read is known to have happened: timeLastUpdated moved 12:38:35 ->
// 20:49:07 and picked up a chain change that was itself about eight hours old.
// It cannot be attributed to any call -- refreshCache alone, invalidateContract
// alone, and both together have each since been given 20 clean minutes against a
// real chain/cache divergence and produced nothing. That leaves a slow internal
// re-crawl as the best remaining explanation, and roughly 8 hours as its period.
//
// The test is to make NO refresh requests whatsoever and watch. If the cache
// moves to the chain's Level 200 on its own around 04:50Z, the re-crawl is real
// and the explicit calls are the things that do nothing on this network.
//
// Every read here is a plain getNFTMetadata. Adding a refresh flag to any of
// them would destroy the experiment.
import { loadEnv, nftApiBase, getNftMetadata } from "./alchemy-nft.mjs";

const CONTRACT = "0x12C641d5C15DeEc21D71912973Bd8f63967b9bF6";
const TOKEN = 1;
const base = nftApiBase(loadEnv().ALCHEMY_BASE_SEPOLIA_RPC_URL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";

async function read() {
  const m = await getNftMetadata({ base, contract: CONTRACT, tokenId: TOKEN });
  const attrs = {};
  for (const a of m.raw?.metadata?.attributes ?? []) attrs[a.trait_type] = a.value;
  return {
    level: attrs.Level,
    timeLastUpdated: m.timeLastUpdated,
    asset: m.image?.cachedUrl?.split("/").pop() ?? null,
  };
}

const before = await read();
console.log(`[${stamp()}] baseline  Level ${before.level}  ${before.timeLastUpdated}`);
console.log(`chain is at Level 200 (verified by RPC at 22:00Z). NO refresh calls will be made.`);
console.log(`If the re-crawl theory holds, expect movement near 04:50Z.`);

// 12 hours at 10-minute spacing. Long enough to catch a second cycle if the
// first estimate is off, cheap enough to leave running unattended.
for (let i = 1; i <= 72; i++) {
  await sleep(600_000);
  const now = await read();
  const moved = now.timeLastUpdated !== before.timeLastUpdated;
  console.log(`[${stamp()}] poll ${String(i).padStart(2)}  Level ${now.level}  `
    + `${now.timeLastUpdated}  moved ${moved ? "YES" : "no"}  `
    + `asset ${now.asset === before.asset ? "same" : "CHANGED"}`);
  if (moved) {
    const hours = (Date.parse(now.timeLastUpdated) - Date.parse(before.timeLastUpdated)) / 3_600_000;
    console.log(`\nRE-CRAWLED WITH NO REQUEST FROM US, ${hours.toFixed(2)} hours after the last stamp.`);
    console.log(now.level === "200"
      ? `It picked up the chain's Level 200. Passive pickup is real, just slow.`
      : `It re-read but serves Level ${now.level}, not the chain's 200.`);
    console.log(now.asset === before.asset
      ? `The CDN asset id did NOT change -- the image was not rebuilt.`
      : `The CDN asset id CHANGED -- the image was rebuilt too.`);
    process.exit(0);
  }
}
console.log(`\n12 hours, no passive re-crawl. The 20:49 movement stays unexplained.`);
