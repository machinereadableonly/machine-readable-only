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
import { openChain } from "./chain-stub.mjs";

const BANK = JSON.parse(readFileSync(new URL("./fixtures/question-bank.json", import.meta.url), "utf8"));

function setup({ lastDay = 100, level = 1, keyId = "k1", resting = false, chain = openChain() } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId, owner: "0xabc", lastDay, mintDay: 100 });
  if (level !== 1) db.prepare("UPDATE tokens SET level = ? WHERE tokenId = 1").run(level);
  if (resting) q.setResting(1);
  let clock = 1_000_000;
  const tool = makeQuestionTool({ q, chain, bank: BANK, questionSecret: "s", today: () => 101, now: () => clock });
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

test("refusals: unbound, unknown, resting, already credited today, year complete", async () => {
  assert.equal((await setup({ chain: openChain({ boundTo: "other" }) }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "not-bound-to-caller");
  assert.equal((await setup().tool.handler({ tokenId: 9 }, { keyId: "k1" })).reason, "unknown-token");
  assert.equal((await setup({ level: 365 }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "year-complete");

  // A sealed token cannot be credited again, so a look would be spent on a day
  // it can never answer for. The row is also left untouched.
  const rested = setup({ resting: true });
  const r = await rested.tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "resting");
  assert.equal(rested.q.getQuestion(1, 101), undefined, "no question is issued to a resting token");

  // The same shape checkin answers with, so a client has one rule for it.
  const credited = await setup({ lastDay: 101 }).tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(credited.reason, "already-credited-today");
  assert.equal(credited.nextWindowOpensAt, new Date(102 * DAY_MS).toISOString());
});

// The guards the construction site cannot get wrong quietly: no bank at all,
// or a missing secret the day's choice is keyed by, would otherwise refuse
// every caller or choose predictably once it was live. The CONTENT of the bank
// is checked once at boot and in makeMcpHandler -- see mcp.test.mjs -- because
// this factory runs on every MCP call.
test("the tool refuses to be built without a bank or without the secret", () => {
  const q = queries(openDb(":memory:"));
  assert.throws(() => makeQuestionTool({ q, chain: openChain(), questionSecret: "s" }), /non-empty question bank/);
  // An empty array is the one a bare Array.isArray check let through, and
  // questionFor would divide by its length.
  assert.throws(() => makeQuestionTool({ q, chain: openChain(), bank: [], questionSecret: "s" }), /non-empty question bank/);
  assert.throws(() => makeQuestionTool({ q, chain: openChain(), bank: BANK, questionSecret: "" }), /question secret/);
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

  const edited = makeQuestionTool({ q, chain: openChain(), bank: without, questionSecret: "s", today: () => 101, now: () => 1_000_000 });
  await assert.rejects(
    () => edited.handler({ tokenId: 1 }, { keyId: "k1" }),
    /issued question is missing from the bank/,
  );
});

test("an issued question records how many answers it offered", async () => {
  const { q, tool } = setup();
  await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  const row = q.getQuestion(1, 101);
  const asked = BANK.find((b) => b.id === row.questionId);
  assert.equal(row.n, asked.answers ? asked.answers.length : asked.range.max - asked.range.min + 1);
});

// 16 Low. An answer arriving after midnight is a check-in for the NEXT day,
// which has no question, so a window running past the day's end promised time
// that did not exist. answerBy never passes the end of the day it was asked.
test("a question asked in the day's last seconds is due before midnight", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const endOfDay = 102 * DAY_MS;
  const tool = makeQuestionTool({ q, chain: openChain(), bank: BANK, questionSecret: "s", today: () => 101, now: () => endOfDay - 10_000 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.answerBy, new Date(endOfDay - 1).toISOString());
});

test("a question on the mint day is told mint day is day 1, and when it lands", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 101, mintDay: 101 });
  const tool = makeQuestionTool({ q, chain: openChain(), bank: BANK, questionSecret: "s", today: () => 101, now: () => 1 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "already-credited-today");
  assert.match(r.next, /Mint day is day 1/);
  assert.equal(typeof r.onChainBy, "string");
});

// 21 Cheap #18. The window's length was stated nowhere an agent reads it.
test("the question reply states its window in seconds", async () => {
  const { tool } = setup();
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.windowSeconds, ANSWER_WINDOW_MS / 1000);
});

// D6: the CHAIN's binding decides who may see the day's question, so a key the
// token was rebound away from cannot spend its look or answer for it.
test("a key the chain no longer binds is refused, even while the mirror still names it", async () => {
  const { q, tool } = setup({ keyId: "k1", chain: openChain({ boundTo: "k2" }) });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "not-bound-to-caller");
  assert.equal(q.getQuestion(1, 101), undefined, "no look is spent");
});

test("a key the chain binds is served before the mirror has caught up", async () => {
  const { tool } = setup({ keyId: "k1", chain: openChain({ boundTo: "k2" }) });
  assert.equal((await tool.handler({ tokenId: 1 }, { keyId: "k2" })).ok, true);
});

test("an unreadable binding refuses chain-unavailable and spends no look", async () => {
  const { q, tool } = setup({ chain: openChain({ boundKeyOf: async () => null }) });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "chain-unavailable");
  assert.equal(q.getQuestion(1, 101), undefined);
});

test("a refusal the mirror can answer costs no chain read", async () => {
  const poisoned = openChain({ boundKeyOf: async () => { throw new Error("no chain read on a mirror refusal"); } });
  assert.equal((await setup({ resting: true, chain: poisoned }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "resting");
  assert.equal((await setup({ lastDay: 101, chain: poisoned }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "already-credited-today");
});

test("a tool built without a chain reader fails at construction", () => {
  const q = queries(openDb(":memory:"));
  assert.throws(() => makeQuestionTool({ q, bank: BANK, questionSecret: "s" }), /boundKeyOf/);
});
