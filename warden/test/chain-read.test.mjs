// Decoding a real `viewOf` return.
//
// WHY THIS FILE EXISTS. Until 2026-09-06 src/chain/read.mjs pulled fields out
// of the `viewOf` return by hard-coded tuple index, from a comment that
// described a FOURTEEN-field TokenView. Plan 6 had made it seventeen
// (sunsetDay, fellRun, fellDay) and nothing updated the constants, so
// `agentKeyId` was read from index 11 -- which is `fellRun`, and is zero.
// `boundKeyOf` therefore returned the zero key, `bindingBlock` compared that
// against the caller's real key, and EVERY `upgrade` and EVERY `seed` on the
// live site was refused with `not-bound-to-caller`. No Mark could be bought.
//
// Nothing in the suite caught it because every other test stubs `boundKeyOf`.
// This is the first test that has ever decoded a real return, and the fixture
// is a genuine one: `viewof-token1-deployed.hex` was captured by eth_call
// against 0xe032054D54b407C52C49c40A423aC79031401C03, token 1, which wears
// Hush. See [[stubs-hide-interface-drift]], third occurrence.
//
// The fixtures are FROZEN BYTES, not encoded at test time. That is the whole
// guard: a test that re-encoded its input from the same ABI the reader decodes
// with would move symmetrically with any field-order change and stay green,
// which is exactly the blindness that put the defect in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeChainReader } from "../src/chain/read.mjs";
import { MRO_ABI } from "../src/clock/abi.mjs";

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8").trim();

/// Token 1 of the 2026-09-06 Base Sepolia deployment, as the chain returned it.
/// SEVENTEEN static fields: this contract predates Task 1's `echo`.
const DEPLOYED = fixture("viewof-token1-deployed.hex");

/// The EIGHTEEN-field shape this branch defines, encoded once and frozen.
const POST_ECHO = fixture("viewof-post-echo.hex");

/// Read off the chain, not off our own decoder. This is the assertion that
/// would have caught the live defect.
const TOKEN1_KEY = "0x4eaddc8cfcdd27223821e3e31ab54b2416dd3b0c1a86afd7e8d6538ca1bd0a77";
const POST_ECHO_KEY = "0xa17e5f9b3c2d48e06a7b1c9d5e3f820a4b6c8d1e2f30415263748596a7b8c9d0";
const ZERO_KEY = "0x" + "00".repeat(32);

/// The deployed contract's `viewOf`, which is this branch's minus `echo`.
/// Derived rather than transcribed so the delta is visible as one field, and
/// so a rename or reorder in MRO_ABI turns the frozen bytes below red.
const DEPLOYED_ABI = MRO_ABI.map((entry) => {
  if (entry.type !== "function" || entry.name !== "viewOf") return entry;
  const out = structuredClone(entry);
  out.outputs[0].components = out.outputs[0].components.filter((c) => c.name !== "echo");
  return out;
});

/// A reader whose every eth_call answers with one fixed return.
function readerFor(hex, abi) {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result: hex }),
  });
  return makeChainReader({
    rpcUrl: "http://rpc.invalid",
    contract: "0x" + "11".repeat(20),
    fetchImpl,
    log: () => {},
    ...(abi ? { abi } : {}),
  });
}

// --- the bug, in the raw bytes ---------------------------------------------

// No decoder involved. This pins WHY the old code was wrong, straight off the
// wire, so the reason survives even if every decoder here is replaced.
test("the deployed return holds the key at word 14 and zero at word 11", () => {
  const words = DEPLOYED.slice(2).match(/.{64}/g);
  // Word 0 is the dynamic tuple's offset (0x20), so tuple field N is word N+1.
  assert.equal(BigInt("0x" + words[0]), 32n, "leading word should be the tuple offset");
  assert.equal("0x" + words[1 + 14], TOKEN1_KEY, "field 14 is agentKeyId");
  assert.equal(BigInt("0x" + words[1 + 11]), 0n, "field 11 is fellRun -- what the old FIELD map read");
  assert.equal(BigInt("0x" + words[1 + 13]), 2n, "field 13 is marks: token 1 wears Hush");
});

// --- the deployed (17-field) shape -----------------------------------------

test("boundKeyOf returns the key the deployed contract actually holds for token 1", async () => {
  const chain = readerFor(DEPLOYED, DEPLOYED_ABI);
  const key = await chain.boundKeyOf(1);
  assert.notEqual(key, ZERO_KEY, "the live defect: boundKeyOf read fellRun and returned the zero key");
  assert.equal(key, TOKEN1_KEY);
});

test("lifecycleOf reads the deployed token 1 by name", async () => {
  const chain = readerFor(DEPLOYED, DEPLOYED_ABI);
  assert.deepEqual(await chain.lifecycleOf(1), {
    exists: true,
    resting: false,
    sunset: false,
    level: 1,
    lastDay: 20702,
  });
});

// --- the shape this branch defines -----------------------------------------

test("boundKeyOf reads the eighteen-field struct this branch defines", async () => {
  const chain = readerFor(POST_ECHO);
  assert.equal(await chain.boundKeyOf(7), POST_ECHO_KEY);
});

test("lifecycleOf reads the eighteen-field struct this branch defines", async () => {
  const chain = readerFor(POST_ECHO);
  assert.deepEqual(await chain.lifecycleOf(7), {
    exists: true,
    resting: true,
    sunset: false,
    level: 41,
    lastDay: 20800,
  });
});

// --- the refusal direction -------------------------------------------------

// The security control. Null must always mean "could not ask", so that
// bindingBlock refuses rather than admits. A return whose shape disagrees with
// the ABI is precisely the case the old code got wrong: it returned a
// confident, wrong answer instead of nothing.
test("a return whose shape disagrees with the ABI is null, never a wrong key", async () => {
  const chain = readerFor(DEPLOYED); // 17 fields of data, 18 in the ABI
  assert.equal(await chain.boundKeyOf(1), null);
  assert.equal(await chain.lifecycleOf(1), null);
});

test("a return too short to be a TokenView is null", async () => {
  const chain = readerFor("0x");
  assert.equal(await chain.boundKeyOf(1), null);
  assert.equal(await chain.lifecycleOf(1), null);
});

test("an RPC that cannot be reached is null, not an answer", async () => {
  const chain = makeChainReader({
    rpcUrl: "http://rpc.invalid",
    contract: "0x" + "11".repeat(20),
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    log: () => {},
  });
  assert.equal(await chain.boundKeyOf(1), null);
  assert.equal(await chain.lifecycleOf(1), null);
});

test("a JSON-RPC error object on a 200 is null, not an answer", async () => {
  const chain = makeChainReader({
    rpcUrl: "http://rpc.invalid",
    contract: "0x" + "11".repeat(20),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "reverted" } }),
    }),
    log: () => {},
  });
  assert.equal(await chain.boundKeyOf(1), null);
  assert.equal(await chain.lifecycleOf(1), null);
});

// --- telling the two failures apart ----------------------------------------

// WHY THIS MATTERS MORE THAN IT LOOKS. Both failures above return the same
// null and neither used to write a line, so ABI skew was indistinguishable
// from a provider outage from outside the process: every tool answering
// `chain-unavailable`, indefinitely, with nothing anywhere saying which. The
// two have opposite responses -- wait out an outage, correct a deploy -- so
// the log line IS the difference.

/// The endpoint, with an API key in the path, exactly as a managed provider
/// hands it out. Nothing logged may contain it. See clock/redact.mjs.
const SECRET_RPC = "https://base-sepolia.g.alchemy.com/v2/notarealkey0000";

function capturing(fetchImpl, extra = {}) {
  const lines = [];
  const chain = makeChainReader({
    rpcUrl: SECRET_RPC,
    contract: "0x" + "11".repeat(20),
    fetchImpl,
    log: (line) => lines.push(String(line)),
    ...extra,
  });
  return { chain, lines };
}

test("a decode failure says it is NOT an outage, and names the ABI file", async () => {
  // 17 fields of data against the 18-field ABI: real skew, real bytes.
  const { chain, lines } = capturing(async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result: DEPLOYED }),
  }));
  assert.equal(await chain.boundKeyOf(1), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /NOT AN RPC OUTAGE/);
  assert.match(lines[0], /warden\/src\/clock\/abi\.mjs/);
});

test("the decode line is written once, not once per request", async () => {
  const { chain, lines } = capturing(async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result: DEPLOYED }),
  }));
  for (let i = 0; i < 5; i += 1) await chain.lifecycleOf(1);
  assert.equal(lines.length, 1, "skew cannot heal inside a process, so one line is the whole story");
});

test("a transport failure logs a DIFFERENT line, and never the endpoint", async () => {
  const { chain, lines } = capturing(async () => {
    throw new Error(`fetch failed: ${SECRET_RPC}`);
  });
  assert.equal(await chain.boundKeyOf(1), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /transport/);
  assert.doesNotMatch(lines[0], /NOT AN RPC OUTAGE/);
  assert.ok(!lines[0].includes("notarealkey0000"), "the API key must never reach a log");
  assert.ok(!/https?:\/\//.test(lines[0]), "no url at all in the transport line");
});

test("the transport line is rate limited, because an outage recurs", async () => {
  let clock = 1_000_000;
  const { chain, lines } = capturing(
    async () => {
      throw new Error("ECONNREFUSED");
    },
    { now: () => clock }
  );
  await chain.boundKeyOf(1);
  await chain.boundKeyOf(1);
  assert.equal(lines.length, 1, "a second failure in the same minute is silent");
  clock += 61_000;
  await chain.boundKeyOf(1);
  assert.equal(lines.length, 2, "and it speaks again once the window has passed");
});

test("an HTTP error and a JSON-RPC error are transport failures, not skew", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ error: { code: -32000, message: "limited" } }) }),
    async () => ({ ok: true, json: async () => { throw new Error("not JSON"); } }),
  ]) {
    const { chain, lines } = capturing(fetchImpl);
    assert.equal(await chain.boundKeyOf(1), null);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /transport/);
  }
});
