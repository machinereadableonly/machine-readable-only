// Prove a Mark lands on chain, against the real contract and the real key.
//
// NOT part of `npm test`. It spends testnet gas and writes to a live contract.
//
//   cd warden && bash tools/mark-rehearse.sh <path-to-solved-bitmap-hex> [tokenId]
//
// WHY THIS EXISTS SEPARATELY FROM clock-rehearsal.mjs. That script proves the
// mint, the check-in, the re-chunk rule and reconcile, and it assumes a token
// already on chain to credit. This one proves the single thing Plan 5 added and
// nothing had ever exercised: applyMark reaching the chain with a variant. From
// 2026-08-30 to 2026-09-03 that path was structurally impossible -- the deployed
// contract took two arguments and the Clock sent three -- and no test caught it,
// because every Clock test drives a stub writer that records arguments instead
// of encoding them. Only a real chain can answer this one.
//
// It mints a token and then applies HUSH (id 1), which is the only Mark a
// freshly minted token can take: minLevel 0, minStreak 0, no whole heart and no
// Iris required. Everything else on the ladder needs days this token does not
// have.
//
// The mirror is a scratch file, never the Warden's own: this seeds rows that no
// agent paid for, and mixing them into the real mirror would leave the piece
// claiming a Mark it never sold.
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
import { LADDER } from "../src/mcp/ladder.mjs";

const CONTRACT = process.env.MRO_CONTRACT_ADDRESS;
const RPC = process.env.BASE_RPC_URL;
const KEY = process.env.CLOCK_PRIVATE_KEY;
const CHAIN_ID = Number(process.env.MRO_CHAIN_ID);
const BITMAP = readFileSync(process.argv[2], "utf8").trim();

if (!KEY) throw new Error("CLOCK_PRIVATE_KEY is not set: run through tools/mark-rehearse.sh");
if (CHAIN_ID !== 84_532) throw new Error(`this rehearsal is Base Sepolia only, got chain ${CHAIN_ID}`);
if (BITMAP.length !== 344) throw new Error(`the bitmap must be 172 bytes, got ${BITMAP.length / 2}`);

const TOKEN = Number(process.argv[3] ?? 1);
const HUSH = 1;
const TO = "0x000000000000000000000000000000000000dEaD";

const chain = chainFor(CHAIN_ID);
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const writer = makeWriter({ rpcUrl: RPC, contract: CONTRACT, chainId: CHAIN_ID, privateKey: KEY, publicClient });

console.log(`contract ${CONTRACT}`);
console.log(`warden   ${writer.address}`);
const onChainWarden = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "warden" });
if (onChainWarden.toLowerCase() !== writer.address.toLowerCase()) {
  throw new Error(`the contract's warden is ${onChainWarden}, not this key`);
}
console.log("the contract's warden IS this key");

// THE MARK IS READ FROM THE CATALOGUE, not hardcoded to "the cheap one". If the
// ladder is ever reordered this fails loudly here instead of silently proving
// something about a different Mark.
const mark = LADDER[HUSH];
if (mark.minLevel > 1 || mark.minStreak > 0 || mark.needsWhole || mark.requiresAny) {
  throw new Error(`mark ${HUSH} (${mark.name}) is no longer takeable by a level-1 token`);
}
console.log(`applying mark ${HUSH} (${mark.name}), ${mark.price ?? "earned"}\n`);

const existing = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "viewOf", args: [BigInt(TOKEN)] });
if (Number(existing.level) !== 0) {
  throw new Error(`token ${TOKEN} already exists on chain at level ${existing.level}; pass a fresh id`);
}

const db = openDb(join(mkdtempSync(join(tmpdir(), "mro-mark-rehearsal-")), "mirror.db"));
const q = queries(db);

// A paid, solved mint waiting to be written. The agent key is unique per token
// because the contract allows ONE MINT PER KEY (AlreadyMinted).
q.insertToken({ tokenId: TOKEN, keyId: "k-mark-rehearsal", owner: TO, lastDay: utcDay(), mintDay: utcDay() });
q.insertMint({ tokenId: TOKEN, toAddress: TO, keyId: "k-mark-rehearsal" });
db.exec(`UPDATE mints SET qr = '${BITMAP}', solveState = 'done' WHERE tokenId = ${TOKEN}`);
const agentKey = `0x${TOKEN.toString(16).padStart(64, "0")}`;
db.exec(`UPDATE tokens SET keyId = '${agentKey}' WHERE tokenId = ${TOKEN}`);

const clockArgs = () => ({
  q, writer, publicClient, contract: CONTRACT, chainId: CHAIN_ID,
  today: utcDay() + 1, lastReconciledBlock: null,
});

console.log("--- run 1: the mint ---");
const first = await runClock(clockArgs());
console.log("minted   :", first.minted);
console.log("aborted  :", first.aborted);

// THE MARK IS RESERVED ONLY AFTER THE MINT IS ON CHAIN. applyMark reverts
// NoSuchToken against a token the chain has not seen, and since 2026-09-03 that
// is correctly NOT terminal -- the row would simply sit queued. Reserving it
// here keeps the two runs a clean before-and-after rather than a retry.
if (!first.minted.length) throw new Error("the mint did not land; nothing to mark");
q.reserveMark(TOKEN, HUSH, 0);

console.log("\n--- run 2: the mark ---");
const second = await runClock(clockArgs());
console.log("marks    :", second.marks.map((m) => `${m.upgradeId} on ${m.tokenId} (variant ${m.variant})`));
console.log("stuck    :", second.stuckMarks.map((m) => m.upgradeId));
console.log("aborted  :", second.aborted);

// READ-AFTER-WRITE ON A PUBLIC RPC IS NOT IMMEDIATELY CONSISTENT: the endpoint
// is load balanced and a read can land on a node that has not imported the block
// the receipt came from. Measured on the Plan 3 rehearsal, 2026-08-31.
async function readAtLeast(blockNumber) {
  for (let i = 0; i < 20; i += 1) {
    if ((await publicClient.getBlockNumber()) >= blockNumber) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`WARNING: the node never caught up to block ${blockNumber}`);
}
if (second.lastBlock) await readAtLeast(BigInt(second.lastBlock));

let failures = 0;
const assert = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("\n--- what the chain says, which is the only thing that counts ---");
const view = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "viewOf", args: [BigInt(TOKEN)] });
const marks = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "marksOf", args: [BigInt(TOKEN)] });

assert(`token ${TOKEN} exists`, Number(view.level) >= 1, `level ${view.level}`);
assert(`token ${TOKEN} wears mark ${HUSH}`, (BigInt(marks) & (1n << BigInt(HUSH))) !== 0n, `marks 0x${BigInt(marks).toString(16)}`);
// The Mark set is bits 1-10. Bits 16+ carry variants and the earned run, so
// "wears any Mark" is marks & 0xFFFE and never marks != 0.
assert("it wears exactly one mark", (BigInt(marks) & 0xFFFEn) === (1n << BigInt(HUSH)), `masked 0x${(BigInt(marks) & 0xFFFEn).toString(16)}`);
assert("the mirror agrees", (q.getToken(TOKEN).marks & (1 << HUSH)) !== 0);
assert("the order is written, not stuck", db.prepare("SELECT status FROM mark_orders WHERE tokenId = ? AND upgradeId = ?").get(TOKEN, HUSH).status === "written");
assert("nothing was reported stuck", second.stuckMarks.length === 0);

// The artwork must still render through the contract with the Mark on it --
// the whole point of a Mark is that it changes what the token looks like.
const uri = await publicClient.readContract({ address: CONTRACT, abi: MRO_ABI, functionName: "tokenURI", args: [BigInt(TOKEN)] });
assert("tokenURI still renders", uri.startsWith("data:application/json"), `${uri.length} chars`);
// The contract emits data:application/json;utf8,<raw json>, NOT base64 -- a
// base64 decode here produced binary noise and failed the assertion below while
// the artwork itself was perfectly correct. Handle whichever prefix is present
// rather than assuming, so this cannot mis-report a good token again.
const comma = uri.indexOf(",");
const payload = uri.slice(comma + 1);
const json = JSON.parse(uri.slice(0, comma).includes(";base64")
  ? Buffer.from(payload, "base64").toString("utf8")
  : decodeURIComponent(payload));
const named = (json.attributes ?? []).some((a) => String(a.value).toLowerCase().includes(mark.name.toLowerCase()));
assert(`the metadata names ${mark.name}`, named, JSON.stringify(json.attributes?.slice(0, 8)));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
