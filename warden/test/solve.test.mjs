import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { claimNext, completeSolve, failSolve, runSolver, requeueOrphans, MAX_TRIES } from "../src/solve/queue.mjs";

function withMint() {
  const db = openDb(":memory:");
  const q = queries(db);
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (1, '0xabc', 'k1')").run();
  return { db, q };
}

test("a pending mint is claimed once and only once", () => {
  const { q } = withMint();
  assert.equal(claimNext(q).tokenId, 1);
  assert.equal(claimNext(q), null, "a claimed row must not be handed out again");
});

test("a completed solve stores the bitmap and stops being pending", () => {
  const { q } = withMint();
  claimNext(q);
  completeSolve(q, 1, "0xdeadbeef");
  assert.equal(q.getMint(1).qr, "0xdeadbeef");
  assert.equal(q.getMint(1).solveState, "done");
});

test("a failed solve is retried, and alerts on the third failure", () => {
  const { q } = withMint();
  const alerts = [];
  for (let i = 0; i < MAX_TRIES; i++) {
    claimNext(q);
    failSolve(q, 1, (msg) => alerts.push(msg));
  }
  assert.equal(alerts.length, 1, "exactly one alert, on the last try");
  assert.equal(q.getMint(1).solveState, "failed");
  assert.equal(claimNext(q), null, "a failed row must not spin forever");
});

test("runSolver drains every pending row, one claim at a time", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (1, '0xabc', 'k1')").run();
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (2, '0xabc', 'k1')").run();

  const claimed = [];
  const spawn = async (tokenId) => {
    claimed.push(tokenId);
    return { hex: `deadbeef${tokenId}` };
  };

  await runSolver(q, spawn);

  assert.deepEqual(claimed, [1, 2], "rows are drained in order, one at a time");
  assert.equal(q.getMint(1).solveState, "done");
  assert.equal(q.getMint(1).qr, "deadbeef1");
  assert.equal(q.getMint(2).solveState, "done");
  assert.equal(q.getMint(2).qr, "deadbeef2");
});

test("runSolver retries a failing row up to MAX_TRIES, then moves on without looping forever", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (1, '0xabc', 'k1')").run();
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId) VALUES (2, '0xabc', 'k1')").run();

  let attempts = 0;
  const spawn = async (tokenId) => {
    if (tokenId === 1) { attempts++; throw new Error("solve failed"); }
    return { hex: "deadbeef2" };
  };

  await runSolver(q, spawn, () => {});

  assert.equal(attempts, MAX_TRIES, "the failing row is retried exactly MAX_TRIES times");
  assert.equal(q.getMint(1).solveState, "failed");
  assert.equal(q.getMint(2).solveState, "done", "a permanently-failing row must not block the rest of the queue");
});

test("requeueOrphans returns a row stuck in 'solving' to 'pending', and it can then be claimed", () => {
  const { db, q } = withMint();
  db.prepare("UPDATE mints SET solveState = 'solving' WHERE tokenId = 1").run();

  const changed = requeueOrphans(q);

  assert.equal(changed, 1, "exactly one orphaned row was requeued");
  assert.equal(q.getMint(1).solveState, "pending");
  assert.equal(claimNext(q).tokenId, 1, "the requeued row is claimable again");
});

test("requeueOrphans does not touch 'done' or 'failed' rows", () => {
  const db = openDb(":memory:");
  const q = queries(db);
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId, solveState) VALUES (1, '0xabc', 'k1', 'done')").run();
  db.prepare("INSERT INTO mints (tokenId, toAddress, keyId, solveState) VALUES (2, '0xabc', 'k1', 'failed')").run();

  const changed = requeueOrphans(q);

  assert.equal(changed, 0, "a version that reset everything would wrongly report changes here");
  assert.equal(q.getMint(1).solveState, "done");
  assert.equal(q.getMint(2).solveState, "failed");
});

test("requeueOrphans on a queue with nothing solving changes nothing", () => {
  const { q } = withMint();
  const changed = requeueOrphans(q);
  assert.equal(changed, 0);
  assert.equal(q.getMint(1).solveState, "pending");
});
