import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertBankSane, questionFor, answerIndex, publicShape } from "../src/mcp/question.mjs";

const BANK = JSON.parse(readFileSync(new URL("./fixtures/question-bank.json", import.meta.url), "utf8"));
const byId = (id) => BANK.find((q) => q.id === id);

test("the fixture bank is sane", () => { assert.equal(assertBankSane(BANK), BANK); });

test("a malformed bank is refused, entry by entry, with a reason", () => {
  const bad = [
    [[{ id: "a", text: "x", answers: ["one"] }], /2 to 16 answers/],
    [[{ id: "a", text: "x", answers: Array.from({ length: 17 }, (_, i) => `o${i}`) }], /2 to 16 answers/],
    [[{ id: "a", text: "x", answers: ["same", "SAME"] }], /answers repeat/],
    [[{ id: "a", text: "x", answers: [" ", "fog"] }], /an answer is blank/],
    [[{ id: "a", text: "x", answers: ["fog", 7] }], /answers must be printable ASCII/],
    [[{ id: "a", text: "x", answers: "fog" }], /exactly one of answers or range/],
    [[{ id: "a", text: "x", range: { min: 0, max: 101 } }], /range must be 2 to 101 integers/],
    [[{ id: "a", text: "x", range: { min: 5, max: 5 } }], /range must be 2 to 101 integers/],
    [[{ id: "a", text: "x", range: { min: 10, max: 1 } }], /range must be 2 to 101 integers/],
    [[{ id: "a", text: "x", range: { min: 0, max: 4.5 } }], /range bounds must be integers/],
    [[{ id: "a", text: "x", range: { min: 0 } }], /range bounds must be integers/],
    [[{ id: "a", text: "x", range: null }], /range must be an object/],
    [[{ id: "a", text: "x", answers: ["a", "b"], range: { min: 0, max: 9 } }], /exactly one of answers or range/],
    [[{ id: "a", text: "x" }], /exactly one of answers or range/],
    [[{ id: "a", text: "x", answers: ["a", "b"] }, { id: "a", text: "y", answers: ["a", "b"] }], /question id missing or repeated/],
    [[{ text: "x", answers: ["a", "b"] }], /question id missing or repeated/],
    [[{ id: "a", text: "caf\u00e9?", answers: ["a", "b"] }], /text must be printable ASCII/],
    [[{ id: "a", text: 7, answers: ["a", "b"] }], /text must be printable ASCII/],
    [[null], /question bank entry must be an object/],
    [["a question"], /question bank entry must be an object/],
    [[], /question bank is empty/],
    ["not a bank", /question bank must be an array/],
    [{ id: "a", text: "x", answers: ["a", "b"] }, /question bank must be an array/],
  ];
  for (const [bank, reason] of bad) {
    assert.throws(() => assertBankSane(bank), reason, JSON.stringify(bank) ?? String(bank));
  }
});

test("the day's question is the same for every caller and changes by day", () => {
  const a = questionFor(20700, "s", BANK);
  assert.deepEqual(questionFor(20700, "s", BANK), a);
  const seen = new Set(Array.from({ length: 40 }, (_, i) => questionFor(20700 + i, "s", BANK).id));
  assert.ok(seen.size > 1);
});

test("the day's question refuses a secret that is not a real string", () => {
  for (const secret of ["", "   ", undefined, null, 0, 7, Buffer.from("s"), ["s"]]) {
    assert.throws(() => questionFor(20700, secret, BANK), /secret must be a non-empty string/, String(secret));
  }
});

test("answers match ignoring case and surrounding space", () => {
  assert.equal(answerIndex(byId("t-two"), "Fog "), 0);
  assert.equal(answerIndex(byId("t-two"), "THUNDER"), 1);
  assert.equal(answerIndex(byId("t-two"), "rain"), null);
  assert.equal(answerIndex(byId("t-two"), "   "), null);
  // A blank answer matches nothing even if a bank slipped a blank option past the check.
  assert.equal(answerIndex({ id: "x", text: "x", answers: [" ", "fog"] }, "  "), null);
});

test("a range takes a number or a numeric string, inside the range only", () => {
  const legs = byId("t-range");
  assert.equal(answerIndex(legs, 42), 42);
  assert.equal(answerIndex(legs, "42"), 42);
  assert.equal(answerIndex(legs, 101), null);
  assert.equal(answerIndex(legs, 4.5), null);
  assert.equal(answerIndex(legs, "4x"), null);
});

test("a range refuses anything that is not a number or a string", () => {
  const legs = byId("t-range");
  for (const answer of [[42], ["42"], 42n, { valueOf: () => 42 }, true, null, undefined]) {
    assert.equal(answerIndex(legs, answer), null, String(answer));
  }
});

test("the public shape never carries the id", () => {
  assert.deepEqual(publicShape(byId("t-range")), { question: "How many legs is the right number of legs?", range: { min: 0, max: 100 } });
  assert.equal("id" in publicShape(byId("t-two")), false);
});
