// The run's one page: what it says per agent, which paths it calls proven, and
// that nothing from a log can escape into the markup as markup.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderReport, esc, markStatus, FADE_NOTE } from "../tools/year/report.mjs";

const state = { startDay: 1000, tokens: { A1: 1, A5: 5, child: 9 } };

/// Every table's row header IS the name, so a leading `<th>` finds the row the
/// test means -- where `>Hush<` would also match an agent's Marks-held cell.
const rowFor = (html, name) => html.split("\n").find((l) => l.startsWith(`<tr><th>${name}</th>`));

/// The last checker line for a token is where the report reads its final state.
const checked = (over = {}) => ({
  ts: "2026-09-26T00:00:00.000Z", chainDay: 1365, agent: "A1", tokenId: 1, ok: true,
  level: 365, streak: 365, place: 1, marks: String((1n << 2n) | (1n << 15n)), findings: [], ...over,
});

const marked = (over = {}) => ({
  ts: "2026-09-26T00:00:00.000Z", day: 1, chainDay: 1001, agent: "A5", tokenId: 5,
  action: "mark", ok: true, reason: null, markId: 1, outcome: "applied-queued",
  price: "1000000", settled: true, ...over,
});

test("an agent's row carries its final level, streak, place and the Marks it holds", () => {
  const html = renderReport([], [checked()], state);
  assert.match(html, /A1/);
  assert.match(html, /365\/365/);
  assert.match(html, /Apex/);
  // Ache is bit 2, and it is named rather than printed as a number.
  assert.match(html, /Ache/);
});

test("a token the Clock has not written yet reads as pending rather than as level zero", () => {
  const html = renderReport([], [checked({ pending: true, level: 0, streak: 0, place: 0, marks: "0" })], state);
  assert.match(html, /not on chain yet/);
  assert.ok(!/0\/365/.test(html), "a pending token has not lost a level");
});

test("a FAIL is counted against the agent that owns the token", () => {
  const html = renderReport([], [
    checked({ ok: false, findings: [{ field: "level", chain: 4, expected: 5, severity: "FAIL" }] }),
    checked({ ok: false, findings: [{ field: "streak", chain: 1, expected: 5, severity: "FAIL" }] }),
    checked({ agent: "A5", tokenId: 5, place: 0, marks: "0" }),
  ], state);
  const row = rowFor(html, "A1");
  assert.ok(row, "the agent's row is on its own line");
  assert.match(row, /class="fail">2</);
  assert.match(html, /chain 4/);
  assert.match(html, /expected 5/);
});

// PROVEN LIVE MEANS THE BIT IS ON CHAIN. An accepted order is a row in the
// mirror's queue, and a Mark ordered but never written is the failure this run
// exists to catch -- it must not read as the proof.
test("a Mark is proven live only when its bit is on chain, ordered or not", () => {
  const lines = [
    marked({ markId: 1, outcome: "applied-queued" }),
    marked({ markId: 7, outcome: "demand-only", settled: false, price: "1250000000" }),
  ];
  assert.equal(markStatus(lines, 1, new Set([1])), "proven live");
  assert.equal(markStatus(lines, 1), "ordered, not seen on chain");
  assert.equal(markStatus(lines, 1, new Set([2])), "ordered, not seen on chain");
  assert.equal(markStatus(lines, 7), "demand-only");
  assert.equal(markStatus(lines, 3), "not reached");
  // The bit outranks the order: a demand-only answer followed by a real purchase
  // the Clock wrote is proven live.
  assert.equal(markStatus([marked({ markId: 5, outcome: "demand-only" }), marked({ markId: 5 })], 5, new Set([5])), "proven live");

  // And through the page: the bit comes from a PASSING checker row's marks word.
  const ordered = renderReport(lines, [checked({ marks: "0" })], state);
  assert.match(rowFor(ordered, "Hush"), /ordered, not seen on chain/);
  const written = renderReport(lines, [checked({ marks: String(1n << 1n) })], state);
  assert.match(rowFor(written, "Hush"), /proven live/);
  assert.match(rowFor(written, "Vessel"), /demand-only/);
});

// A Mark bit read in a FAILING row is the value the finding is about, so it
// cannot be the evidence that the Mark landed.
test("a Mark bit seen only in a failing row is not proven live", () => {
  const lines = [marked({ markId: 1, outcome: "applied-queued" })];
  const html = renderReport(lines, [
    checked({ ok: false, marks: String(1n << 1n), place: 0, findings: [{ field: "level", chain: 4, expected: 5, severity: "FAIL" }] }),
  ], state);
  assert.match(rowFor(html, "Hush"), /ordered, not seen on chain/);
});

// A pass that died before it read anything has no token, and was filtered out of
// every count: a run whose every pass crashed read "Checker FAILs: 0".
test("a pass-level failure is counted and has a row of its own", () => {
  const crashed = (chainDay) => ({
    ts: "2026-09-27T00:00:00.000Z", chainDay, agent: null, tokenId: null, ok: false,
    findings: [{ field: "pass", chain: "HTTP request failed.", severity: "FAIL" }],
  });
  const html = renderReport([], [crashed(1001), crashed(null)], state);
  const summary = html.split("\n").find((l) => l.includes("class=\"fail\">2<"));
  assert.ok(summary, "both pass failures are in the FAIL total");
  const row = html.split("\n").find((l) => l.includes("pass: chain HTTP request failed."));
  assert.ok(row, "each pass failure has a findings row");
  assert.match(row, /<td>--<\/td><td>--<\/td>/);
  assert.ok(!/No token has ever differed/.test(html));
});

// The one agent whose absence most needs explaining is the one state.json holds
// no token for, and reading the table off state.json alone dropped it.
test("an agent that never minted still has a row", () => {
  const html = renderReport([], [checked()], { startDay: 1000, tokens: { A1: 1 } });
  const row = rowFor(html, "A7");
  assert.ok(row, "A7 minted nothing and is still on the page");
  assert.match(row, /never minted/);
  // Every scripted agent is there, and the child only once it has been seeded.
  for (const name of ["A1", "A4", "A9", "A12"]) assert.ok(rowFor(html, name), `${name} is missing`);
  assert.ok(!rowFor(html, "child"), "an unseeded child is not claimed as an agent");
  assert.ok(rowFor(renderReport([], [checked()], { startDay: 1000, tokens: { A1: 1, child: 9 } }), "child"));
});

test("the finisher places seen are proven live and the two the run cannot reach are not", () => {
  const html = renderReport([], [checked({ place: 1 }), checked({ agent: "A5", tokenId: 5, place: 5, marks: "8192" })], state);
  // A place read in a failing row proves nothing.
  const failing = renderReport([], [checked({ ok: false, place: 5, marks: "8192", findings: [{ field: "place", chain: 5, expected: 4, severity: "FAIL" }] })], state);
  assert.match(rowFor(failing, "Valve"), /not reached/);
  assert.match(rowFor(html, "Apex"), /proven live/);
  assert.match(rowFor(html, "Valve"), /proven live/);
  assert.match(rowFor(html, "Chamber"), /not reached/);
  assert.match(rowFor(html, "Aorta"), /not reached/);
});

test("a milestone the checker logged is a proven path, and its decode result is shown", () => {
  const html = renderReport([], [
    checked(),
    { ts: "t", chainDay: 1100, agent: "A1", tokenId: 1, milestone: "echo", decoded: true, exit: 0 },
    { ts: "t", chainDay: 1200, agent: "A9", tokenId: 9, milestone: "first-lapse", decoded: false, exit: 1 },
  ], state);
  assert.match(html, /echo/);
  assert.match(html, /1 decoded, 1 failed/);
});

// A full fade is the renderer's ink ladder, not a stored field: no read of a
// token can show it, so the report says so rather than claiming it was checked.
test("the report says the full fade is not observable from token state", () => {
  assert.match(renderReport([], [checked()], state), new RegExp(esc(FADE_NOTE).slice(0, 40)));
});

test("log text reaches the page as text, never as markup", () => {
  const nasty = "<script>alert(1)</script> & \"quoted\"";
  const html = renderReport(
    [marked({ ok: false, outcome: "none", reason: nasty })],
    [checked({ ok: false, findings: [{ field: nasty, chain: nasty, expected: nasty, severity: "FAIL" }] })],
    { ...state, tokens: { ...state.tokens, [nasty]: 7 } }
  );
  assert.ok(!html.includes("<script>"), "no raw script tag reaches the page");
  assert.match(html, /&lt;script&gt;/);
  assert.equal(esc("<a> & 'b' \"c\""), "&lt;a&gt; &amp; &#39;b&#39; &quot;c&quot;");
});

test("the page is self-contained and readable in both themes", () => {
  const html = renderReport([], [checked()], state);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /prefers-color-scheme: dark/);
  for (const pattern of [/src="http/, /href="http/, /@import/, /<script/]) {
    assert.ok(!pattern.test(html), `the page must not carry ${pattern}`);
  }
});

// A report is asked for at the worst moments: a run stopped before state.json was
// ever written, or one whose file holds nothing but a start day. The page must
// still render, because it is how an operator finds out what happened.
test("a state with no tokens at all still renders every scripted agent's row", () => {
  for (const empty of [{}, { startDay: 1000 }, { tokens: {} }]) {
    const html = renderReport([], [], empty);
    assert.match(html, /^<!doctype html>/);
    // Every one of the twelve is still named, each as never minted.
    for (const name of ["A1", "A12"]) assert.ok(rowFor(html, name), `${name} has no row`);
    assert.match(html, /never minted/);
  }
});

test("a gas-stop HOLD is counted on its own and proves no place", () => {
  const held = { chainDay: 5, agent: "A1", tokenId: 1, ok: true, hold: true, level: 9, streak: 9, place: 1, marks: "0", findings: [] };
  const html = renderReport([], [held], { tokens: { A1: 1 }, startDay: 1 });
  assert.match(html, /Gas-stop HOLDs/);
  assert.match(html, /<th>Apex<\/th><td>[^<]*<\/td><td class="thin">not reached<\/td>/,
    "a held row's place is stale, so it proves nothing");
});

test("a held row's findings are listed, marked HOLD, so a held value can be read", () => {
  const held = { chainDay: 5, agent: "A1", tokenId: 1, ok: true, hold: true, level: 9, streak: 9, place: 0, marks: "0",
    findings: [{ field: "level", chain: 9, expected: 10, severity: "HOLD" }] };
  const html = renderReport([], [held], { tokens: { A1: 1 }, startDay: 1 });
  assert.match(html, /<td>HOLD level: chain 9, expected 10<\/td>/);
  assert.doesNotMatch(html, /No token has ever differed/);
});

test("an answered check-in and a verified border are paths of their own", () => {
  const html = renderReport(
    [{ action: "checkin", ok: true, answered: true, tokenId: 1, chainDay: 3 }],
    [{ chainDay: 140, agent: "A2", tokenId: 1, milestone: "border-130", decoded: true, exit: 0 }],
    { tokens: { A2: 1 }, startDay: 1 },
  );
  assert.match(html, /<th>A check-in carrying an answer<\/th><td>proven live<\/td>/);
  assert.match(html, /<th>An answered day verified on chain \(level 130\)<\/th><td>proven live<\/td>/);
  assert.match(html, /<th>The whole border verified \(level 365\)<\/th><td class="thin">not reached<\/td>/);
});
