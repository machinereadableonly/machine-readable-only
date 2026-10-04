// The daily split, pinned to literal vectors. The Clock's copy and the
// client's copy are tested against the SAME values, so they cannot drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { chainKeys, CHAIN_LENGTH, keyIndexFor, splitBit, silentBit, answerBit } from "../src/clock/split.mjs";

const KEY = keccak256("0x" + "11".repeat(32));
// Computed once by a one-off script and pasted. Never recomputed here.
const SPLIT = {
  2: [0, 1],
  5: [0, 1, 0, 1, 0],
  101: [0,0,0,1,0,0,1,0,0,1,0,1,1,0,0,0,1,0,0,1,1,1,0,1,0,0,0,1,1,0,0,1,0,1,0,0,1,1,1,1,0,1,1,1,0,0,1,1,0,0,1,1,1,1,0,0,0,0,0,0,1,1,1,0,0,1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,0,1,1,0,1,0,1,0,0,0,1,1,0,0,1,1,0,1,0,1,0],
};
const SILENT = "01111100";

test("the split matches the published vectors", () => {
  for (const [n, bits] of Object.entries(SPLIT)) {
    assert.deepEqual([...Array(Number(n)).keys()].map((i) => splitBit(KEY, Number(n), i)), bits);
  }
});

test("half the answers, rounded down, give a 1", () => {
  for (const n of [2, 5, 101]) {
    const ones = [...Array(n).keys()].map((i) => splitBit(KEY, n, i)).reduce((a, b) => a + b, 0);
    assert.equal(ones, Math.floor(n / 2));
  }
});

test("silence is a per-token coin flip", () => {
  assert.equal([1, 2, 3, 4, 5, 6, 7, 8].map((id) => silentBit(KEY, id)).join(""), SILENT);
  assert.equal(answerBit({ keyHex: KEY, n: 2, answer: null, tokenId: 3 }), silentBit(KEY, 3));
});

test("the chain hashes back to its anchor", () => {
  const k = chainKeys("0x" + "22".repeat(32));
  assert.equal(k.length, CHAIN_LENGTH + 1);
  assert.equal(k[CHAIN_LENGTH], "0x" + "22".repeat(32));
  assert.equal(keccak256(k[1]), k[0]);
  assert.equal(keyIndexFor(1005, 1000), 6);
});

test("an answer outside the set is refused, never graded", () => {
  for (const answer of [2, 9, -1, 1.5]) assert.throws(() => splitBit(KEY, 2, answer), /outside/);
  assert.throws(() => answerBit({ keyHex: KEY, n: 0, answer: 0, tokenId: 1 }), /outside/);
});

// The vectors cover the functions they call; this covers every other line.
test("the client's copy is this file, apart from the line naming the other copy", () => {
  const body = (rel) =>
    readFileSync(new URL(rel, import.meta.url), "utf8").split("\n").filter((l) => !/split\.mjs is an identical copy/.test(l));
  assert.deepEqual(body("../../client/src/split.mjs"), body("../src/clock/split.mjs"));
});
