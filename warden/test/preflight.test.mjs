// The boot-time checks, 14.5 and 14.8.
//
// `main.mjs` cannot be imported -- it opens a database and binds a socket as a
// side effect of module load -- so the logic lives in chain/preflight.mjs and
// this suite drives it. Same arrangement as the Clock's DEPLOY_BLOCK check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { readChainId, verifyChainId, verifyDecoder, treasuryBalance } from "../src/chain/preflight.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MRO_ABI } from "../src/clock/abi.mjs";

const RPC = "https://rpc.example.invalid";
const TREASURY = "0x" + "11".repeat(20);

/// A fetch double that answers JSON-RPC from a table, and counts calls.
function rpcStub(answers) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    const answer = typeof answers === "function" ? answers(body, calls.length) : answers[body.method];
    if (answer === undefined || answer === null) throw new Error("network down");
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: answer }) };
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

test("readChainId decodes the hex the endpoint answers with", async () => {
  const { fetchImpl } = rpcStub({ eth_chainId: "0x14a34" });
  assert.equal(await readChainId({ rpcUrl: RPC, fetchImpl }), 84_532);
});

test("readChainId answers null for every failure shape, never a number", async () => {
  const cases = [
    async () => { throw new Error("connect ECONNREFUSED"); },
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ error: { message: "rate limited" } }) }),
    async () => ({ ok: true, json: async () => ({ result: 84532 }) }),   // not a string
    async () => ({ ok: true, json: async () => ({ result: "0x0" }) }),   // zero is not a chain
    async () => ({ ok: true, json: async () => { throw new Error("not json"); } }),
  ];
  for (const fetchImpl of cases) {
    assert.equal(await readChainId({ rpcUrl: RPC, fetchImpl }), null);
  }
});

test("a matching chain id starts, and asks exactly once", async () => {
  const { fetchImpl, calls } = rpcStub({ eth_chainId: "0x14a34" });
  assert.equal(await verifyChainId({ rpcUrl: RPC, chainId: 84_532, fetchImpl, sleep: noSleep }), 84_532);
  assert.equal(calls.length, 1);
});

// The copy-paste error this exists for: the RPC and the contract are moved to
// mainnet and MRO_CHAIN_ID is left behind on Sepolia.
test("a MISMATCH refuses to start, and does not retry -- it cannot become true", async () => {
  const { fetchImpl, calls } = rpcStub({ eth_chainId: "0x2105" }); // 8453, Base mainnet
  await assert.rejects(
    () => verifyChainId({ rpcUrl: RPC, chainId: 84_532, fetchImpl, sleep: noSleep }),
    /MRO_CHAIN_ID is 84532 but BASE_RPC_URL serves chain 8453/
  );
  assert.equal(calls.length, 1, "a fact is not retried");
});

test("an unreadable RPC is retried, and then refuses rather than trusting the configured id", async () => {
  const dead = async () => { throw new Error("network down"); };
  const logged = [];
  await assert.rejects(
    () => verifyChainId({ rpcUrl: RPC, chainId: 8453, fetchImpl: dead, sleep: noSleep, log: (m) => logged.push(m) }),
    /did not answer eth_chainId in 3 attempts/
  );
  assert.equal(logged.length, 3);
});

test("a transient outage that clears inside the attempts still starts", async () => {
  let n = 0;
  const flaky = async (_url, init) => {
    if (++n < 3) throw new Error("network down");
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x2105" }) };
  };
  assert.equal(
    await verifyChainId({ rpcUrl: RPC, chainId: 8453, fetchImpl: flaky, sleep: noSleep, log: () => {} }),
    8453
  );
});

// --- 14.8, the treasury -----------------------------------------------------

test("the treasury balance is read from the asset x402 itself would settle in", async () => {
  let seen = null;
  const fetchImpl = async (_url, init) => {
    seen = JSON.parse(init.body).params[0];
    // 2,500,000 units of a 6-decimal token.
    return { ok: true, json: async () => ({ result: "0x" + (2_500_000n).toString(16) }) };
  };
  const b = await treasuryBalance({ network: "eip155:84532", treasury: TREASURY, rpcUrl: RPC, fetchImpl });
  assert.equal(b.amount, "2.50");
  assert.equal(b.symbol, "USDC");
  // Base Sepolia USDC, from @x402/evm's own table rather than a copy here.
  assert.equal(b.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  // balanceOf(address), with the treasury as its one argument.
  assert.equal(seen.to, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  assert.equal(seen.data, "0x70a08231" + TREASURY.slice(2).toLowerCase().padStart(64, "0"));
});

test("a treasury balance that cannot be read is null, and never throws -- it is not a gate", async () => {
  const dead = async () => { throw new Error("network down"); };
  assert.equal(await treasuryBalance({ network: "eip155:8453", treasury: TREASURY, rpcUrl: RPC, fetchImpl: dead }), null);
  // An unknown network has no asset table entry, and that is not a crash
  // either. `eip155:1` is NOT such a network -- x402's table carries Ethereum
  // mainnet USDC, which this test asserted was absent until it was run.
  const { fetchImpl } = rpcStub({ eth_call: "0x0" });
  assert.equal(await treasuryBalance({ network: "eip155:999999", treasury: TREASURY, rpcUrl: RPC, fetchImpl }), null);
});

// The guard main.mjs applies to TREASURY_ADDRESS, pinned here because the shape
// of it was WRONG on the first attempt: `try { getAddress(a) } catch` can never
// fire, since viem re-checksums rather than throwing.
test("only the canonical EIP-55 form of an address equals itself", () => {
  const good = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  assert.equal(getAddress(good), good);
  // One character mistyped: still 40 hex characters, still a valid address, and
  // no longer its own canonical form.
  const typo = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02914";
  assert.notEqual(getAddress(typo), typo);
  // All lowercase carries no checksum at all, so it is refused too.
  assert.notEqual(getAddress(good.toLowerCase()), good.toLowerCase());
});

// --- the decoder probe, 2026-09-07 -----------------------------------------

// WHY THIS CHECK EXISTS. chain/read.mjs decodes `viewOf` through the generated
// ABI and returns null when the decode throws -- the SAME null a dead RPC
// produces -- so an ABI that disagrees with the deployed contract is
// indistinguishable from an outage at every call site, and takes out `mint`,
// `status`, `/t/<id>`, `boundKeyOf` and `freeIdFrom` with no log line anywhere.
// The skew is a property of (this build, that address) and cannot heal, so it
// is knowable at boot. These tests use FROZEN fixture bytes, not bytes encoded
// from the same ABI the probe decodes with: a re-encoding test moves
// symmetrically with any field change and stays green, which is the exact
// blindness that put the original defect in production.

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8").trim();

/// The 2026-09-06 deployment's token 1, as the chain returned it. SEVENTEEN
/// static fields: that contract predates the lineage `echo`.
const DEPLOYED_17 = fixture("viewof-token1-deployed.hex");
/// The EIGHTEEN-field shape this branch defines, token 7, frozen.
const POST_ECHO_18 = fixture("viewof-post-echo.hex");

const CONTRACT = "0x" + "22".repeat(20);
/// An endpoint with a provider API key in the path, as a managed provider
/// hands it out. No thrown message here may contain it.
const SECRET_RPC = "https://base-sepolia.g.alchemy.com/v2/notarealkey0000";

const answering = (result) => async () => ({
  ok: true,
  json: async () => ({ jsonrpc: "2.0", id: 1, result }),
});

test("verifyDecoder returns the decoded view when the shapes agree", async () => {
  const view = await verifyDecoder({
    rpcUrl: RPC, contract: CONTRACT, tokenId: 7, fetchImpl: answering(POST_ECHO_18),
  });
  assert.equal(Number(view.tokenId), 7);
  assert.equal(typeof view.echo, "number", "the field the deployed contract does not have");
});

test("verifyDecoder REFUSES on a contract whose TokenView has moved", async () => {
  await assert.rejects(
    verifyDecoder({ rpcUrl: RPC, contract: CONTRACT, tokenId: 1, fetchImpl: answering(DEPLOYED_17) }),
    (err) => {
      assert.match(err.message, /cannot decode viewOf/);
      assert.match(err.message, /clock\/abi\.mjs/, "the operator is told which file to regenerate");
      assert.ok(err.message.includes(CONTRACT), "and which deployment it disagreed with");
      return true;
    }
  );
});

test("verifyDecoder refuses an address with no contract code at all", async () => {
  await assert.rejects(
    verifyDecoder({ rpcUrl: RPC, contract: CONTRACT, fetchImpl: answering("0x") }),
    /cannot decode viewOf/
  );
});

// A decode that succeeds is not proof the shapes agree: a different struct can
// decode under this ABI and hand back plausible nonsense, which is precisely
// what the old index decoder did. `viewOf` echoes the id it was asked for, so
// one equality catches a return whose fields have slid.
test("verifyDecoder refuses a return that decodes but reports another token", async () => {
  await assert.rejects(
    verifyDecoder({ rpcUrl: RPC, contract: CONTRACT, tokenId: 1, fetchImpl: answering(POST_ECHO_18) }),
    /decoded, but reported tokenId 7/
  );
});

// SKEW IS A FACT, so it must not be retried: asking again cannot change it, and
// three tries would just slow the refusal down.
test("a decode failure is refused on the FIRST answer, with no retry", async () => {
  let calls = 0;
  const fetchImpl = async (...args) => { calls += 1; return answering(DEPLOYED_17)(...args); };
  await assert.rejects(verifyDecoder({ rpcUrl: RPC, contract: CONTRACT, fetchImpl, sleep: noSleep }));
  assert.equal(calls, 1);
});

// AN OUTAGE IS A TRANSIENT, so it is retried -- and then still refuses, exactly
// as verifyChainId does. Serving with an unverified decoder is the failure that
// looks like an outage forever; being down is the failure that ends.
test("an unreadable RPC is retried, then refuses to start", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("ECONNREFUSED"); };
  await assert.rejects(
    verifyDecoder({ rpcUrl: RPC, contract: CONTRACT, fetchImpl, sleep: noSleep, log: () => {} }),
    /did not answer viewOf/
  );
  assert.equal(calls, 3);
});

test("a transient outage that clears is not a refusal", async () => {
  let calls = 0;
  const fetchImpl = async (...args) => {
    calls += 1;
    if (calls < 3) throw new Error("ECONNREFUSED");
    return answering(POST_ECHO_18)(...args);
  };
  const view = await verifyDecoder({
    rpcUrl: RPC, contract: CONTRACT, tokenId: 7, fetchImpl, sleep: noSleep, log: () => {},
  });
  assert.equal(Number(view.tokenId), 7);
});

// The endpoint is the one secret in this configuration: every managed provider
// puts its API key in the url path. Neither the message nor the retry lines may
// carry it. Measured on viem 2.56.0: no decode error carries a url and
// metaMessages is undefined on all three shapes, because the call is made by
// hand with fetch and viem never sees the endpoint -- this pins that rather
// than trusting it.
test("nothing the probe says carries the RPC endpoint", async () => {
  const lines = [];
  await assert.rejects(
    verifyDecoder({
      rpcUrl: SECRET_RPC, contract: CONTRACT, fetchImpl: answering(DEPLOYED_17),
      log: (l) => lines.push(String(l)),
    }),
    (err) => {
      assert.ok(!err.message.includes("notarealkey0000"), "the API key must never reach an error");
      assert.ok(!err.message.includes("alchemy"), "nor the endpoint host");
      return true;
    }
  );
  await assert.rejects(
    verifyDecoder({
      rpcUrl: SECRET_RPC, contract: CONTRACT, sleep: noSleep,
      fetchImpl: async () => { throw new Error(`fetch failed: ${SECRET_RPC}`); },
      log: (l) => lines.push(String(l)),
    }),
    (err) => {
      assert.ok(!err.message.includes("notarealkey0000"));
      return true;
    }
  );
  for (const line of lines) assert.ok(!line.includes("notarealkey0000"), line);
});

// The state a redeploy boots into. `viewOf` does not revert on an unminted id
// (MachineReadableOnly.sol:198 reads storage that is zero), so the probe works
// on a contract with nothing minted -- which is what makes it usable as a boot
// check on the morning of a deploy rather than only afterwards.
test("verifyDecoder works against a contract with no tokens minted", async () => {
  const zeroView = "0x" + [
    (32).toString(16).padStart(64, "0"),            // tuple offset
    (5).toString(16).padStart(64, "0"),             // tokenId = 5
    ...Array.from({ length: 15 }, () => "0".repeat(64)), // 15 more static words
    (0).toString(16).padStart(64, "0"),             // today
    (18 * 32).toString(16).padStart(64, "0"),       // offset of `code`
    "0".repeat(64),                                 // code length 0
  ].join("");
  const view = await verifyDecoder({
    rpcUrl: RPC, contract: CONTRACT, tokenId: 5, fetchImpl: answering(zeroView),
  });
  assert.equal(Number(view.tokenId), 5);
  assert.equal(Number(view.level), 0, "an unminted token reads as level 0, not as a revert");
});

test("the probe decodes with the SAME abi module chain/read.mjs uses", () => {
  const fn = MRO_ABI.find((e) => e.type === "function" && e.name === "viewOf");
  assert.ok(fn, "viewOf must be in the generated ABI or the probe cannot run at all");
  const names = fn.outputs[0].components.map((c) => c.name);
  assert.ok(names.includes("echo"), "this branch's TokenView carries the Echo");
  assert.equal(names[0], "tokenId", "the probe's echo check depends on this being the id");
});
