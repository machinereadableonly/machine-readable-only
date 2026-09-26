// The twelve agents of the accelerated year, as data. Every behaviour the run
// depends on is asserted here rather than read off the table by eye.
import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENTS, todayFor } from "../tools/year/scenario.mjs";

const byName = (name) => {
  const agent = AGENTS.find((a) => a.name === name);
  assert.ok(agent, `no agent named ${name}`);
  return agent;
};

test("twelve agents, A1 to A12, each with a mint day, a miss rule and Marks", () => {
  assert.equal(AGENTS.length, 12);
  assert.deepEqual(
    AGENTS.map((a) => a.name),
    ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"],
  );
  for (const a of AGENTS) {
    assert.equal(typeof a.mintDay, "number", `${a.name} mintDay`);
    assert.ok(Number.isInteger(a.mintDay) && a.mintDay >= 0, `${a.name} mintDay`);
    assert.equal(typeof a.misses, "function", `${a.name} misses`);
    assert.ok(Array.isArray(a.marks), `${a.name} marks`);
    for (const m of a.marks) {
      assert.ok(Number.isInteger(m.id) && m.id >= 1 && m.id <= 10, `${a.name} mark id ${m.id}`);
      // A missing `when` is not tolerated: a Mark with no gate would be ordered
      // on the first day, before the token could possibly qualify.
      assert.equal(typeof m.when, "object", `${a.name} mark ${m.id} has no when`);
      assert.notEqual(m.when, null, `${a.name} mark ${m.id} when is null`);
      assert.ok(
        m.when.level !== undefined || m.when.run !== undefined,
        `${a.name} mark ${m.id} has no level or run gate`,
      );
    }
  }
});

// The owner field is an ARRAY: A11 takes two actions on consecutive days, so a
// single record could not hold its script.
test("owner is an array of dated actions, or absent", () => {
  for (const a of AGENTS) {
    if (a.owner === undefined) continue;
    assert.ok(Array.isArray(a.owner), `${a.name} owner`);
    for (const o of a.owner) {
      assert.equal(typeof o.day, "number", `${a.name} owner day`);
      assert.ok(["transfer", "rebind", "rest"].includes(o.kind), `${a.name} owner kind ${o.kind}`);
    }
  }
});

test("A1 mints on D0 and checks in from D1, never on the day it mints", () => {
  const a1 = byName("A1");
  assert.equal(a1.mintDay, 0);
  assert.deepEqual(todayFor(a1, 0), { mint: true, checkin: false, owner: null });
  assert.deepEqual(todayFor(a1, 1), { mint: false, checkin: true, owner: null });
  assert.deepEqual(todayFor(a1, 2), { mint: false, checkin: true, owner: null });
  assert.equal(todayFor(a1, 365).checkin, true);
});

// The mint is written with the day the agent PAID and the contract sets lastDay
// to it, so the mint day is the token's first credit and the day after it is
// already a day the chain accepts.
test("nobody checks in on or before its mint day, and everybody does the day after", () => {
  for (const a of AGENTS) {
    for (let day = 0; day <= a.mintDay; day++) {
      assert.equal(todayFor(a, day).checkin, false, `${a.name} checked in on D${day}`);
    }
    assert.equal(todayFor(a, a.mintDay + 1).checkin, true, `${a.name} skipped its first day`);
  }
});

test("only the mint day carries mint, and only an owner day carries owner", () => {
  for (const a of AGENTS) {
    const ownerDays = new Set((a.owner ?? []).map((o) => o.day));
    for (let day = 0; day <= 130; day++) {
      const t = todayFor(a, day);
      assert.equal(t.mint, day === a.mintDay, `${a.name} mint on D${day}`);
      assert.equal(t.owner !== null, ownerDays.has(day), `${a.name} owner on D${day}`);
    }
  }
});

// The whole year, not the first forty days: a miss rule that drifted late in
// the run would have gone unseen, and A8's finishing day is set by how many it
// misses over the whole 365.
test("A8 misses every tenth day from D13, and nothing else, all year", () => {
  const a8 = byName("A8");
  assert.equal(a8.mintDay, 3);
  const missed = [];
  for (let day = 4; day <= 400; day++) if (!todayFor(a8, day).checkin) missed.push(day);
  // First missed day 13, then every tenth: written out independently of the
  // rule, so the test cannot pass by repeating the same arithmetic.
  assert.deepEqual(missed, Array.from({ length: 39 }, (_, i) => 13 + i * 10));
  assert.equal(missed.at(-1), 393);
  assert.equal(todayFor(a8, 4).checkin, true);
  assert.equal(todayFor(a8, 12).checkin, true);
  assert.equal(todayFor(a8, 14).checkin, true);
});

test("A9 checks in from D4 to D53, is away D54 to D113, and returns on D114", () => {
  const a9 = byName("A9");
  assert.equal(a9.mintDay, 3);
  for (let day = 4; day <= 53; day++) {
    assert.equal(todayFor(a9, day).checkin, true, `A9 missed D${day}`);
  }
  for (let day = 54; day <= 113; day++) {
    assert.equal(todayFor(a9, day).checkin, false, `A9 checked in on D${day}`);
  }
  for (let day = 114; day <= 120; day++) {
    assert.equal(todayFor(a9, day).checkin, true, `A9 missed D${day}`);
  }
});

test("A10 rests on D120, and a rested token never checks in again", () => {
  const a10 = byName("A10");
  assert.deepEqual(a10.owner, [{ day: 120, kind: "rest" }]);
  assert.equal(todayFor(a10, 120).owner, "rest");
  assert.equal(todayFor(a10, 119).owner, null);
  // Resting is a fact about the token, so the runner hands it in.
  assert.equal(todayFor(a10, 121, { rested: false }).checkin, true);
  assert.equal(todayFor(a10, 121, { rested: true }).checkin, false);
  assert.equal(todayFor(a10, 300, { rested: true }).checkin, false);
});

test("A11 transfers to A12 on D50 and the token is rebound on D51", () => {
  const a11 = byName("A11");
  assert.deepEqual(a11.owner, [
    { day: 50, kind: "transfer", to: "A12" },
    { day: 51, kind: "rebind" },
  ]);
  assert.equal(todayFor(a11, 50).owner, "transfer");
  assert.equal(todayFor(a11, 51).owner, "rebind");
  assert.equal(todayFor(a11, 52).owner, null);
  // A11 carries on checking in either side of the handover.
  assert.equal(todayFor(a11, 50).checkin, true);
  assert.equal(todayFor(a11, 52).checkin, true);
});

test("A12 mints on D20, the late finisher, and is the address A11 transfers to", () => {
  const a12 = byName("A12");
  assert.equal(a12.mintDay, 20);
  assert.equal(todayFor(a12, 20).mint, true);
  assert.equal(todayFor(a12, 20).checkin, false);
  assert.equal(todayFor(a12, 21).checkin, true);
  const target = byName("A11").owner.find((o) => o.kind === "transfer").to;
  assert.ok(AGENTS.some((a) => a.name === target), `A11 transfers to unknown ${target}`);
});

test("A1 is the only agent that seeds", () => {
  assert.deepEqual(AGENTS.filter((a) => a.seeds).map((a) => a.name), ["A1"]);
});

// A Mark that waits on another Mark names it by id, and that Mark must be one
// the same agent actually asks for, or the wait never ends.
test("every `after` dependency is a Mark the same agent orders", () => {
  for (const a of AGENTS) {
    const ids = new Set(a.marks.map((m) => m.id));
    for (const m of a.marks) {
      if (m.after === undefined) continue;
      assert.ok(ids.has(m.after), `${a.name} mark ${m.id} waits on unordered ${m.after}`);
    }
  }
});
