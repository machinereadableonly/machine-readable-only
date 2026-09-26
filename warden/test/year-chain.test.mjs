// The year's chain adapter, with the node replaced by fakes: what a token view
// decodes to, and that nothing is reported as sent until a receipt says so.
import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeFunctionData } from "viem";

import { MRO_ABI } from "../src/clock/abi.mjs";
import { makeChain, decodeView, addressOf, USDC, CHAIN_ID } from "../tools/year/chain.mjs";

const CONTRACT = "0x00000000000000000000000000000000000C0DE0";
const AGENT = "0x00000000000000000000000000000000000000A1";
const OTHER = "0x00000000000000000000000000000000000000A2";
// Never funded: these only ever reach a fake factory in this file.
const KEY = `0x${"11".repeat(32)}`;
const KEY2 = `0x${"22".repeat(32)}`;

/// A token view as viewOf returns it, with every field the adapter reads.
const view = (over = {}) => ({
  tokenId: 7n, level: 40, streak: 9, lastDay: 1000, mintDay: 960, generation: 1,
  seedsGiven: 0, parent: 0n, echo: 0, resting: false, sunset: false, sunsetDay: 0,
  fellRun: 30, fellDay: 0, marks: 0n, agentKeyId: `0x${"00".repeat(32)}`, code: "0x", today: 1000,
  ...over,
});

/// Fake clients that answer from a script and record what they were asked,
/// including which key each send was signed with.
function fakes({ reads = {}, status = "success" } = {}) {
  const sent = [];
  const keys = [];
  const publicClient = {
    readContract: async (args) => {
      const answer = reads[args.functionName];
      if (answer === undefined) throw new Error(`no scripted read for ${args.functionName}`);
      sent.push({ read: args.functionName, address: args.address, args: args.args });
      return answer;
    },
    waitForTransactionReceipt: async ({ hash }) => ({ hash, status }),
  };
  const walletFactory = (key) => {
    keys.push(key);
    return {
      writeContract: async (args) => {
        sent.push({ write: args.functionName, address: args.address, args: args.args });
        return "0xhash";
      },
      sendTransaction: async (args) => {
        sent.push({ send: "eth", to: args.to, value: args.value });
        return "0xhash";
      },
    };
  };
  return { sent, keys, publicClient, walletFactory };
}

const chainWith = (f) => makeChain({ rpcUrl: "http://127.0.0.1:0", contract: CONTRACT, publicClient: f.publicClient, walletFactory: f.walletFactory });

test("the year runs on Base Sepolia only", () => {
  assert.equal(CHAIN_ID, 84532);
  assert.throws(() => makeChain({ rpcUrl: "http://127.0.0.1:0", contract: CONTRACT, chainId: 8453 }), /84532/);
});

// Every field decodeView reads has to still exist in the generated ABI: a
// regenerated ABI that renames one would otherwise decode to undefined.
test("viewOf's ABI still carries every field the adapter reads", () => {
  const fields = MRO_ABI.find((e) => e.name === "viewOf").outputs[0].components.map((c) => c.name);
  for (const name of ["level", "streak", "lastDay", "mintDay", "generation", "parent", "echo", "resting", "fellRun", "marks"]) {
    assert.ok(fields.includes(name), `viewOf no longer returns ${name}`);
  }
});

test("a view decodes to numbers, with the marks word kept as a BigInt", () => {
  const v = decodeView(view({ parent: 3n, echo: 120, resting: true, marks: 6n }));
  assert.deepEqual(v, {
    level: 40, streak: 9, lastDay: 1000, mintDay: 960, generation: 1,
    parent: 3, echo: 120, resting: true, marks: 6n, runFloor: 30, finisherPlace: 0,
  });
  assert.equal(typeof v.marks, "bigint");
});

// A FLOOR, not the contract's _effectiveRun: TokenView exposes only the run
// that most recently fell, so a shorter second lapse reads low.
test("runFloor is the longer of the live streak and the run that fell", () => {
  assert.equal(decodeView(view({ streak: 9, fellRun: 30 })).runFloor, 30);
  assert.equal(decodeView(view({ streak: 44, fellRun: 30 })).runFloor, 44);
  assert.equal(decodeView(view({ streak: 1, fellRun: 0 })).runFloor, 1);
  // The floor is below the longest run ever when a later, shorter run fell.
  assert.equal(decodeView(view({ streak: 3, fellRun: 12 })).runFloor, 12);
});

// Bits 32-63 hold the earned Iris's run, so a place read from the wrong shift
// would be a large number rather than an obviously wrong one.
test("the finishing place comes from bits 64-95, past the iris run", () => {
  const marks = (1n << 15n) | (100n << 32n) | (1n << 64n);
  assert.equal(decodeView(view({ marks })).finisherPlace, 1);
  assert.equal(decodeView(view({ marks: (365n << 32n) | (64n << 64n) })).finisherPlace, 64);
  assert.equal(decodeView(view({ marks: 365n << 32n })).finisherPlace, 0);
});

test("viewOf, today and seedsAvailable read the contract and answer as numbers", async () => {
  const f = fakes({ reads: { viewOf: view(), today: 1000, seedsAvailable: 1 } });
  const chain = chainWith(f);
  assert.equal((await chain.viewOf(7)).level, 40);
  assert.equal(await chain.today(), 1000);
  assert.equal(await chain.seedsAvailable(7), 1);
  assert.deepEqual(f.sent[0], { read: "viewOf", address: CONTRACT, args: [7n] });
  assert.deepEqual(f.sent[2], { read: "seedsAvailable", address: CONTRACT, args: [7n] });
});

test("a USDC balance is read from Circle's own contract, as base units", async () => {
  const f = fakes({ reads: { balanceOf: 2_500_000n } });
  assert.equal(await chainWith(f).usdcBalance(AGENT), 2_500_000n);
  assert.deepEqual(f.sent[0], { read: "balanceOf", address: USDC, args: [AGENT] });
});

test("USDC, ETH, an owner call and a transfer each send the call the runner meant", async () => {
  const f = fakes();
  const chain = chainWith(f);
  await chain.sendUsdc(KEY, AGENT, 1_000_000n);
  await chain.sendEth(KEY, AGENT, 500_000_000_000_000n);
  await chain.ownerCall(KEY, { contract: CONTRACT, function: "rebind", args: [7, `0x${"ab".repeat(32)}`] });
  await chain.transfer(KEY, AGENT, OTHER, 7);

  assert.deepEqual(f.sent, [
    { write: "transfer", address: USDC, args: [AGENT, 1_000_000n] },
    { send: "eth", to: AGENT, value: 500_000_000_000_000n },
    { write: "rebind", address: CONTRACT, args: [7, `0x${"ab".repeat(32)}`] },
    { write: "safeTransferFrom", address: CONTRACT, args: [AGENT, OTHER, 7n] },
  ]);
});

// A11's rebind is sent by a DIFFERENT wallet from its transfer, so a signer
// shared between sends would sign one of them as the wrong agent.
test("each send is signed with the key it was given, not one held from before", async () => {
  const f = fakes();
  const chain = chainWith(f);
  await chain.transfer(KEY, AGENT, OTHER, 7);
  await chain.ownerCall(KEY2, { contract: CONTRACT, function: "rest", args: [7] });
  await chain.sendEth(KEY, AGENT, 1n);
  assert.deepEqual(f.keys, [KEY, KEY2, KEY]);
});

// The Warden names the contract in the call it hands back; a Warden pointed at
// another deployment must not aim an owner call at it.
test("an owner call for another contract is refused rather than sent", async () => {
  const f = fakes();
  await assert.rejects(
    () => chainWith(f).ownerCall(KEY, { contract: OTHER, function: "rest", args: [7] }),
    /refusing an owner call/
  );
  assert.deepEqual(f.sent, []);
  // The same address in another case is the same contract.
  await chainWith(f).ownerCall(KEY, { contract: CONTRACT.toLowerCase(), function: "rest", args: [7] });
});

test("addressOf is the address a key signs as", () => {
  assert.match(addressOf(KEY), /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(addressOf(KEY), addressOf(KEY2));
  assert.equal(addressOf(KEY), addressOf(KEY));
});

// The owner call arrives from the Warden as JSON, so its token id is a plain
// number; safeTransferFrom is overloaded, and only the arity picks the one
// without calldata.
test("what the owner tools answer with encodes against the real ABI", () => {
  const keyId = `0x${"ab".repeat(32)}`;
  assert.match(encodeFunctionData({ abi: MRO_ABI, functionName: "rebind", args: [7, keyId] }), /^0x[0-9a-f]{136}$/);
  assert.match(encodeFunctionData({ abi: MRO_ABI, functionName: "rest", args: [7] }), /^0x[0-9a-f]{72}$/);
  assert.match(
    encodeFunctionData({ abi: MRO_ABI, functionName: "safeTransferFrom", args: [AGENT, OTHER, 7n] }),
    /^0x[0-9a-f]{200}$/
  );
});

// viem RESOLVES on a reverted transaction, so a send that only awaits its
// promise reports a revert as a success.
test("a reverted send throws rather than returning a receipt", async () => {
  const chain = chainWith(fakes({ status: "reverted" }));
  await assert.rejects(() => chain.sendUsdc(KEY, AGENT, 1n), /reverted/);
  await assert.rejects(() => chain.sendEth(KEY, AGENT, 1n), /reverted/);
  await assert.rejects(() => chain.ownerCall(KEY, { contract: CONTRACT, function: "rest", args: [7] }), /reverted/);
  await assert.rejects(() => chain.transfer(KEY, AGENT, OTHER, 7), /reverted/);
});

test("a confirmed send hands back the receipt", async () => {
  const receipt = await chainWith(fakes()).sendEth(KEY, AGENT, 1n);
  assert.equal(receipt.status, "success");
});
