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

// Test gap 26. Every expiry test above walks the clock FORWARD. The other side
// of the window -- `now < issuedAt`, a challenge stamped in the future -- had no
// test at all, and it is a reachable state rather than a theoretical one: this
// server issues the timestamp and this server judges it, so a backwards step in
// the host's clock (an NTP correction, a VM restored from a snapshot) puts a
// live challenge in its own future and refuses every honest agent holding one.
//
// It is reported as `expired`, which is the wrong word for it in English and
// the RIGHT answer for the agent: the vocabulary is published, `expired` already
// means "mint a new challenge and retry", and that is exactly the remedy. A new
// reason would be a wire change every client would have to learn to do the same
// thing. Pinned here so the wording is a decision rather than an accident.
test("a challenge stamped in the FUTURE is refused, not accepted", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now + 5_000);
  const r = checkChallenge(SECRET, challenge, answerFor(challenge, KEY), KEY, now, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired", "the published vocabulary sends it to mint a fresh one");
});

// The boundary, both sides, to a millisecond. `now === issuedAt` is the moment
// of issue and must be accepted -- a client that answers instantly is the
// well-behaved case, not an attack.
test("the future check is exact: the instant of issue is fine, one ms before is not", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now);
  const answer = answerFor(challenge, KEY);

  assert.equal(checkChallenge(SECRET, challenge, answer, KEY, now, new Set()).ok, true,
    "answered at the instant of issue");
  assert.equal(checkChallenge(SECRET, challenge, answer, KEY, now - 1, new Set()).reason, "expired",
    "one millisecond before it was issued");
});

// And the far side of the same window, so both bounds are pinned in one place:
// the last accepted millisecond, and the first refused one.
test("the expiry boundary is exact too", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge(SECRET, now);
  const answer = answerFor(challenge, KEY);

  assert.equal(checkChallenge(SECRET, challenge, answer, KEY, now + CHALLENGE_MS, new Set()).ok, true,
    "the last millisecond of the window");
  assert.equal(checkChallenge(SECRET, challenge, answer, KEY, now + CHALLENGE_MS + 1, new Set()).reason, "expired",
    "one millisecond past it");
});
