// The bank checker's output is read in public, so it must never print a
// question. The Warden's own refusals name an entry by its id and an id is a
// slug of the question text, so every message below is a REAL `assertBankSane`
// refusal driven through the rewrite -- a hand-written string would still pass
// if the rewrite were a pass-through.
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertBankSane, loadBank } from "../src/mcp/question.mjs";
import { namedByPosition } from "../tools/check-question-bank.mjs";

const refusalFor = (bank) => {
  try {
    assertBankSane(bank);
  } catch (err) {
    return err.message;
  }
  return assert.fail("the bank was accepted, so there is no refusal to rename");
};

const ok = (id) => ({ id, text: "a question", answers: ["x", "y"] });

test("an entry's refusal is named by its position, never by its id", () => {
  const bank = [ok("alpha"), ok("beta"), { id: "gamma", text: "a question", answers: ["x", " "] }];
  const message = refusalFor(bank);
  assert.ok(message.includes("gamma"), "the Warden's own message does name the id");
  const named = namedByPosition(message, bank);
  assert.equal(named, "entry 2: an answer is blank");
  assert.ok(!named.includes("gamma"), "the id reached the public output");
});

test("a range refusal is renamed the same way", () => {
  const bank = [{ id: "delta", text: "a question", range: { min: 0, max: 500 } }];
  const named = namedByPosition(refusalFor(bank), bank);
  assert.equal(named, "entry 0: range must be 2 to 101 integers");
});

test("a repeated id names the entry that repeats it", () => {
  const bank = [ok("alpha"), ok("alpha")];
  const message = refusalFor(bank);
  assert.ok(message.includes("alpha"));
  assert.equal(namedByPosition(message, bank), "entry 1: its id is missing or repeated");
});

test("a missing id names its entry too", () => {
  const bank = [ok("alpha"), { text: "a question", answers: ["x", "y"] }];
  assert.equal(namedByPosition(refusalFor(bank), bank), "entry 1: its id is missing or repeated");
});

test("a bank-wide refusal names no entry and is passed through", () => {
  for (const bank of [[], "not an array"]) {
    const message = refusalFor(bank);
    assert.equal(namedByPosition(message, []), message);
  }
});

// This one caught a real bug: "question bank not found: ..." carries a colon,
// so it read as an entry whose id was "bank not found" and the remedy was lost.
test("loadBank's own refusal survives the rewrite word for word", () => {
  let message;
  try {
    loadBank(join(tmpdir(), "mro-no-such-question-bank.json"));
  } catch (err) {
    message = err.message;
  }
  assert.ok(message.startsWith("question bank not found:"), message);
  assert.equal(namedByPosition(message, []), message);
  assert.ok(namedByPosition(message, []).includes("MRO_QUESTION_BANK"));
});

test("an id the entries do not hold is still not printed", () => {
  const bank = [{ id: "epsilon", text: "a question", answers: ["x", " "] }];
  const named = namedByPosition(refusalFor(bank), []);
  assert.equal(named, "an entry: an answer is blank");
});

test("every refusal the bank can raise is renamed or carries no id", () => {
  const banks = [
    [],
    "not an array",
    [null],
    [ok("alpha"), ok("alpha")],
    [{ text: "a question", answers: ["x", "y"] }],
    [{ id: "alpha", text: 7, answers: ["x", "y"] }],
    [{ id: "alpha", text: "a question", answers: ["x", "y"], range: { min: 1, max: 2 } }],
    [{ id: "alpha", text: "a question", answers: ["only"] }],
    [{ id: "alpha", text: "a question", answers: ["x", "x"] }],
    [{ id: "alpha", text: "a question", answers: ["x", "y".repeat(65)] }],
    [{ id: "alpha", text: "a question", range: "wide" }],
    [{ id: "alpha", text: "a question", range: { min: 1.5, max: 9 } }],
  ];
  for (const bank of banks) {
    const entries = Array.isArray(bank) ? bank : [];
    const named = namedByPosition(refusalFor(bank), entries);
    // "question bank ..." names the whole bank; "question <id>: ..." names one
    // entry and must have been rewritten.
    assert.ok(!/^question (?!bank )/.test(named), `a raw refusal escaped: ${named}`);
    for (const q of entries) {
      if (q?.id) assert.ok(!named.includes(q.id), `an id reached the output: ${named}`);
    }
  }
});
