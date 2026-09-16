// Can the address an agent named actually HOLD the token it is paying for?
//
// WHY THIS EXISTS (F5, found on a Base mainnet fork 2026-09-15). `mint` ends
// in `_safeMint`, which calls `onERC721Received` on any recipient WITH CODE
// and reverts unless it answers the magic value 0x150b7a02. The Warden took
// the 1 USDC without ever asking, so a mint to such an address was charged
// for, queued, and then reverted on simulate every night forever -- and the
// check-in queued behind it was condemned `NoSuchToken` with it.
//
// The live shape is not exotic. anvil's stock test accounts carry an EIP-7702
// delegation inherited from real mainnet (code `0xef0100` followed by the
// delegate address), and every mint to one failed on the fork. Agent wallets
// are moving towards exactly this.
//
// THE THREE ANSWERS ARE DELIBERATELY DISTINCT and the middle one is the whole
// point of the file:
//   true   an ordinary wallet, or a contract that answered the magic value
//   false  it has code and will NOT accept the token -- a real answer
//   null   we could not ask -- NOT the same as "no", and the gate refuses
//          with `chain-unavailable` so the agent retries rather than being
//          told its perfectly good wallet is broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeChainReader } from "../src/chain/read.mjs";

const RPC = "https://rpc.example/";
const CONTRACT = "0x" + "aa".repeat(20);
const TO = "0x" + "11".repeat(20);

/// A bytes4 return sits LEFT-aligned in a 32-byte word.
const MAGIC = "0x150b7a02" + "00".repeat(28);
const ZEROS = "0x" + "00".repeat(32);
/// An EIP-7702 delegation: the marker, then the delegate's address.
const DELEGATED_CODE = "0xef0100" + "8a67b502".padEnd(40, "0");

/**
 * A transport that answers eth_getCode with `code` and eth_call with `call`.
 *
 * `call` may be the literal string "revert" for an execution revert, or
 * "transport" for a dead provider, so a test can drive the difference between
 * "it said no" and "it did not answer".
 */
function rpc({ code = "0x", call = MAGIC } = {}, counts = { getCode: 0, ethCall: 0 }) {
  const impl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "eth_getCode") {
      counts.getCode += 1;
      if (code === "transport") throw new Error("dead");
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: code }) };
    }
    counts.ethCall += 1;
    if (call === "transport") throw new Error("dead");
    if (call === "revert") {
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted" } }),
      };
    }
    if (call === "rate-limited") {
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "rate limit exceeded" } }),
      };
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: call }) };
  };
  impl.counts = counts;
  return impl;
}

const reader = (fetchImpl) => makeChainReader({ rpcUrl: RPC, contract: CONTRACT, fetchImpl, log: () => {} });

test("an address with no code is an ordinary wallet, and is not asked anything further", async () => {
  // The overwhelming majority of --to addresses. `_safeMint` makes no callback
  // to a codeless address, so neither does this: a second round trip per mint
  // for a question with a known answer is pure latency.
  const impl = rpc({ code: "0x" });
  assert.equal(await reader(impl).canReceiveERC721(TO), true);
  assert.equal(impl.counts.ethCall, 0, "a codeless address must not be called");
});

test("a contract that answers the magic value can receive", async () => {
  // Safe's TokenCallbackHandler and solady's Receiver (which Coinbase Smart
  // Wallet inherits) both answer exactly this, checked against their sources
  // on 2026-09-16.
  assert.equal(await reader(rpc({ code: "0x60006000", call: MAGIC })).canReceiveERC721(TO), true);
});

test("a contract that answers something else CANNOT receive", async () => {
  assert.equal(await reader(rpc({ code: "0x60006000", call: ZEROS })).canReceiveERC721(TO), false);
});

test("a contract whose callback REVERTS cannot receive", async () => {
  // An execution revert is an ANSWER, not a failure to ask. This is the case
  // the fork actually hit.
  assert.equal(await reader(rpc({ code: "0x60006000", call: "revert" })).canReceiveERC721(TO), false);
});

test("an EIP-7702 delegated wallet with no callback cannot receive", async () => {
  // The measured case, by its real code shape rather than an invented one.
  const impl = rpc({ code: DELEGATED_CODE, call: "revert" });
  assert.equal(await reader(impl).canReceiveERC721(TO), false);
  assert.equal(impl.counts.ethCall, 1, "a delegated EOA has code, so it must be asked");
});

test("an EIP-7702 delegated wallet WHOSE delegate accepts can receive", async () => {
  // The inverse, so this is a test of the callback and not of the 0xef0100
  // prefix. Delegating is not itself disqualifying.
  assert.equal(await reader(rpc({ code: DELEGATED_CODE, call: MAGIC })).canReceiveERC721(TO), true);
});

test("a short or truncated return is not a magic value", async () => {
  assert.equal(await reader(rpc({ code: "0x60006000", call: "0x150b" })).canReceiveERC721(TO), false);
});

// --- "could not ask" is null, and null is not "no" -------------------------

test("a dead provider answers null on the code read, never false", async () => {
  assert.equal(await reader(rpc({ code: "transport" })).canReceiveERC721(TO), null);
});

test("a dead provider answers null on the callback read, never false", async () => {
  assert.equal(await reader(rpc({ code: "0x60006000", call: "transport" })).canReceiveERC721(TO), null);
});

test("a rate-limited provider is null, NOT a refusal", async () => {
  // The distinction this file exists for, and the fragile part of it: a revert
  // and a node error both arrive as a JSON-RPC error object on a 200. They are
  // told apart by the error, and getting it wrong in THIS direction would tell
  // an agent with a perfectly good Safe that its wallet cannot hold the token.
  // Erring the other way only costs a retry.
  assert.equal(await reader(rpc({ code: "0x60006000", call: "rate-limited" })).canReceiveERC721(TO), null);
});

test("the callback is simulated AS THE TOKEN CONTRACT, the way _safeMint makes it", async () => {
  // A receiver may check `msg.sender` and accept only from the collection it
  // expects. Simulating from the default (the zero address) would answer a
  // different question from the one the mint will actually ask.
  let seen = null;
  const impl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "eth_getCode") {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x60006000" }) };
    }
    seen = body.params[0];
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: MAGIC }) };
  };
  await reader(impl).canReceiveERC721(TO);
  assert.equal(seen.to.toLowerCase(), TO.toLowerCase(), "the callback goes to the RECIPIENT");
  assert.equal(seen.from.toLowerCase(), CONTRACT.toLowerCase(), "and comes from the token contract");
  assert.ok(seen.data.startsWith("0x150b7a02"), "onERC721Received's selector IS the magic value");
});
