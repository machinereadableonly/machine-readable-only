// The Builder Code reaches the chain through the REAL writer.
//
// clock-run.test.mjs drives the Clock through a writer double, which cannot
// see calldata at all. This drives the real makeWriter().send() through real
// viem clients whose transport is a fake node, and reads back the exact bytes
// viem put in the eth_call, the eth_estimateGas and the signed raw transaction.
// So a misspelled option, or a call site that drops the suffix, fails here --
// a double that only records arguments would agree with either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { MRO_ABI } from "../src/clock/abi.mjs";
import { makeWriter } from "../src/clock/write.mjs";
import { BUILDER_CODE, builderCodeSuffix } from "../src/clock/builder-code.mjs";

// A made-up code in Base's shape. Never a real one: a real code in a test would
// be one more place to update, and would read as the piece's own.
const TEST_CODE = "bc_test1234";

// ERC-8021 schema 0, rebuilt by hand from the code alone: the code's ASCII
// bytes, its 1-byte length, the schema id 0x00, the 16-byte marker 0x8021 x8.
const HAND_BUILT =
  "0x" +
  Buffer.from(TEST_CODE, "ascii").toString("hex") +
  TEST_CODE.length.toString(16).padStart(2, "0") +
  "00" +
  "8021".repeat(8);

// A throwaway key that controls nothing, used only to sign against the fake node.
const TEST_KEY = "0x" + "11".repeat(32);
const CONTRACT = "0x" + "c0".repeat(20);
const TX_HASH = "0x" + "ab".repeat(32);

/// A node that answers just enough for one send() and records the calldata of
/// every request that carries some.
function fakeNode() {
  const seen = { call: [], estimate: [], raw: [] };
  const block = {
    number: "0x10",
    hash: "0x" + "01".repeat(32),
    parentHash: "0x" + "02".repeat(32),
    timestamp: "0x1",
    baseFeePerGas: "0x1",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: "0x" + "00".repeat(20),
    transactions: [],
  };
  const receipt = {
    transactionHash: TX_HASH,
    blockHash: block.hash,
    blockNumber: "0x10",
    status: "0x1",
    gasUsed: "0x5208",
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: [],
    logsBloom: "0x" + "00".repeat(256),
    from: privateKeyToAccount(TEST_KEY).address,
    to: CONTRACT,
    contractAddress: null,
    transactionIndex: "0x0",
    type: "0x2",
  };
  async function request({ method, params }) {
    switch (method) {
      case "eth_chainId": return "0x" + baseSepolia.id.toString(16);
      case "eth_getTransactionCount": return "0x0";
      case "eth_call": seen.call.push(params[0].data ?? params[0].input); return "0x";
      case "eth_estimateGas": seen.estimate.push(params[0].data ?? params[0].input); return "0x5208";
      case "eth_getBlockByNumber": return block;
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_gasPrice": return "0x1";
      case "eth_sendRawTransaction": seen.raw.push(params[0]); return TX_HASH;
      case "eth_getTransactionReceipt": return receipt;
      case "eth_blockNumber": return "0x10";
      default: throw new Error(`fake node: unexpected ${method}`);
    }
  }
  return { seen, transport: custom({ request }) };
}

function writerFor(builderCode) {
  const node = fakeNode();
  const writer = makeWriter({
    contract: CONTRACT,
    chainId: baseSepolia.id,
    publicClient: createPublicClient({ chain: baseSepolia, transport: node.transport }),
    walletClient: createWalletClient({
      account: privateKeyToAccount(TEST_KEY),
      chain: baseSepolia,
      transport: node.transport,
    }),
    builderCode,
    log: () => {},
  });
  return { writer, seen: node.seen };
}

// One of the four functions the Clock sends; the other three go through the
// same send(), and the contracts suite covers all four on the chain side.
const FN = "applyMark";
const ARGS = [1n, 1, 0];
const PLAIN = encodeFunctionData({ abi: MRO_ABI, functionName: FN, args: ARGS });

test("the suffix is ERC-8021 schema 0, identical to one rebuilt by hand", () => {
  assert.equal(builderCodeSuffix(TEST_CODE), HAND_BUILT);
  assert.equal((HAND_BUILT.length - 2) / 2, 29, "29 bytes for an 11-character code");
});

// Pinned on purpose. The day Base issues the piece's code, set BUILDER_CODE and
// change this assertion to the issued code -- see DEPLOY.md section 10.
test("no code has been issued yet, so there is no suffix", () => {
  assert.equal(BUILDER_CODE, null);
  assert.equal(builderCodeSuffix(), undefined);
});

test("a code not in Base's bc_... form is refused rather than attached", () => {
  for (const bad of ["BC_TEST1234", "bc-test1234", "bc_", " bc_test1234", "test1234"]) {
    assert.throws(() => builderCodeSuffix(bad), /not in Base's bc_/, `accepted ${JSON.stringify(bad)}`);
  }
});

test("with a code, the simulate, the estimate and the signed transaction all carry it", async () => {
  const { writer, seen } = writerFor(TEST_CODE);
  await writer.startRun();
  const result = await writer.send(FN, ARGS);
  assert.equal(result.ok, true, `send() failed: ${result.reason} ${result.detail ?? ""}`);

  const expected = PLAIN + HAND_BUILT.slice(2);
  assert.deepEqual(seen.call, [expected], "eth_call (simulate)");
  assert.deepEqual(seen.estimate, [expected], "eth_estimateGas");
  assert.equal(seen.raw.length, 1, "one raw transaction sent");
  assert.equal(parseTransaction(seen.raw[0]).data, expected, "the signed transaction's calldata");
});

test("with no code, every call is byte-identical to the plain encoding", async () => {
  const { writer, seen } = writerFor(null);
  await writer.startRun();
  const result = await writer.send(FN, ARGS);
  assert.equal(result.ok, true, `send() failed: ${result.reason} ${result.detail ?? ""}`);

  assert.deepEqual(seen.call, [PLAIN]);
  assert.deepEqual(seen.estimate, [PLAIN]);
  assert.equal(parseTransaction(seen.raw[0]).data, PLAIN);
});
