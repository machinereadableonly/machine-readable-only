// One owner action as one Safe transaction: the hash the devices show, the file
// the Safe website imports, and every refusal that keeps a bad call off a device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, toHex } from "viem";

import {
  DOMAIN_TYPEHASH, SAFE_TX_TYPEHASH, safeTxHashes, encodeAction, batchFile, prepare, txBuilderChecksum,
} from "../tools/safe-tx-lib.mjs";
import { MRO_ABI } from "../src/clock/abi.mjs";

const SAFE = getAddress("0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe");
const TOKEN = "0x1d72FD207e66F7449b2f9Bbfb80F62c2191F64F9";
const CLOCK = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SIGNERS = [
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
];

test("the type hashes are Safe's own type strings", () => {
  assert.equal(DOMAIN_TYPEHASH, keccak256(toHex("EIP712Domain(uint256 chainId,address verifyingContract)")));
  assert.equal(
    SAFE_TX_TYPEHASH,
    keccak256(toHex("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")),
  );
});

// Two independent derivations: the hand encoding the tool uses, and viem's
// general EIP-712 implementation.
test("the hand-encoded hash matches viem's EIP-712 hash", () => {
  const data = encodeFunctionData({ abi: MRO_ABI, functionName: "setWarden", args: [CLOCK] });
  const h = safeTxHashes({ chainId: 8453, safe: SAFE, to: TOKEN, data, nonce: 7n });
  const viem = hashTypedData({
    domain: { chainId: 8453, verifyingContract: SAFE },
    types: {
      SafeTx: [
        { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: TOKEN, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000", nonce: 7n,
    },
  });
  assert.equal(h.safeTxHash, viem);
  assert.notEqual(safeTxHashes({ chainId: 84532, safe: SAFE, to: TOKEN, data, nonce: 7n }).safeTxHash, viem, "the chain is in the hash");
  assert.notEqual(safeTxHashes({ chainId: 8453, safe: SAFE, to: TOKEN, data, nonce: 8n }).safeTxHash, viem, "so is the nonce");
});

test("an action encodes to the contract's own function", () => {
  assert.equal(encodeAction("accept-ownership", []), encodeFunctionData({ abi: MRO_ABI, functionName: "acceptOwnership" }));
  assert.equal(encodeAction("set-warden", [CLOCK]), encodeFunctionData({ abi: MRO_ABI, functionName: "setWarden", args: [CLOCK] }));
  assert.equal(encodeAction("set-supply-cap", ["500"]), encodeFunctionData({ abi: MRO_ABI, functionName: "setSupplyCap", args: [500] }));
  assert.equal(encodeAction("pause", []), encodeFunctionData({ abi: MRO_ABI, functionName: "pause" }));
});

test("an action refuses what it cannot encode exactly", () => {
  assert.throws(() => encodeAction("sunset", []), /unknown action/);
  assert.throws(() => encodeAction("set-warden", [CLOCK.toLowerCase()]), /EIP-55/);
  assert.throws(() => encodeAction("set-warden", []), /takes 1 argument/);
  assert.throws(() => encodeAction("pause", ["x"]), /takes 0 arguments/);
  for (const bad of ["-1", "1.5", "65536", "abc"]) assert.throws(() => encodeAction("set-supply-cap", [bad]), /supply cap/);
});

test("the batch file holds one raw call, every number a string", () => {
  const data = encodeAction("pause", []);
  const f = batchFile({ chainId: 8453, safe: SAFE, to: TOKEN, data, name: "pause" });
  assert.equal(f.chainId, "8453");
  assert.equal(f.meta.name, "pause");
  assert.equal(f.meta.createdFromSafeAddress, SAFE);
  assert.deepEqual(f.transactions, [{ to: TOKEN, value: "0", data }]);
  assert.equal(typeof f.createdAt, "number");
});

// The vector from the Transaction Builder's own checksum.test.js.
test("the checksum is the Transaction Builder's own", () => {
  const upstream = {
    version: "1.0", chainId: "4", createdAt: 1646321521061,
    meta: {
      name: "test batch file", txBuilderVersion: "1.4.0", checksum: "",
      createdFromSafeAddress: "0xDF8a1Ce35c9a6ACE153B4e0767942f1E2291a1Aa",
      createdFromOwnerAddress: "0x49d4450977E2c95362C13D3a31a09311E0Ea26A6",
    },
    transactions: [
      {
        to: "0x49d4450977E2c95362C13D3a31a09311E0Ea26A6", value: "0",
        contractMethod: { inputs: [{ internalType: "address", name: "paramAddress", type: "address" }], name: "testAddress", payable: false },
        contractInputsValues: { paramAddress: "0x49d4450977E2c95362C13D3a31a09311E0Ea26A6" },
      },
      {
        to: "0x49d4450977E2c95362C13D3a31a09311E0Ea26A6", value: "0",
        contractMethod: { inputs: [{ internalType: "bool", name: "paramBool", type: "bool" }], name: "testBool", payable: false },
        contractInputsValues: { paramAddress: "", paramBool: "false" },
      },
      {
        to: "0x49d4450977E2c95362C13D3a31a09311E0Ea26A6", value: "2000000000000000000",
        data: "0x42f4579000000000000000000000000049d4450977e2c95362c13d3a31a09311e0ea26a6",
      },
    ],
  };
  assert.equal(txBuilderChecksum(upstream), "0x4ecbfd364aa6759983915644e73f8bd411e85a2dc306f252a387c2728c4db64c");
});

// What validateChecksum does on import: drop the checksum, recompute, compare.
test("a written file passes the Transaction Builder's import check", () => {
  const f = JSON.parse(JSON.stringify(batchFile({ chainId: 8453, safe: SAFE, to: TOKEN, data: encodeAction("pause", []), name: "pause" })));
  const { checksum, ...meta } = f.meta;
  assert.match(checksum, /^0x[0-9a-f]{64}$/);
  assert.equal(txBuilderChecksum({ ...f, meta }), checksum);
  assert.notEqual(txBuilderChecksum({ ...f, meta, transactions: [{ ...f.transactions[0], to: CLOCK }] }), checksum);
});

/// A chain as the tool reads it, with the Safe as owner and a 2-of-3 threshold.
function chain(over = {}) {
  const state = {
    chainId: 8453, owner: SAFE, pendingOwner: "0x0000000000000000000000000000000000000000",
    threshold: 2n, owners: SIGNERS, warden: CLOCK, nonce: 3n, simulate: "ok", version: "1.5.0", ...over,
  };
  return {
    async chainId() { return state.chainId; },
    async version() { if (state.version === null) throw new Error("reverted"); return state.version; },
    async owner() { return state.owner; },
    async warden() { return state.warden; },
    async pendingOwner() { return state.pendingOwner; },
    async threshold() { return state.threshold; },
    async owners() { return state.owners; },
    async nonce() { return state.nonce; },
    async simulate() { if (state.simulate !== "ok") throw new Error(state.simulate); },
    async safeHash(args) {
      return state.safeHash ?? safeTxHashes({ chainId: state.chainId, safe: SAFE, ...args }).safeTxHash;
    },
  };
}

test("a prepared transaction carries the file and all three hashes", async () => {
  const NEXT = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
  const r = await prepare({ reader: chain(), action: "set-warden", args: [NEXT], contract: TOKEN, safe: SAFE });
  const want = safeTxHashes({ chainId: 8453, safe: SAFE, to: TOKEN, data: encodeAction("set-warden", [NEXT]), nonce: 3n });
  assert.deepEqual(r.hashes, want);
  assert.equal(r.nonce, 3n);
  assert.equal(r.file.transactions.length, 1);
});

test("accept-ownership needs the Safe to be the pending owner", async () => {
  const pending = chain({ owner: CLOCK, pendingOwner: SAFE });
  await prepare({ reader: pending, action: "accept-ownership", args: [], contract: TOKEN, safe: SAFE });
  await assert.rejects(
    prepare({ reader: chain({ owner: CLOCK }), action: "accept-ownership", args: [], contract: TOKEN, safe: SAFE }),
    /pending owner/,
  );
});

test("every other action needs the Safe to be the owner", async () => {
  await assert.rejects(
    prepare({ reader: chain({ owner: CLOCK }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /is not the owner/,
  );
});

test("a Safe one signer can drive is refused", async () => {
  await assert.rejects(
    prepare({ reader: chain({ threshold: 1n }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /threshold 1/,
  );
});

test("a call that would revert never reaches a device", async () => {
  await assert.rejects(
    prepare({ reader: chain({ simulate: "execution reverted" }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /would revert/,
  );
});

test("a chain other than Base or Base Sepolia is refused", async () => {
  await assert.rejects(
    prepare({ reader: chain({ chainId: 1 }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /chain 1/,
  );
});

test("a local hash the Safe contract disagrees with is refused", async () => {
  await assert.rejects(
    prepare({ reader: chain({ safeHash: "0x" + "ab".repeat(32) }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /does not match/,
  );
});

test("a Safe version the hash was not checked against is refused", async () => {
  await assert.rejects(
    prepare({ reader: chain({ version: "1.3.0" }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /version 1.3.0/,
  );
});

test("an address that is not a Safe is named as such", async () => {
  await assert.rejects(
    prepare({ reader: chain({ version: null }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /is not a Safe/,
  );
});

test("the Clock key must never be one of the Safe's signers", async () => {
  await assert.rejects(
    prepare({ reader: chain({ owners: [SIGNERS[0], SIGNERS[1], CLOCK] }), action: "pause", args: [], contract: TOKEN, safe: SAFE }),
    /is one of the Safe's signers/,
  );
  for (const next of [SAFE, SIGNERS[2]]) {
    await assert.rejects(
      prepare({ reader: chain(), action: "set-warden", args: [next], contract: TOKEN, safe: SAFE }),
      /the Clock key must be separate/,
    );
  }
});

test("the remaining owner actions prepare on the same path", async () => {
  for (const [action, args] of [["set-renderer", [CLOCK]], ["set-supply-cap", ["500"]], ["unpause", []]]) {
    const r = await prepare({ reader: chain(), action, args, contract: TOKEN, safe: SAFE });
    assert.equal(r.file.transactions[0].data, encodeAction(action, args));
  }
});
