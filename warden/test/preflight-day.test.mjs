// verifyDay: a Warden whose day length is not its contract's does not start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDay } from "../src/chain/preflight.mjs";

const RPC = "http://rpc.invalid";
const CONTRACT = "0x3E8A9D50C69c206df741A8d5BB78E66070A53020";

/// An RPC whose contract answers today() with `day`: one uint32, ABI-padded.
/// It also asserts the question, so a check that read the wrong function
/// could not pass by accident.
const answering = (day) => async (_url, init) => {
  const { method, params } = JSON.parse(init.body);
  assert.equal(method, "eth_call");
  assert.equal(params[0].data, "0xb74e452b", "it must ask today(), and nothing else");
  return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x" + day.toString(16).padStart(64, "0") }) };
};

test("a Warden whose day matches its contract's starts", async () => {
  const days = await verifyDay({ rpcUrl: RPC, contract: CONTRACT, fetchImpl: answering(20707), boxDay: 20707 });
  assert.deepEqual(days, { chainDay: 20707, boxDay: 20707 });
});

test("one day either side is a read straddling midnight, not a mismatch", async () => {
  await verifyDay({ rpcUrl: RPC, contract: CONTRACT, fetchImpl: answering(20708), boxDay: 20707 });
  await verifyDay({ rpcUrl: RPC, contract: CONTRACT, fetchImpl: answering(20706), boxDay: 20707 });
});

test("a five-minute contract read by a real-day Warden refuses to start", async () => {
  await assert.rejects(
    () => verifyDay({ rpcUrl: RPC, contract: CONTRACT, fetchImpl: answering(5_963_000), boxDay: 20707 }),
    /is not this contract's day length/
  );
});

test("an unreadable today() refuses rather than guessing", async () => {
  const silent = async () => ({ ok: false, json: async () => ({}) });
  await assert.rejects(
    () => verifyDay({ rpcUrl: RPC, contract: CONTRACT, fetchImpl: silent, boxDay: 20707 }),
    /did not answer today\(\)/
  );
});
