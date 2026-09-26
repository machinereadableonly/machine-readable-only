// The run's one page: what it says per agent, which paths it calls proven, and
// that nothing from a log can escape into the markup as markup.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderReport, esc, markStatus, FADE_NOTE } from "../tools/year/report.mjs";

const state = { startDay: 1000, tokens: { A1: 1, A5: 5, child: 9 } };

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
  const row = html.split("\n").find((l) => l.includes(">A1<"));
  assert.ok(row, "the agent's row is on its own line");
  assert.match(row, /class="fail">2</);
  assert.match(html, /chain 4/);
  assert.match(html, /expected 5/);
});

test("a Mark paid for reads proven live, a Mark only quoted reads demand-only, one never asked reads not reached", () => {
  const lines = [
    marked({ markId: 1, outcome: "applied-queued" }),
    marked({ markId: 7, outcome: "demand-only", settled: false, price: "1250000000" }),
  ];
  assert.equal(markStatus(lines, 1), "proven live");
  assert.equal(markStatus(lines, 7), "demand-only");
  assert.equal(markStatus(lines, 3), "not reached");
  // A demand-only answer followed by a real purchase is proven live.
  assert.equal(markStatus([marked({ markId: 5, outcome: "demand-only" }), marked({ markId: 5 })], 5), "proven live");
  const html = renderReport(lines, [checked()], state);
  assert.match(html, /Hush/);
  assert.match(html, /Vessel/);
});

test("the finisher places seen are proven live and the two the run cannot reach are not", () => {
  const html = renderReport([], [checked({ place: 1 }), checked({ agent: "A5", tokenId: 5, place: 5, marks: "8192" })], state);
  const rowFor = (name) => html.split("\n").find((l) => l.includes(`>${name}<`));
  assert.match(rowFor("Apex"), /proven live/);
  assert.match(rowFor("Valve"), /proven live/);
  assert.match(rowFor("Chamber"), /not reached/);
  assert.match(rowFor("Aorta"), /not reached/);
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
