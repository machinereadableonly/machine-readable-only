// Task 8: the Clock, against the real chain, signing with the real key.
//
// NOT part of `npm test`. It spends testnet gas and writes to a live contract.
//
//   bash tools/rehearse.sh <path-to-solved-bitmap-hex>
//
// It proves the four things only a live run can:
//
//   1. a queued mint becomes a token on chain, with its real solved artwork
//   2. a real batchCheckIn credits a day
//   3. A DELIBERATELY POISONED CHUNK -- one id the chain will refuse alongside
//      one it will accept -- drops the offender and lands the rest, which is
//      the whole re-chunk rule and the one thing a stub can only imitate
//   4. reconcile pages a window wider than the RPC's 10,000-block limit
//
// The mirror is a scratch file, never the Warden's own: this seeds rows that
// no agent paid for, and mixing them into the real mirror would leave the piece
// claiming tokens it never sold.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeWriter, chainFor } from "../src/clock/write.mjs";
import { runClock } from "../src/clock/run.mjs";
import { utcDay } from "../src/mcp/tools/checkin.mjs";
import { MRO_ABI } from "../src/clock/abi.mjs";

const CONTRACT = process.env.MRO_CONTRACT_ADDRESS;
const RPC = process.env.BASE_RPC_URL;
const KEY = process.env.CLOCK_PRIVATE_KEY;
const CHAIN_ID = Number(process.env.MRO_CHAIN_ID);
const BITMAP = readFileSync(process.argv[2], "utf8").trim();

if (!KEY) throw new Error("CLOCK_PRIVATE_KEY is not set: run through tools/rehearse.sh");
if (CHAIN_ID !== 84_532) throw new Error(`this rehearsal is Base Sepolia only, got chain ${CHAIN_ID}`);
if (BITMAP.length !== 344) throw new Error(`the bitmap must be 172 bytes, got ${BITMAP.length / 2}`);

const NEW_TOKEN = Number(process.argv[3] ?? 2);
const POISON_TOKEN = 4_242; // never minted, so the chain answers NoSuchToken
const TO = "0x000000000000000000000000000000000000dEaD";

const chain = chainFor(CHAIN_ID);
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const writer = makeWriter({ rpcUrl: RPC, contract: CONTRACT, chainId: CHAIN_ID, privateKey: KEY, publicClient });

console.log(`contract ${CONTRACT}`);
console.log(`warden   ${writer.address}`);
const onChainWarden = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "warden" });
if (onChainWarden.toLowerCase() !== writer.address.toLowerCase()) {
  throw new Error(`the contract's warden is ${onChainWarden}, not this key -- run SetClockWarden first`);
}
console.log("the contract's warden IS this key\n");

// A scratch mirror, seeded to look like a day the Warden already served.
const db = openDb(join(mkdtempSync(join(tmpdir(), "mro-rehearsal-")), "mirror.db"));
const q = queries(db);

// Token 1 already exists on chain (minted 2026-08-30) with lastDay 20695. It is
// the one token that can legitimately be credited a day right now.
const existing = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "viewOf", args: [1n] });
const existingLastDay = Number(existing.lastDay);
console.log(`token 1 on chain: level ${existing.level}, lastDay ${existingLastDay}`);

q.insertToken({ tokenId: 1, keyId: "k1", owner: TO, lastDay: existingLastDay, mintDay: Number(existing.mintDay) });
db.exec("UPDATE tokens SET status = 'written' WHERE tokenId = 1");

// The new token: paid for, solved, waiting to be written.
q.insertToken({ tokenId: NEW_TOKEN, keyId: "k-rehearsal", owner: TO, lastDay: utcDay(), mintDay: utcDay() });
q.insertMint({ tokenId: NEW_TOKEN, toAddress: TO, keyId: "k-rehearsal" });
db.exec(`UPDATE mints SET qr = '${BITMAP}', solveState = 'done' WHERE tokenId = ${NEW_TOKEN}`);
// The agent key the contract will bind, 32 bytes. UNIQUE PER TOKEN, because
// the contract allows ONE MINT PER KEY (AlreadyMinted, :243). A fixed value
// here worked once and then refused every later rehearsal -- correct contract
// behaviour, and a bug in this script.
const agentKey = `0x${NEW_TOKEN.toString(16).padStart(64, "0")}`;
db.exec(`UPDATE tokens SET keyId = '${agentKey}' WHERE tokenId = ${NEW_TOKEN}`);

// THE POISONED CHUNK. A day the chain will accept for token 1, alongside one it
// must refuse for a token that was never minted. Both go in the same call.
//
// The day comes from the CONTRACT's own clock, not this box's. The bound is
// `lastDay < day <= today()`, so there is exactly one creditable day and only
// when the token has not already had it. A rehearsal run twice in one UTC day
// finds none -- the second run asked for lastDay + 1, which was tomorrow, and
// the chain rightly answered FutureDay.
const chainToday = Number(existing.today);
const creditDay = existingLastDay + 1;
const canCredit = creditDay <= chainToday;
if (canCredit) {
  q.insertCredit(1, creditDay, "rehearsal-good");
  q.insertCredit(POISON_TOKEN, creditDay, "rehearsal-poison");
  q.insertToken({ tokenId: POISON_TOKEN, keyId: "k-poison", owner: TO, lastDay: creditDay - 1, mintDay: creditDay - 1 });
  console.log(`queued: mint ${NEW_TOKEN}, check-in for token 1 on day ${creditDay}, and a poisoned entry for token ${POISON_TOKEN}\n`);
} else {
  console.log(`queued: mint ${NEW_TOKEN} only. Token 1 is already credited through day ${existingLastDay} and the chain's today is ${chainToday}, so there is no creditable day until tomorrow.\n`);
}

// `today` is pushed one day forward so the day above counts as CLOSED. The
// contract's own bound is `day <= today()`, and creditDay is today on chain, so
// this is exactly what a run at 00:05 tomorrow would write.
const summary = await runClock({
  q,
  writer,
  publicClient,
  contract: CONTRACT,
  chainId: CHAIN_ID,
  today: Math.max(creditDay, chainToday) + 1,
  lastReconciledBlock: null,
});

console.log("\n--- results ---");
console.log("minted   :", summary.minted);
console.log("credited :", summary.credited.map((e) => `${e.tokenId}@${e.day}`));
console.log("dropped  :", summary.dropped.map((d) => `${d.entry.tokenId} (${d.reason})`));
// THE SEED COUNTERS MATTER MOST HERE, because this is where the seed pass first
// meets a real chain. A returned seed is an agent-year handed back and a stuck
// one is an agent-year still held; a rehearsal that printed neither would show
// a clean run while either had happened.
console.log("seeded   :", summary.seeded);
console.log("returned :", summary.droppedSeeds, "(seeds dropped, agent-year given back)");
console.log("seedstuck:", summary.stuckSeeds, "(seeds held, needs a human)");
console.log("aborted  :", summary.aborted);
console.log("reconcile:", summary.reconciled && `${summary.reconciled.from}..${summary.reconciled.to} in ${summary.reconciled.pages} pages`, JSON.stringify(summary.reconciled?.applied));

// --- what the chain actually says, which is the only thing that counts ------
//
// READ-AFTER-WRITE ON A PUBLIC RPC IS NOT IMMEDIATELY CONSISTENT. Measured on
// this very run, 2026-08-31: batchCheckIn was receipted in block 46213721, and
// a getBlockNumber issued AFTER that receipt returned 46213720. The endpoint is
// load balanced, and a later call can land on a node that has not imported the
// block the receipt came from. The write was correct; the read was early.
//
// It does not affect the Clock's own correctness -- rows are marked written
// from the receipt, never from a re-read -- but anything that VERIFIES a write
// has to wait for the block it is verifying, and that includes Task 6's
// timeLastUpdated check.
async function readAtLeast(blockNumber) {
  for (let i = 0; i < 20; i += 1) {
    if ((await publicClient.getBlockNumber()) >= blockNumber) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`WARNING: the node never caught up to block ${blockNumber}; reads below may be stale`);
}

const assert = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const minted = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "viewOf", args: [BigInt(NEW_TOKEN)] });
assert(`token ${NEW_TOKEN} exists on chain`, Number(minted.level) > 0, `level ${minted.level}`);
assert(`token ${NEW_TOKEN} carries the solved bitmap`, minted.code.slice(2) === BITMAP, `${(minted.code.length - 2) / 2} bytes`);

// Wait for the node to have the block the check-in landed in before reading.
if (summary.lastBlock) await readAtLeast(summary.lastBlock);
if (canCredit) {
  const credited = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "viewOf", args: [1n] });
  assert("token 1 was credited a day on chain", Number(credited.lastDay) === creditDay, `lastDay ${credited.lastDay}, level ${credited.level}`);
  assert("the poisoned entry was dropped, not written",
    summary.dropped.some((d) => d.entry.tokenId === POISON_TOKEN && d.reason === "NoSuchToken"));
  assert("and the good entry in the SAME chunk still landed",
    summary.credited.some((e) => e.tokenId === 1 && e.day === creditDay));
} else {
  console.log("SKIP  the check-in half: token 1 already has this day. Re-run tomorrow, or on a token with a day owing.");
}
assert("reconcile paged past the RPC's 10,000-block limit", (summary.reconciled?.pages ?? 0) > 1,
  `${summary.reconciled?.pages} pages`);

// The artwork, read back through the contract the way any consumer would.
const uri = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "tokenURI", args: [BigInt(NEW_TOKEN)] });
// THE PAYLOAD IS PLAIN UTF-8, NOT BASE64. The contract emits
// `data:application/json;utf-8,{...}` -- measured 2026-08-31, after this script
// assumed base64 twice and decoded the JSON into binary noise. Base64 would
// cost a third more bytes, and Phase 0's gas budget is counted in bytes.
//
// Everything after the FIRST comma, because the JSON itself is full of them.
const payload = uri.slice(uri.indexOf(",") + 1);
const json = JSON.parse(payload);
assert("tokenURI decodes to JSON with an image", typeof json.image === "string" && json.image.startsWith("data:image/svg+xml"),
  `name "${json.name}", ${uri.length} chars`);

db.close();
console.log(`\nclock balance left: ${await publicClient.getBalance({ address: writer.address })} wei`);
