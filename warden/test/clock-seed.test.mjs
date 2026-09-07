// The Clock's seed pass: the free creation route, and the rule for what to do
// when the chain will not take it.
//
// THE ONE RULE THIS FILE DEFENDS. A key earns ONE seed per completed
// agent-year, and the mirror row IS the reservation -- `seedsSpent` counts
// `tokens.parentId IS NOT NULL` -- so the budget is spent the moment a child is
// reserved, before anything reaches the chain. That makes the classification of
// a failure the whole feature:
//
//   a seed the chain will NEVER accept must be DROPPED, which hands the year
//   back, because leaving it holds a budget the chain never agreed was spent;
//
//   a seed that merely failed THIS TIME must be KEPT, because an unnamed
//   failure does not say the transaction was refused -- `receipt-unknown` says
//   it was BROADCAST and may yet land. Dropping there deletes the mirror's only
//   record of a child that exists on chain, and nothing heals that: reconcile
//   only LOGS `Seeded`, so `/t/<childId>` would 404 for the life of the piece
//   while the chain's own `_seedsSpent` stayed incremented.
//
// So only a NAMED revert can be permanent, and only some named reverts are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { MRO_ABI } from "../src/clock/abi.mjs";
import { runClock } from "../src/clock/run.mjs";
import { exitCodeFor } from "../src/clock/cursor.mjs";
import { DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

const FLOOR = DEPLOY_BLOCK[84532];
const TODAY = 20_700;
/// 172 bytes, which is CODE_BYTES. A shorter one is what BadCodeLength is for.
const QR = "ab".repeat(172);
const PARENT_OWNER = "0x" + "11".repeat(20);
const CHILD_OWNER = "0x" + "22".repeat(20);

function mirror() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// A founding token exactly as a real one arrives: a tokens row plus a mint
/// that was reserved against a payment nonce and then settled.
function parentToken(q, { tokenId = 1, keyId = "k", owner = PARENT_OWNER } = {}) {
  q.insertToken({ tokenId, keyId, owner, lastDay: TODAY - 1, mintDay: TODAY - 400 });
  seedPaidMint(q, { tokenId, toAddress: owner, keyId });
}

/// Encoding is not decoration. On 2026-09-03 the Clock handed a base64url key
/// id to a bytes32 parameter and every test still passed, because no double had
/// ever tried to encode the call. `seed` takes no bytes32 at all, but it does
/// take an address and a `bytes`, and this is what proves those are right.
function assertEncodable(functionName, args) {
  try {
    encodeFunctionData({ abi: MRO_ABI, functionName, args });
  } catch (e) {
    assert.fail(`${functionName} args are not ABI-encodable: ${e.shortMessage ?? e.message}`);
  }
}

/// A writer that records every call and answers `fail` to the seed.
///
/// `fail` is either a contract error name -- which arrives as the ONLY shape
/// that carries an errorName, `reverted-on-simulate` -- or one of the unnamed
/// failures write.mjs can return.
function writerThat(fail) {
  const sent = [];
  const unnamed = {
    network: { ok: false, reason: "send-failed", detail: "fetch failed" },
    "gas-estimate-failed": { ok: false, reason: "gas-estimate-failed", detail: "timeout" },
    "receipt-unknown": { ok: false, reason: "receipt-unknown", hash: "0xdead", detail: "timeout" },
    "reverted-on-chain": { ok: false, reason: "reverted-on-chain", hash: "0xdead", receipt: {} },
    "no-name": { ok: false, reason: "reverted-on-simulate", detail: "execution reverted" },
  };
  return {
    sent,
    formatGas: (w) => `${w} wei`,
    async gasOk() { return { ok: true, gasPrice: 6_000_000n, capWei: 50_000_000n }; },
    async startRun() { return 0; },
    async send(functionName, args, opts) {
      assertEncodable(functionName, args);
      sent.push({ functionName, args, label: opts?.label });
      if (!fail || functionName !== "seed") return { ok: true, hash: `0x${sent.length}` };
      if (unnamed[fail]) return unnamed[fail];
      return { ok: false, reason: "reverted-on-simulate", errorName: fail, errorArgs: [] };
    },
  };
}

const noChain = {
  async getBlockNumber() { return FLOOR; },
  async getLogs() { return []; },
};

/// A chain that holds token `childId` for some owner and some parent, so the
/// Clock can tell ITS OWN seed apart from a stranger's token at the same id.
const chainHolding = ({ owner, parent }) => ({
  ...noChain,
  async readContract({ functionName }) {
    if (functionName === "ownerOf") return owner;
    if (functionName === "viewOf") return { parent: BigInt(parent), lastDay: 0 };
    throw new Error(`unexpected read: ${functionName}`);
  },
});

/// A chain that cannot be read at all. NEITHER "it is mine" NOR "it is not".
const blindChain = {
  ...noChain,
  async readContract() { throw new Error("rpc down"); },
};

/// One child reserved against parent 1, its bitmap in whatever state is asked
/// for. Separate from seedRig so a test can queue a SECOND child, which is the
/// only way an assertion about the loop stopping can discriminate at all.
function reserveChild(q, db, childId, { solveState = "done" } = {}) {
  q.insertSeed({ childId, parentId: 1, toAddress: CHILD_OWNER, keyId: "k", lastDay: TODAY, mintDay: TODAY });
  db.prepare("UPDATE mints SET qr = ?, solveState = ? WHERE tokenId = ?").run(QR, solveState, childId);
}

/**
 * A parent with children reserved against it, solved and waiting.
 *
 * `solveState` is the bitmap knob: a child whose bitmap never solved is the
 * stuckSeeds case, and it must never be sent, because the contract takes `code`
 * once and keeps it forever.
 *
 * `children` is how many are queued. It defaults to one because most tests are
 * about what happens to ONE row, and the run-level tests ask for two because
 * "the loop stopped" is not a claim a single row can support.
 */
function seedRig({ fail = null, solveState = "done", children = 1 } = {}) {
  const { db, q } = mirror();
  parentToken(q);
  for (let i = 0; i < children; i += 1) reserveChild(q, db, 2 + i, { solveState });
  return { db, q, writer: writerThat(fail) };
}

const baseArgs = (q) => ({
  q,
  publicClient: noChain,
  contract: "0xcontract",
  chainId: 84532,
  today: TODAY,
  log: () => {},
  alert: () => {},
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a queued seed is sent as seed(), not mint()", async () => {
  const { q, writer } = seedRig();
  const summary = await runClock({ ...baseArgs(q), writer });

  assert.equal(writer.sent.length, 1, "exactly one write");
  assert.equal(writer.sent[0].functionName, "seed", "a child is created by seed, never by mint");
  assert.deepEqual(writer.sent[0].args, [2n, 1n, CHILD_OWNER, `0x${QR}`]);
  assert.deepEqual(summary.seeded, [2]);
  assert.deepEqual(summary.droppedSeeds, []);
  assert.equal(q.getToken(2).status, "written");
  assert.equal(q.seedsSpent("k"), 1, "the chain took it, so the seed stays spent");
});

test("running twice writes the child exactly once", async () => {
  const { q, writer } = seedRig();
  await runClock({ ...baseArgs(q), writer });
  await runClock({ ...baseArgs(q), writer });
  assert.equal(writer.sent.filter((s) => s.functionName === "seed").length, 1);
});

test("seeds are written after mints and before check-ins", async () => {
  // A parent that is credited in the same run it seeds: the order matters for
  // the same reason mints precede check-ins.
  const { db, q, writer } = seedRig();
  q.insertCredit(1, TODAY - 1, "sig");
  await runClock({ ...baseArgs(q), writer });
  const order = writer.sent.map((s) => s.functionName);
  assert.deepEqual(order, ["seed", "batchCheckIn"]);
  assert.equal(db.prepare("SELECT status FROM credits WHERE tokenId = 1").get().status, "written");
});

// ---------------------------------------------------------------------------
// Permanent: the chain will never take this, so the year goes back
// ---------------------------------------------------------------------------

// Each of these is a NAMED revert whose condition no later run can clear, and
// the reasoning for each is written beside the allowlist in run.mjs. A named
// revert also proves nothing was broadcast, so dropping cannot orphan a child.
for (const errorName of [
  "Resting",                 // `rest` has no inverse anywhere in the contract
  "NoSeedAvailable",         // the CHAIN says this key has no unspent seed
  "IdTooLarge",              // the child id is stored; the ceiling is constant
  "BadCodeLength",           // the stored bitmap's length; CODE_BYTES is constant
  "ERC721InvalidReceiver",   // `to` is stored, and the child can go nowhere else
]) {
  test(`${errorName} drops the row and returns the budget`, async () => {
    const { q, writer } = seedRig({ fail: errorName });
    const said = [];
    const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => said.push(m) });

    assert.equal(q.getToken(2), undefined, "the child is gone");
    assert.equal(q.seedsSpent("k"), 0, "and the seed is spendable again");
    assert.deepEqual(summary.droppedSeeds, [2]);
    assert.deepEqual(summary.seeded, []);
    assert.ok(said.some((a) => a.includes(errorName) && /available again/.test(a)));
  });
}

// ---------------------------------------------------------------------------
// Transient: it failed tonight, and tonight is not forever
// ---------------------------------------------------------------------------

// HOW TO BREAK THIS ONE, because a control that cannot go red measures nothing.
// The brief said to add "network" to the permanent list and watch this fail. It
// does NOT fail: isFinalSeed gates on `reason === "reverted-on-simulate"`
// BEFORE it looks at any name, and a network failure arrives as `send-failed`,
// so the name never gets read. Break it at the reason level instead --
// `if (result.reason === "send-failed") return true;` at the top of isFinalSeed
// turns this red, and adding ParentNotWhole or SupplyCap to the list turns
// their own tests red. All three were run.
test("a transient failure keeps the row for the next run", async () => {
  const { q, writer } = seedRig({ fail: "network" });
  const summary = await runClock({ ...baseArgs(q), writer });

  assert.ok(q.getToken(2), "an RPC outage must not burn a year's seed");
  assert.equal(q.seedsSpent("k"), 1);
  assert.deepEqual(summary.droppedSeeds, []);
  assert.deepEqual(summary.seeded, []);
  assert.equal(q.getToken(2).status, "queued", "so tomorrow's run sends it again");
});

// receipt-unknown is the reason the whole rule is written the way it is: the
// transaction WAS broadcast and may yet land. Dropping here would delete the
// mirror's only record of a child that exists on chain, and reconcile cannot
// heal it -- it only logs `Seeded`.
for (const fail of ["gas-estimate-failed", "receipt-unknown", "reverted-on-chain", "no-name"]) {
  test(`an unnamed failure (${fail}) is never permanent`, async () => {
    const { q, writer } = seedRig({ fail });
    const summary = await runClock({ ...baseArgs(q), writer });
    assert.ok(q.getToken(2), `${fail} does not say the chain refused this seed`);
    assert.equal(q.seedsSpent("k"), 1);
    assert.deepEqual(summary.droppedSeeds, []);
  });
}

// THE BRIEF CALLED THIS PERMANENT AND THE CONTRACT SAYS OTHERWISE. `seed`
// refuses a parent below level 365, and `level` is only ever `+= 1`
// (MachineReadableOnly.sol:417) -- there is no path in the contract that lowers
// it. A parent at 364 tonight is whole tomorrow night.
test("ParentNotWhole keeps the row, because a parent's level only ever rises", async () => {
  const { q, writer } = seedRig({ fail: "ParentNotWhole" });
  const summary = await runClock({ ...baseArgs(q), writer });
  assert.ok(q.getToken(2), "a parent one day short is not a parent that never qualifies");
  assert.deepEqual(summary.droppedSeeds, []);
});

// Both compare against an OWNER DIAL -- setSupplyCap and setWalletCap -- and a
// dial that can be raised is a dial a later run can pass. The test is not
// whether the AGENT can act on it; it is whether any later run could succeed.
for (const errorName of ["SupplyCap", "WalletCap"]) {
  test(`${errorName} keeps the row, because the owner can raise the dial`, async () => {
    const { q, writer } = seedRig({ fail: errorName });
    const summary = await runClock({ ...baseArgs(q), writer });
    assert.ok(q.getToken(2));
    assert.deepEqual(summary.droppedSeeds, []);
  });
}

// ---------------------------------------------------------------------------
// TokenExists has three answers, and only the chain knows which
// ---------------------------------------------------------------------------

test("a child the chain already holds AS THIS SEED is marked written", async () => {
  const { q, writer } = seedRig({ fail: "TokenExists" });
  const said = [];
  const summary = await runClock({
    ...baseArgs(q),
    writer,
    publicClient: chainHolding({ owner: CHILD_OWNER, parent: 1 }),
    alert: (m) => said.push(m),
  });

  assert.equal(q.getToken(2).status, "written", "a previous run landed it and the mirror was behind");
  assert.deepEqual(summary.droppedSeeds, [], "it must NOT be dropped: the chain spent the seed");
  assert.equal(q.seedsSpent("k"), 1);
  assert.ok(said.some((a) => /already on chain as this seed/.test(a)));
});

test("a child id held by SOMEBODY ELSE'S token is dropped, and the year comes back", async () => {
  const { q, writer } = seedRig({ fail: "TokenExists" });
  const summary = await runClock({
    ...baseArgs(q),
    writer,
    publicClient: chainHolding({ owner: "0x" + "99".repeat(20), parent: 7 }),
  });

  assert.equal(q.getToken(2), undefined, "that id is taken for good");
  assert.equal(q.seedsSpent("k"), 0, "so the agent can seed again under a fresh id");
  assert.deepEqual(summary.droppedSeeds, [2]);
});

test("a child id that cannot be identified on chain is KEPT, never dropped on a guess", async () => {
  const { q, writer } = seedRig({ fail: "TokenExists" });
  const said = [];
  const summary = await runClock({
    ...baseArgs(q),
    writer,
    publicClient: blindChain,
    alert: (m) => said.push(m),
  });

  assert.ok(q.getToken(2), "an unreadable chain is NEITHER answer");
  assert.equal(q.seedsSpent("k"), 1);
  assert.deepEqual(summary.droppedSeeds, []);
  assert.ok(said.some((a) => /could not be identified/.test(a)));
});

// ---------------------------------------------------------------------------
// Run-level: one refusal must not become a hundred deletions
// ---------------------------------------------------------------------------

// TWO CHILDREN, and that is the whole point of the count below. With one
// queued, `sent.length === 1` is true whether the loop breaks or runs to the
// end, so the assertion reads as a control and is not one -- flipping `break`
// to `continue` in run.mjs left all 26 tests green. With two, the count
// discriminates: break sends one, continue sends both.
for (const errorName of ["NotWarden", "EnforcedPause", "Sunset"]) {
  test(`${errorName} aborts the run, drops nothing, and stops the queue`, async () => {
    const { q, writer } = seedRig({ fail: errorName, children: 2 });
    const summary = await runClock({ ...baseArgs(q), writer });

    assert.equal(summary.aborted, errorName);
    assert.ok(q.getToken(2), "the piece being shut is not this row's fault");
    assert.ok(q.getToken(3), "nor the next row's");
    assert.equal(q.seedsSpent("k"), 2, "both reservations survive");
    assert.deepEqual(summary.droppedSeeds, []);
    assert.deepEqual(
      writer.sent.filter((s) => s.functionName === "seed").map((s) => s.args[0]),
      [2n],
      "the SECOND child was never attempted: one refusal must not become a hundred"
    );
  });
}

test("a seed is not attempted at all once the mint pass has aborted", async () => {
  const { db, q } = seedRig();
  // A paid mint that aborts the run before the seed pass is reached.
  q.insertToken({ tokenId: 3, keyId: "k3", owner: PARENT_OWNER, lastDay: TODAY, mintDay: TODAY });
  seedPaidMint(q, { tokenId: 3, toAddress: PARENT_OWNER, keyId: "k3" });
  db.prepare("UPDATE mints SET qr = ?, solveState = 'done' WHERE tokenId = 3").run(QR);
  const writer = {
    ...writerThat(null),
    sent: [],
    async send(functionName, args) {
      assertEncodable(functionName, args);
      this.sent.push({ functionName, args });
      return { ok: false, reason: "reverted-on-simulate", errorName: "EnforcedPause" };
    },
  };
  const summary = await runClock({ ...baseArgs(q), writer });

  assert.equal(summary.aborted, "EnforcedPause");
  assert.deepEqual(writer.sent.map((s) => s.functionName), ["mint"], "the seed was never sent");
  assert.ok(q.getToken(2));
});

// ---------------------------------------------------------------------------
// A child whose artwork never solved
// ---------------------------------------------------------------------------

test("a child whose bitmap failed to solve is reported and NOT sent", async () => {
  const { q, writer } = seedRig({ solveState: "failed" });
  const said = [];
  const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => said.push(m) });

  assert.equal(writer.sent.length, 0, "the contract takes `code` once and keeps it forever");
  assert.deepEqual(summary.stuckSeeds, [2]);
  assert.ok(q.getToken(2), "and it is NOT dropped: only a human decides to give the year back");
  assert.ok(said.some((a) => /seed/.test(a) && /needs a human/.test(a)));
  assert.ok(said.every((a) => !/paid/i.test(a)), "nobody paid for a seed; do not send anyone looking for a refund");
});

test("a stuck seed makes the run report failure to systemd", () => {
  assert.equal(exitCodeFor({ stuck: [], stuckCredits: [], stuckSeeds: [2], aborted: null }), 1);
  assert.equal(exitCodeFor({ stuck: [], stuckCredits: [], stuckSeeds: [], aborted: null }), 0);
  // A DROPPED seed is not a failure: it is a completed, self-healing outcome --
  // the year is already back and the agent can ask again.
  assert.equal(exitCodeFor({ stuck: [], stuckCredits: [], droppedSeeds: [2], aborted: null }), 0);
});

test("CONTROL: an empty seed queue sends nothing and reports nothing", async () => {
  const { q } = mirror();
  parentToken(q);
  const writer = writerThat(null);
  const summary = await runClock({ ...baseArgs(q), writer });
  assert.equal(writer.sent.length, 0);
  assert.deepEqual(summary.seeded, []);
  assert.deepEqual(summary.droppedSeeds, []);
  assert.deepEqual(summary.stuckSeeds, []);
});

