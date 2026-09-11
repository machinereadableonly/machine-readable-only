// Measure batchCheckIn against a real node, then send it the way the Clock
// sends it.
//
// Run through tools/chunk-rehearsal.sh, which starts a local anvil and deploys a
// fresh pair. NOT part of `npm test`: it mints 2,000 tokens.
//
// WHY A NODE AS WELL AS THE FORGE TEST. contracts/test/CheckIn.t.sol measures
// one chunk, but it is forge's accounting and it never runs the Clock -- and on
// 2026-09-11 forge's figure for 1,500 entries was wrong TWICE: 6,836,778 with
// no isolation, 14,353,906 isolated but encoding its arguments inside the
// window. This node's receipt said 13,175,282, and only a receipt settles which
// accounting is right. This runs the Clock's own writer against a node's own
// eth_estimateGas, and proves three things:
//
//   1. THE CURVE: what N check-ins cost, so the chunk size is a measurement
//   2. CHECKIN_CHUNK lands in ONE transaction through writeCheckInChunk
//   3. a chunk the guard refuses is halved, and still lands every entry
//
// It also REPORTS, without failing, what the writer says about a chunk past
// EIP-7825's cap -- the case the halving backstop was written for.
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { MRO_ABI } from "../src/clock/abi.mjs";
import { makeWriter, MAX_TX_GAS } from "../src/clock/write.mjs";
import { writeCheckInChunk, packIds } from "../src/clock/batch.mjs";
import { CHECKIN_CHUNK } from "../src/clock/run.mjs";

const RPC = process.env.RPC_URL;
const CONTRACT = process.env.CONTRACT;
const KEY = process.env.ANVIL_KEY;

/// EIP-7825, the chain's own per-transaction cap.
const TX_CAP = 16_777_216n;
/// The margin CHECKIN_CHUNK must leave under MAX_TX_GAS once padded.
const MARGIN = 500_000n;
/// The curve. It runs past the size where an UNPADDED chunk crosses EIP-7825
/// (about 1,910 entries), so it shows both ceilings rather than stopping short
/// of the one that bites.
const SIZES = [1, 250, 500, 750, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000];
const MINTED = Math.max(...SIZES, CHECKIN_CHUNK);

/// write.mjs pads every estimate by 12.5% and applies MAX_TX_GAS to the padded
/// figure. Repeated here for the table only: the assertions below go through
/// the real writer, so a change to its padding cannot hide behind this copy.
const pad = (gas) => (gas * 1125n) / 1000n;

// -- Refuse anything that is not a throwaway local anvil ----------------------

if (!RPC || !CONTRACT || !KEY) throw new Error("run through tools/chunk-rehearsal.sh");
const host = new URL(RPC).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`refusing ${host}: this mints ${MINTED} tokens and is local-only`);
}
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const clientVersion = String(await pub.request({ method: "web3_clientVersion" }));
if (!clientVersion.toLowerCase().startsWith("anvil")) {
  throw new Error(`refusing: the node says it is ${clientVersion}, not anvil`);
}
assert.equal(await pub.getChainId(), 84_532, "the wrapper starts anvil with Base Sepolia's chain id");

const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const read = (functionName, args = []) =>
  pub.readContract({ address: CONTRACT, abi: MRO_ABI, functionName, args });

// -- Mint, one transaction each, as the Clock would ---------------------------

// The artwork is irrelevant to what a check-in costs: mint checks only its
// length, and batchCheckIn never reads it. One address per token, because
// walletCap is 20; one key per token, because a key mints once.
const QR = "0x" + "ab".repeat(172);
// The day each mint is "paid" on: the chain's today, read once. mint takes it
// as its fifth argument since the first-day fix (2026-09-11).
const MINT_DAY = Number(await read("today"));
let nonce = await pub.getTransactionCount({ address: account.address });
const sent = [];
for (let id = 1; id <= MINTED; id += 1) {
  const args = [BigInt(id), `0x${(0x10000 + id).toString(16).padStart(40, "0")}`, `0x${id.toString(16).padStart(64, "0")}`, QR, MINT_DAY];
  const hash = await wallet.writeContract({
    address: CONTRACT,
    abi: MRO_ABI,
    functionName: "mint",
    args,
    nonce: nonce++,
    // Fixed, to skip an estimate per mint -- which is exactly why every receipt is
    // read below: with the gas given, a reverting mint still mines and
    // consumes its nonce, and says nothing unless asked.
    gas: 1_000_000n,
  });
  sent.push({ id, args, hash });
}

// ANVIL'S SEND RETURNS BEFORE THE BLOCK. Automine is asynchronous: measured
// 2026-09-11, totalMinted read straight after the last send said 895 of 1,800,
// with every one of the 1,800 about to succeed. Nonces are sequential, so once
// the LAST mint is in a block every earlier one is; waiting on each in turn
// polls on a timer and took over twenty minutes.
// The timeout is explicit because viem's default is sized for one transaction,
// not a backlog of 2,000: measured 2026-09-11, with the four suites sharing the
// CPU, the wait on the last mint ran out while anvil was still mining.
await pub.waitForTransactionReceipt({ hash: sent.at(-1).hash, pollingInterval: 100, timeout: 1_800_000 });
for (const { id, args, hash } of sent) {
  const receipt = await pub.getTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    // Replayed as a call for the contract's own error name. Against today's
    // state, not the block it failed in, so read it as a lead, not a verdict.
    const why = await pub
      .simulateContract({ address: CONTRACT, abi: MRO_ABI, functionName: "mint", args, account: account.address })
      .then(() => "the replay succeeded, so the revert depended on the block it mined in")
      .catch((err) => err.shortMessage ?? err.message);
    throw new Error(`mint ${id} reverted on chain (gasUsed ${receipt.gasUsed}): ${why}`);
  }
}
assert.equal(Number(await read("totalMinted")), MINTED, "every mint landed");

// Minting sets lastDay to today, so the check-in has to be tomorrow's.
await pub.request({ method: "evm_increaseTime", params: [86_400] });
await pub.request({ method: "evm_mine", params: [] });
const day = Number(await read("today"));
const entriesFor = (n) => Array.from({ length: n }, (_, i) => ({ tokenId: i + 1, day }));
const argsFor = (n) => {
  const entries = entriesFor(n);
  return [packIds(entries.map((e) => e.tokenId)), entries.map((e) => e.day)];
};

// -- 1. The curve -------------------------------------------------------------

console.log(`\nbatchCheckIn on ${clientVersion}, day ${day}, ${MINTED} tokens minted`);
console.log("entries  estimate     padded       verdict");
const curve = [];
for (const n of SIZES) {
  try {
    const gas = await pub.estimateContractGas({
      address: CONTRACT, abi: MRO_ABI, functionName: "batchCheckIn", args: argsFor(n), account: account.address,
    });
    const verdict = gas > TX_CAP ? "over EIP-7825" : pad(gas) > MAX_TX_GAS ? "refused by the Clock's guard" : "fits";
    curve.push({ n, gas });
    console.log(`${String(n).padStart(7)}  ${String(gas).padStart(11)}  ${String(pad(gas)).padStart(11)}  ${verdict}`);
  } catch (err) {
    console.log(`${String(n).padStart(7)}  estimate FAILED: ${err.shortMessage ?? err.message}`);
  }
}

// Least squares over the sizes that estimated, from 250 up: the one-entry point
// is dominated by the fixed cost and would bend the slope.
const fit = curve.filter((p) => p.n >= 250);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const mx = mean(fit.map((p) => p.n));
const my = mean(fit.map((p) => Number(p.gas)));
const slope =
  fit.reduce((s, p) => s + (p.n - mx) * (Number(p.gas) - my), 0) /
  fit.reduce((s, p) => s + (p.n - mx) ** 2, 0);
const intercept = my - slope * mx;
const largestUnder = (ceiling) => Math.floor(((Number(ceiling) * 1000) / 1125 - intercept) / slope);
console.log(`\nper entry ${slope.toFixed(1)} gas, fixed ${intercept.toFixed(0)} gas`);
console.log(`largest chunk the guard passes: ${largestUnder(MAX_TX_GAS)}`);
console.log(`largest leaving ${MARGIN} under the guard: ${largestUnder(MAX_TX_GAS - MARGIN)}`);
console.log(`CHECKIN_CHUNK is ${CHECKIN_CHUNK}`);

// -- The Clock's own writer, recorded ------------------------------------------

const writer = makeWriter({ rpcUrl: RPC, contract: CONTRACT, chainId: 84_532, privateKey: KEY, log: () => {} });
let sends = [];
const recording = {
  ...writer,
  send: async (functionName, args, opts) => {
    const r = await writer.send(functionName, args, opts);
    sends.push({ label: opts?.label, ok: r.ok, reason: r.reason ?? null, gas: r.gas ?? null, gasUsed: r.receipt?.gasUsed ?? null });
    return r;
  },
};

/// Run one chunk through writeCheckInChunk on a snapshot, then roll it back so
/// the next run finds the same untouched day.
async function throughTheClock(n) {
  const snapshot = await pub.request({ method: "evm_snapshot", params: [] });
  sends = [];
  await writer.startRun();
  const lines = [];
  const result = await writeCheckInChunk(recording, entriesFor(n), { log: (l) => lines.push(l) });
  // The receipt is not the proof; the chain's state is.
  const first = await read("viewOf", [1n]);
  const last = await read("viewOf", [BigInt(n)]);
  await pub.request({ method: "evm_revert", params: [snapshot] });
  return { result, sends, lines, firstLastDay: Number(first.lastDay), lastLastDay: Number(last.lastDay) };
}

// -- 2. CHECKIN_CHUNK lands in ONE transaction ---------------------------------

const atChunk = curve.find((p) => p.n === CHECKIN_CHUNK)?.gas ??
  (await pub.estimateContractGas({ address: CONTRACT, abi: MRO_ABI, functionName: "batchCheckIn", args: argsFor(CHECKIN_CHUNK), account: account.address }));
const chunkRun = await throughTheClock(CHECKIN_CHUNK);
const landed = chunkRun.sends.filter((s) => s.ok);
console.log(`\nCHECKIN_CHUNK ${CHECKIN_CHUNK} through the Clock: ${chunkRun.sends.length} send(s), gasUsed ${landed.map((s) => s.gasUsed).join(", ")}`);
assert.equal(chunkRun.result.written.length, CHECKIN_CHUNK, "every entry written");
assert.equal(chunkRun.result.dropped.length, 0, "nothing dropped");
assert.equal(chunkRun.sends.length, 1, "CHECKIN_CHUNK must go in ONE transaction, not a refusal and a halving");
assert.equal(chunkRun.firstLastDay, day, "the first token was credited on chain");
assert.equal(chunkRun.lastLastDay, day, "the last token was credited on chain");
assert.ok(pad(atChunk) <= MAX_TX_GAS - MARGIN, `CHECKIN_CHUNK padded is ${pad(atChunk)}, which leaves less than ${MARGIN} under MAX_TX_GAS`);

// -- 3. A chunk the guard refuses is halved, and still lands everything ------

const refused = curve.find((p) => pad(p.gas) > MAX_TX_GAS && p.gas <= TX_CAP);
if (refused) {
  const run = await throughTheClock(refused.n);
  console.log(`\n${refused.n} through the Clock: ${run.sends.map((s) => (s.ok ? `landed ${s.gasUsed}` : s.reason)).join(" -> ")}`);
  assert.equal(run.sends[0].reason, "gas-estimate-too-large", "the guard refuses it before anything is sent");
  assert.equal(run.result.written.length, refused.n, "halving still writes every entry");
  assert.equal(run.result.dropped.length, 0, "halving drops nothing");
  assert.equal(run.lastLastDay, day, "the last token was credited on chain");
}

// -- Reported, not asserted: past EIP-7825 --------------------------------------

const past = Math.max(...SIZES);
const probe = await throughTheClock(past);
console.log(`\n${past} through the Clock: ${probe.sends.map((s) => (s.ok ? `landed ${s.gasUsed}` : s.reason)).join(" -> ")}` +
  ` (written ${probe.result.written.length}, aborted ${probe.result.aborted})`);

console.log("\nOK");
