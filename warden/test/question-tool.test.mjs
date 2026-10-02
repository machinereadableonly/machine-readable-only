// The `question` tool: one look per token per UTC day.
//
// The second-look test is the one that matters. The question is drawn into the
// artwork, so an agent that could ask again until it liked the question would
// be choosing what the year records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeQuestionTool } from "../src/mcp/tools/question.mjs";
import { ANSWER_WINDOW_MS } from "../src/mcp/question.mjs";
import { DAY_MS } from "../src/day.mjs";

const BANK = JSON.parse(readFileSync(new URL("./fixtures/question-bank.json", import.meta.url), "utf8"));

function setup({ lastDay = 100, level = 1, keyId = "k1" } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId, owner: "0xabc", lastDay, mintDay: 100 });
  if (level !== 1) db.prepare("UPDATE tokens SET level = ? WHERE tokenId = 1").run(level);
  let clock = 1_000_000;
  const tool = makeQuestionTool({ q, bank: BANK, challengeSecret: "s", today: () => 101, now: () => clock });
  return { q, tool, tick: (ms) => { clock += ms; } };
}

test("the question is the day's, with a window", async () => {
  const { tool } = setup();
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(r.day, 101);
  assert.equal(typeof r.question, "string");
  assert.equal(r.answerBy, new Date(1_000_000 + ANSWER_WINDOW_MS).toISOString());
  assert.equal("id" in r, false);
});

test("a second look the same day is the same question and the same window", async () => {
  const { tool, tick } = setup();
  const first = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  tick(30_000);
  const second = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.deepEqual(second, first);
});

test("refusals: unbound, unknown, already credited today, year complete", async () => {
  assert.equal((await setup({ keyId: "other" }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "not-bound-to-caller");
  assert.equal((await setup().tool.handler({ tokenId: 9 }, { keyId: "k1" })).reason, "unknown-token");
  assert.equal((await setup({ level: 365 }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "year-complete");

  // The same shape checkin answers with, so a client has one rule for it.
  const credited = await setup({ lastDay: 101 }).tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(credited.reason, "already-credited-today");
  assert.equal(credited.nextWindowOpensAt, new Date(102 * DAY_MS).toISOString());
});

// The guards the construction site cannot get wrong quietly: a malformed bank,
// or a missing secret the day's choice is keyed by, would otherwise refuse
// every caller or choose predictably once it was live.
test("the tool refuses to be built without a sane bank or without the secret", () => {
  const q = queries(openDb(":memory:"));
  assert.throws(() => makeQuestionTool({ q, challengeSecret: "s" }), /question bank must be an array/);
  // An empty array is the one a bare Array.isArray check let through.
  assert.throws(() => makeQuestionTool({ q, bank: [], challengeSecret: "s" }), /question bank is empty/);
  assert.throws(() => makeQuestionTool({ q, bank: [{ id: "x" }], challengeSecret: "s" }), /printable ASCII/);
  assert.throws(() => makeQuestionTool({ q, bank: BANK, challengeSecret: "" }), /challenge secret/);
});

// A bank edited under a question already issued. Substituting today's new
// choice would show one question and record another, so checkin would grade an
// answer against something the agent never saw.
test("a question already issued but gone from the bank throws rather than substituting", async () => {
  const { q, tool } = setup();
  const first = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(first.ok, true);

  const issuedId = q.getQuestion(1, 101).questionId;
  const without = BANK.filter((b) => b.id !== issuedId);
  assert.equal(without.length, BANK.length - 1, "the issued question must really be the one removed");

  const edited = makeQuestionTool({ q, bank: without, challengeSecret: "s", today: () => 101, now: () => 1_000_000 });
  await assert.rejects(
    () => edited.handler({ tokenId: 1 }, { keyId: "k1" }),
    /issued question is missing from the bank/,
  );
});
