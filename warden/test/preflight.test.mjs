// The boot-time checks, 14.5 and 14.8.
//
// `main.mjs` cannot be imported -- it opens a database and binds a socket as a
// side effect of module load -- so the logic lives in chain/preflight.mjs and
// this suite drives it. Same arrangement as the Clock's DEPLOY_BLOCK check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { readChainId, verifyChainId, treasuryBalance } from "../src/chain/preflight.mjs";

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
