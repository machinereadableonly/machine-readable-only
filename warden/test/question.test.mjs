import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertBankSane, assertIssuedQuestionsPresent, bankPath, loadBank,
  questionFor, answerIndex, publicShape,
  appendOnlyProblem,
  answerSetSize,
} from "../src/mcp/question.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";

const BANK_FILE = fileURLToPath(new URL("./fixtures/question-bank.json", import.meta.url));
const BANK = JSON.parse(readFileSync(BANK_FILE, "utf8"));
const byId = (id) => BANK.find((q) => q.id === id);

test("the fixture bank is sane", () => { assert.equal(assertBankSane(BANK), BANK); });

test("a malformed bank is refused, entry by entry, with a reason", () => {
  const bad = [
    [[{ id: "a", text: "x", answers: ["one"] }], /2 to 16 answers/],
    [[{ id: "a", text: "x", answers: Array.from({ length: 17 }, (_, i) => `o${i}`) }], /2 to 16 answers/],
    [[{ id: "a", text: "x", answers: ["same", "SAME"] }], /answers repeat/],
    [[{ id: "a", text: "x", answers: [" ", "fog"] }], /an answer is blank/],
    [[{ id: "a", text: "x", answers: ["fog", 7] }], /answers must be printable ASCII/],
    [[{ id: "a", text: "x", answers: ["fog", "t".repeat(65)] }], /an answer is longer than 64/],
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

// An id is a slug of the question text, so an id free to hold any character is
// an id free to hold the question itself -- and `check-question-bank.mjs` tells
// an entry's refusal from the whole bank's by this shape. The refusal is the
// one message that names no id, because a bad id is the thing being hidden.
test("an id that is not kebab-case is refused, and the refusal names no id", () => {
  for (const id of ["bank nasty", "Fog", "fog_thunder", "fog--thunder", "-fog", "fog-", "fog?", "fog thunder: x"]) {
    assert.throws(
      () => assertBankSane([{ id, text: "a question", answers: ["a", "b"] }]),
      (err) => {
        assert.equal(err.message, "question id must be kebab-case", err.message);
        assert.equal(err.message.includes(id), false, err.message);
        return true;
      },
      id
    );
  }
  for (const id of ["fog-thunder", "a", "t-two", "how-many-clouds-make-7"]) {
    assert.doesNotThrow(() => assertBankSane([{ id, text: "a question", answers: ["a", "b"] }]), id);
  }
});

// V8's SyntaxError quotes the bytes around the bad token -- about sixteen
// characters of the file, which in this file is part of a question.
test("a bank that is not valid JSON refuses with a fixed sentence, quoting nothing", () => {
  const file = join(tmpdir(), `mro-bad-json-bank-${process.pid}.json`);
  const text = '[{ "id": "a-question", "text": "a question", "answers": ["a", "b"], }]';
  writeFileSync(file, text);
  try {
    assert.throws(
      () => loadBank(file),
      (err) => {
        assert.equal(err.message, "question bank is not valid JSON", err.message);
        assert.equal(err.message.includes("a question"), false, err.message);
        assert.equal(err.message.includes("JSON.parse"), false, err.message);
        return true;
      }
    );
  } finally {
    rmSync(file, { force: true });
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

// The reference client sends a digits-only --answer as an integer, so a list
// option spelled in digits was unanswerable through it while only a string
// matched. A hand-made entry rather than one in the fixture, which several
// suites read for its own ids.
test("a list option spelled in digits is answerable as a string or a number", () => {
  const year = { id: "t-year", text: "1999 or 2008?", answers: ["1999", "2008"] };
  const bank = [year];
  assert.equal(assertBankSane(bank), bank, "a digit-spelled option is a legal bank entry");
  assert.equal(answerIndex(year, "2008"), 1);
  assert.equal(answerIndex(year, 2008), 1);
  assert.equal(answerIndex(year, 1999), 0);
  assert.equal(answerIndex(year, 2007), null);
  // Only a number is given a decimal spelling.
  for (const answer of [[2008], 2008n, { toString: () => "2008" }, true]) {
    assert.equal(answerIndex(year, answer), null, String(answer));
  }
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

test("the bank path is the setting, else the private default outside the worktree", () => {
  assert.equal(bankPath({ MRO_QUESTION_BANK: "/x/bank.json" }), "/x/bank.json");
  assert.equal(bankPath({}), join(homedir(), ".mro-questions", "bank.json"));
  // An empty setting is a setting nobody filled in, so it falls back too.
  assert.equal(bankPath({ MRO_QUESTION_BANK: "" }), join(homedir(), ".mro-questions", "bank.json"));
});

test("a bank file on disk is read and checked", () => {
  assert.deepEqual(loadBank(BANK_FILE), BANK);
});

// The boot log is read in public and the default path carries the home
// directory, so a missing bank must not surface readFileSync's ENOENT.
test("a bank that cannot be read refuses with a fixed sentence, naming no path", () => {
  const absent = join(tmpdir(), `mro-absent-bank-${process.pid}`, "bank.json");
  assert.throws(
    () => loadBank(absent),
    (err) => {
      assert.match(err.message, /question bank not found: set MRO_QUESTION_BANK/);
      assert.equal(err.message.includes(absent), false, err.message);
      assert.equal(err.message.includes(tmpdir()), false, err.message);
      return true;
    }
  );
});

test("a bank that is unreadable for another reason says so, still without a path", () => {
  assert.throws(
    () => loadBank(tmpdir()),
    (err) => {
      assert.match(err.message, /question bank could not be read \(EISDIR\)/);
      assert.equal(err.message.includes(tmpdir()), false, err.message);
      return true;
    }
  );
});

// R10b. A bank edited under a question already issued would make the Warden
// show one question and grade the answer against another, so boot refuses.
test("boot refuses when a question already issued is gone from the bank", () => {
  const q = queries(openDb(":memory:"));
  assert.equal(assertIssuedQuestionsPresent(q, BANK), BANK, "no rows, nothing to miss");

  q.issueQuestion(1, 101, BANK[0].id, 1_000);
  q.issueQuestion(1, 102, BANK[1].id, 2_000);
  // The same id twice: the refusal counts questions, not rows.
  q.issueQuestion(2, 102, BANK[1].id, 2_000);
  assert.equal(assertIssuedQuestionsPresent(q, BANK), BANK);

  const without = BANK.filter((b) => b.id !== BANK[1].id);
  assert.throws(
    () => assertIssuedQuestionsPresent(q, without),
    (err) => {
      assert.match(err.message, /missing 1 question/);
      // The count only: the id names a question, and this reaches a log.
      assert.equal(err.message.includes(BANK[1].id), false, err.message);
      assert.equal(err.message.includes(BANK[1].text), false, err.message);
      return true;
    }
  );
  assert.throws(() => assertIssuedQuestionsPresent(q, []), /missing 2 questions/);
});

// THE BANK IS APPEND-ONLY. An option added to a question already asked would
// change which recorded answers fill a square.
test("a bank may only add questions at the end", () => {
  const a = { id: "a", text: "A?", answers: ["x", "y"] };
  const b = { id: "b", text: "B?", range: { min: 0, max: 9 } };
  assert.equal(appendOnlyProblem([a], [a, b]), null);
  assert.match(appendOnlyProblem([a], [{ ...a, answers: ["x", "y", "z"] }]), /entry 0 changed/);
  assert.match(appendOnlyProblem([a, b], [b, a]), /entry 0 changed/, "no reordering");
  assert.match(appendOnlyProblem([a, b], [a]), /removed/);
  assert.equal(answerSetSize(a), 2);
  assert.equal(answerSetSize(b), 10);
});
