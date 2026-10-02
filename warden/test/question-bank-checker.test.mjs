// The bank checker's output is read in public, so it must never print a
// question. The Warden's own refusals name an entry by its id and an id is a
// slug of the question text, so every message below is a REAL `assertBankSane`
// refusal driven through the rewrite -- a hand-written string would still pass
// if the rewrite were a pass-through.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
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
  assert.equal(namedByPosition(message, bank), "entry 1: its id is missing, repeated or not kebab-case");
});

test("a missing id names its entry too", () => {
  const bank = [ok("alpha"), { text: "a question", answers: ["x", "y"] }];
  assert.equal(namedByPosition(refusalFor(bank), bank), "entry 1: its id is missing, repeated or not kebab-case");
});

test("a bank-wide refusal names no entry and is passed through", () => {
  for (const bank of [[], "not an array"]) {
    const message = refusalFor(bank);
    assert.equal(namedByPosition(message, []), message);
  }
});

// The re-review's case. The rewrite used to assume an id held no space, which
// nothing enforced, so an id beginning "bank " walked straight through the
// bank-wide branch with its text intact. The shape is a rule now, and this
// entry is refused before any message can carry it.
test("an id that could impersonate a bank-wide refusal is refused, and not printed", () => {
  const bank = [{ id: "bank nasty", text: "a question", answers: ["x", "x"] }];
  const message = refusalFor(bank);
  const named = namedByPosition(message, bank);
  assert.equal(named, "entry 0: its id is missing, repeated or not kebab-case");
  assert.equal(named.includes("bank nasty"), false, named);
  assert.equal(named.includes("nasty"), false, named);
});

// A parser's own message quotes the bytes around the bad token, so the fix is
// in loadBank; the rewrite must leave its fixed sentence alone.
test("a bank that is not valid JSON says so and nothing more", () => {
  const file = join(tmpdir(), `mro-checker-bad-json-${process.pid}.json`);
  writeFileSync(file, '[{ "id": "a-question", "text": "a question", "answers": ["a", "b"], }]');
  try {
    let message;
    try {
      loadBank(file);
    } catch (err) {
      message = err.message;
    }
    assert.equal(message, "question bank is not valid JSON");
    assert.equal(namedByPosition(message, []), message);
    assert.equal(namedByPosition(message, []).includes("a question"), false);
  } finally {
    rmSync(file, { force: true });
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
    [{ id: "bank nasty", text: "a question", answers: ["x", "x"] }],
    [{ id: "question alpha: elsewhere", text: "a question", answers: ["x", "y"] }],
  ];
  for (const bank of banks) {
    const entries = Array.isArray(bank) ? bank : [];
    const named = namedByPosition(refusalFor(bank), entries);
    // Only an enforced id shape counts as an id, so the one thing that must
    // never survive is `question <kebab-id>: `.
    assert.ok(!/^question [a-z0-9]+(-[a-z0-9]+)*: /.test(named), `a raw refusal escaped: ${named}`);
    for (const q of entries) {
      if (q?.id) assert.ok(!named.includes(q.id), `an id reached the output: ${named}`);
    }
  }
});
