import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { issueChallenge, checkChallenge, CHALLENGE_MS } from "../src/door/challenge.mjs";

const SECRET = "test-secret-not-a-real-one";
const KEY = "thumbprint-abc";

/// How a well-behaved client answers: SHA-256 over the challenge and its own key id.
const answerFor = (challenge, keyId) =>
  createHash("sha256").update(challenge + keyId).digest("hex");

test("a fresh challenge is accepted with the right answer", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now);
  const r = checkChallenge(SECRET, challenge, answerFor(challenge, KEY), KEY, now + 1000, new Set());
  assert.deepEqual(r, { ok: true });
});

test("the answer is bound to the key id", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now);
  const r = checkChallenge(SECRET, challenge, answerFor(challenge, "someone-else"), KEY, now, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "challenge");
});

test("a challenge expires after five seconds", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now);
  const r = checkChallenge(SECRET, challenge, answerFor(challenge, KEY), KEY, now + CHALLENGE_MS + 1, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

test("a challenge burns after one use", () => {
  const now = 1_000_000;
  const seen = new Set();
  const { challenge } = issueChallenge(SECRET, now);
  const answer = answerFor(challenge, KEY);
  assert.equal(checkChallenge(SECRET, challenge, answer, KEY, now, seen).ok, true);
  const second = checkChallenge(SECRET, challenge, answer, KEY, now, seen);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "challenge");
});

test("a forged HMAC is rejected", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now);
  const [nonce, ts] = challenge.split(".");
  const forged = `${nonce}.${ts}.${"0".repeat(64)}`;
  const r = checkChallenge(SECRET, forged, answerFor(forged, KEY), KEY, now, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "challenge");
});

test("a challenge minted under a different secret is rejected", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge("a-different-secret", now);
  const r = checkChallenge(SECRET, challenge, answerFor(challenge, KEY), KEY, now, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "challenge");
});
