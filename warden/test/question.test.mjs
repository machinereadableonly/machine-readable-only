import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertBankSane, questionFor, answerIndex, publicShape } from "../src/mcp/question.mjs";

const BANK = JSON.parse(readFileSync(new URL("./fixtures/question-bank.json", import.meta.url), "utf8"));
const byId = (id) => BANK.find((q) => q.id === id);

test("the fixture bank is sane", () => { assert.equal(assertBankSane(BANK), BANK); });

test("a malformed bank is refused, entry by entry", () => {
  const bad = [
    [{ id: "a", text: "x", answers: ["one"] }],
    [{ id: "a", text: "x", answers: Array.from({ length: 17 }, (_, i) => `o${i}`) }],
    [{ id: "a", text: "x", answers: ["same", "SAME"] }],
    [{ id: "a", text: "x", range: { min: 0, max: 101 } }],
    [{ id: "a", text: "x", range: { min: 5, max: 5 } }],
    [{ id: "a", text: "x" }],
    [{ id: "a", text: "x", answers: ["a", "b"] }, { id: "a", text: "y", answers: ["a", "b"] }],
    [{ id: "a", text: "caf\u00e9?", answers: ["a", "b"] }],
    [],
  ];
  for (const bank of bad) assert.throws(() => assertBankSane(bank), undefined, JSON.stringify(bank));
});

test("the day's question is the same for every caller and changes by day", () => {
  const a = questionFor(20700, "s", BANK);
  assert.deepEqual(questionFor(20700, "s", BANK), a);
  const seen = new Set(Array.from({ length: 40 }, (_, i) => questionFor(20700 + i, "s", BANK).id));
  assert.ok(seen.size > 1);
});

test("answers match ignoring case and surrounding space", () => {
  assert.equal(answerIndex(byId("t-two"), "Fog "), 0);
  assert.equal(answerIndex(byId("t-two"), "THUNDER"), 1);
  assert.equal(answerIndex(byId("t-two"), "rain"), null);
});

test("a range takes a number or a numeric string, inside the range only", () => {
  const legs = byId("t-range");
  assert.equal(answerIndex(legs, 42), 42);
  assert.equal(answerIndex(legs, "42"), 42);
  assert.equal(answerIndex(legs, 101), null);
  assert.equal(answerIndex(legs, 4.5), null);
  assert.equal(answerIndex(legs, "4x"), null);
});

test("the public shape never carries the id", () => {
  assert.deepEqual(publicShape(byId("t-range")), { question: "How many legs is the right number of legs?", range: { min: 0, max: 100 } });
  assert.equal("id" in publicShape(byId("t-two")), false);
});
