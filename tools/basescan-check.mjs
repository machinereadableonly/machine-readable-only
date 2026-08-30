// Is Basescan a consumer of this token's metadata at all?
//
// WHY THIS EXISTS. Task 10c put the artwork in front of Alchemy, a rasteriser
// we do not own, and Basescan was named alongside it as a second free consumer
// on Base Sepolia. That premise was never actually tested. The first attempt
// read the server-rendered HTML, found `/images/main/nft-placeholder.svg` and
// recorded "inconclusive -- the media may load client-side and this VPS has no
// browser to settle it". The VPS does have a browser: Playwright's chromium is
// installed under ~/.cache/ms-playwright. This script settles it properly.
//
// THE DISCRIMINATOR IS THE POINT. Three outcomes, and only ONE of them says
// anything about ERC-4906:
//
//   A. Basescan shows the SAME Level the chain shows
//      -> fresh. It either does not cache, or it refreshed.
//   B. Basescan shows a DIFFERENT Level
//      -> it caches and is stale. The only outcome that is evidence about the
//         MetadataUpdate event.
//   C. Basescan shows no tokenURI-derived metadata at all
//      -> it never ingested the token, so it is not a consumer of ours and the
//         event question does not arise for it.
//
// Measured 2026-08-30: outcome C, on 4 tokens across 3 of our contracts.
//
// AND THE CONTROL DECIDES WHETHER C IS ACTIONABLE. If Basescan renders other
// collections' art but not ours, our on-chain data: URI is the thing it will
// not take, which we could act on. If it renders nobody's, it simply does not
// do NFT media on this testnet. Run with --control to harvest live tokens from
// the explorer's own recent-mints listing and check them the same way; on
// 2026-08-30 that returned 0 of 8 with a real image, so C is not about us.
//
// The chain Level is READ LIVE. Three harnesses on this project printed
// "chain is at Level 200" as a string literal and turned an unverified
// assumption into evidence in a log; see the ERC-4906 entry in
// docs/phase0-results.md. A harness here never prints a fact it did not measure.
//
//   node tools/basescan-check.mjs <contract> [--ids 1,21] [--control]
//
// Playwright is deliberately NOT a dependency of this workspace: it pulls a
// browser download for one diagnostic. It is resolved from wherever it already
// exists on this machine, and the script fails loudly if it does not.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, parseAbi } from "viem";

import { loadEnv } from "./alchemy-nft.mjs";
import { decodeTokenUri, attributesOf } from "./verify-tokenuri.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPLORER = "https://sepolia.basescan.org";
const ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);

/// Chromium reports itself as a normal desktop browser. Basescan sits behind
/// Cloudflare, and the collection-level pages refuse a headless-looking client
/// outright; the item pages serve fine with an ordinary user agent.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/**
 * Find an installed Playwright without adding one to this workspace.
 *
 * Fails loudly rather than falling back to a fetch-only check: a silent
 * downgrade would produce exactly the inconclusive placeholder reading that
 * this script exists to replace.
 */
function loadPlaywright() {
  const roots = [
    process.env.MRO_PLAYWRIGHT_ROOT,
    join(HERE, ".."),
    join(process.env.HOME ?? "", "projects", "review-my-contract"),
    join(process.env.HOME ?? "", "projects", "cph-apt"),
  ].filter(Boolean);

  for (const root of roots) {
    try {
      const req = createRequire(join(root, "/"));
      return req("playwright");
    } catch {
      // try the next root
    }
  }
  throw new Error(
    "playwright not found. Set MRO_PLAYWRIGHT_ROOT to a directory whose " +
      "node_modules contains it, or install it in tools/.",
  );
}

/** The Level attribute and name, via the tested decoder rather than a regex. */
function chainStateOf(uri) {
  const { json } = decodeTokenUri(uri);
  const attrs = attributesOf(json);
  return { level: attrs.Level ?? attrs.level, name: json.name };
}

/** Does this image URL look like artwork rather than site furniture? */
function isArtwork(src) {
  const media = /data:image|ipfs|cloudfront|amazonaws|googleusercontent|githubusercontent|\.png|\.jpg|\.gif|\.svg/i;
  const furniture = /placeholder|empty-token|logo|favicon|brands|chain-|labels/i;
  return media.test(src) && !furniture.test(src);
}

/** Read one Basescan NFT item page in a real browser. */
async function readItemPage(ctx, addr, id) {
  const page = await ctx.newPage();
  try {
    // Basescan long-polls, so `networkidle` never settles and every navigation
    // times out. Wait for the document, then give the client-side media its
    // own window to arrive.
    const resp = await page.goto(`${EXPLORER}/nft/${addr}/${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(9_000);

    const body = await page.evaluate(() => document.body.innerText);
    const imgs = await page.evaluate(() =>
      Array.from(document.images).map(i => i.currentSrc || i.src).filter(Boolean));

    return {
      status: resp?.status() ?? null,
      body,
      blocked: /Just a moment|Verify you are human|Attention Required|security verification/i.test(body),
      placeholder: imgs.some(s => /nft-placeholder|empty-token/i.test(s)),
      artwork: imgs.filter(isArtwork),
    };
  } finally {
    await page.close();
  }
}

const [, , contract, ...rest] = process.argv;
if (!contract) {
  console.error("usage: node tools/basescan-check.mjs <contract> [--ids 1,21] [--control]");
  process.exit(1);
}
const idsArg = rest.includes("--ids") ? rest[rest.indexOf("--ids") + 1] : "1";
const ids = idsArg.split(",").map(s => BigInt(s.trim()));
const wantControl = rest.includes("--control");

const env = loadEnv();
const rpc = env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
if (!rpc) throw new Error("ALCHEMY_BASE_SEPOLIA_RPC_URL missing from contracts/.env");
const client = createPublicClient({ transport: http(rpc) });

const { chromium } = loadPlaywright();
const lines = [];
const say = s => { console.log(s); lines.push(s); };

// 1. Ground truth, read from the chain right now.
const targets = [];
for (const id of ids) {
  const t = { addr: contract, id };
  try {
    const uri = await client.readContract({
      address: contract, abi: ABI, functionName: "tokenURI", args: [id],
    });
    Object.assign(t, chainStateOf(uri));
  } catch (e) {
    t.err = e.shortMessage ?? e.message;
  }
  targets.push(t);
  say(`chain  #${id}  Level=${t.level ?? `ERR ${t.err}`}  name=${t.name ?? "-"}`);
}

// 2. What Basescan actually renders for those same tokens.
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });

for (const t of targets) {
  const r = await readItemPage(ctx, t.addr, t.id);
  // The page title is built from the contract's name() plus the id, so it
  // proves nothing about metadata. Our tokenURI `name` is the tell.
  const showsOurName = Boolean(t.name && r.body.includes(t.name));
  const lvl = r.body.match(/Level[^0-9]{0,20}(\d{1,3})/i);

  say("");
  say(`basescan #${t.id}  http=${r.status}  blocked=${r.blocked}`);
  say(`  chain Level      : ${t.level ?? "ERR"}`);
  say(`  Level on page    : ${lvl ? lvl[1] : "NOT SHOWN"}`);
  say(`  placeholder image: ${r.placeholder}`);
  say(`  artwork images   : ${r.artwork.length ? r.artwork.map(s => s.slice(0, 60)).join(", ") : "none"}`);
  say(`  shows our name   : ${showsOurName ? "YES" : "no"} (${t.name ?? "-"})`);

  const outcome = r.blocked
    ? "BLOCKED (bot check) -- not a result"
    : showsOurName || lvl
      ? (String(lvl?.[1]) === String(t.level) ? "A: fresh" : "B: STALE -- evidence about ERC-4906")
      : "C: no tokenURI metadata ingested -- ERC-4906 is moot for this consumer";
  say(`  outcome          : ${outcome}`);
}

// 3. The control: does Basescan render anybody's art on this network?
if (wantControl) {
  say("");
  say("-- control: other live Base Sepolia collections --");
  const page = await ctx.newPage();
  await page.goto(`${EXPLORER}/nft-latest-mints`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(8_000);
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/nft/"]'))
      .map(a => a.getAttribute("href"))
      .filter(h => /\/nft\/0x[a-fA-F0-9]{40}\/\d+/.test(h)));
  await page.close();

  const picked = [...new Set(hrefs)].slice(0, 8);
  const contracts = new Set(picked.map(h => h.split("/")[2]?.toLowerCase()));
  let withArt = 0;
  for (const href of picked) {
    const [, , addr, id] = href.split("/");
    const r = await readItemPage(ctx, addr, id);
    if (r.artwork.length) withArt++;
    say(`  ${href}  placeholder=${r.placeholder} artwork=${r.artwork.length}`);
  }
  // Say what the sample actually covers. A count of tokens reads like a count
  // of collections and is not one.
  say(`  CONTROL: ${withArt} of ${picked.length} tokens showed artwork, ` +
      `across ${contracts.size} distinct contract(s).`);
}

await browser.close();

mkdirSync(join(HERE, "out"), { recursive: true });
const log = join(HERE, "out", "basescan-check.log");
writeFileSync(log, lines.join("\n") + "\n");
console.log(`\nwritten: ${log}`);
