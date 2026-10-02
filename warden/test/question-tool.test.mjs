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
  assert.equal((await setup({ lastDay: 101 }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "already-credited-today");
  assert.equal((await setup({ level: 365 }).tool.handler({ tokenId: 1 }, { keyId: "k1" })).reason, "year-complete");
});

// The two guards the construction site cannot get wrong quietly: a tool built
// without a bank, or without the secret the day's choice is keyed by, would
// otherwise refuse or choose predictably once it was live.
test("the tool refuses to be built without a bank or without the secret", () => {
  const q = queries(openDb(":memory:"));
  assert.throws(() => makeQuestionTool({ q, challengeSecret: "s" }), /question bank/);
  assert.throws(() => makeQuestionTool({ q, bank: BANK, challengeSecret: "" }), /challenge secret/);
});
