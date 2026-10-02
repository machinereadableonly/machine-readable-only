# Plan B: the door, the client and the daily question

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> After completing any operator-only step, tell Claude so it can update memory
> immediately. Operator-only steps in this plan: approving the agent-facing
> copy (Task 9, a STOP gate, because that copy is locked), approving the push
> and the live Sepolia Warden re-create (Task 10), and approving any npm
> re-stage (Task 11).

**Goal:** Bind the entry challenge into the signature, admit a conforming
`"signature-agent";key=` signer, and give every check-in a daily question whose
answer the Warden records -- with the answer window measured on a real agent.

**Why:** Rulings 4 and 5 of the 2026-09-28 review, and the door/client half of
the daily question approved by the operator on 2026-10-02. The reference client
is staged on npm and not yet released; every change here alters what a client
must send, so all of it must land before that release and before the mainnet
mint. The contract half of the question (storing bits, the split, the
renderer) is Plan A and depends on this plan's recorded answers and measured
window.

**Architecture:** The door already verifies RFC 9421 and then checks the
challenge separately. The challenge headers become COVERED components, checked
in `admit` (the door's own rule), so only the key holder can answer. The
`;key=` fix rewrites the one header value the library reads, from the selected
dictionary member, before verification. The question is a new MCP tool backed
by a private bank file and a new `questions` table in the mirror; `checkin`
gains an optional `answer` recorded in the same transaction as the credit.
The window is a Warden constant measured by a throwaway probe against a local
Warden.

**Tech Stack:** Node 24.14.1, `node:test`, `web-bot-auth` 0.1.3,
`http-message-sig` 0.2.0, `structured-headers` 2.0.2, `zod`, SQLite via the
mirror's existing `openDb`.

**Spec:** `docs/specs/2026-10-02-mro-daily-question-design.md` (sections 4, 6,
8, 9) and `docs/reviews/2026-09-28/00-verification.md` (Rulings 4 and 5);
roadmap `docs/plans/2026-09-30-mro-rulings-roadmap.md`.

## Global Constraints

- Plain ASCII only in code, comments and docs.
- All four suites green before every commit: `cd contracts && forge test`, and
  `npm test` in `tools/`, `warden/`, `client/`. Heavy runs go through
  `~/scripts/safe-build.sh`. Never pipe a gate into anything.
- Use `/bin/grep`, never bare `grep`. Node needs `source ~/.nvm/nvm.sh`.
- The repository is PUBLIC: no absolute paths, no key ids, no secrets, no AI
  attribution in files or commit messages. The REAL question bank is never
  committed; only the test fixture is.
- Comments follow `~/.claude/rules/code-comments.md`: the why, one short line,
  no history. Do not add narration to files this plan touches.
- Licences: `warden/src/door` and `client` are MIT; `warden/src/mcp`,
  `warden/src/mirror`, `warden/tools` and `warden/test` are PolyForm
  Noncommercial. New files take their directory's licence (LICENSING.md).
- Answer window: `ANSWER_WINDOW_MS`, a Warden constant, starts at `60_000` and
  is replaced by the MEASURED value in Task 10.
- Answer sets: two options, a list of 2 to 16 options, or an integer range of
  at most 101 values. No free text.
- Silence never costs the credit: a check-in with no answer, a late answer, or
  no question asked is ACCEPTED and recorded as silent.
- The split is never computed, stored or hinted at in this plan. The Warden
  records WHICH answer and WHEN, nothing more.

## Review Focus

1. **A captured request replayed by a relayer with its own fresh challenge**
   must be refused `components`, not admitted -- the whole point of ruling 4.
   Pinned in Task 1.
2. **A signer covering BOTH `signature-agent` and `"signature-agent";key=`**
   must be refused, not have one silently chosen. Pinned in Task 2.
3. **An answer with different case or surrounding spaces** ("Fog ", "FOG") must
   match the option "fog"; an answer of `42` and `"42"` must both match a range.
   Pinned in Task 3.
4. **A second `question` call the same day** must return the SAME question and
   the SAME `answerBy`, never a fresh window. Pinned in Task 5.
5. **An invalid answer inside the window** must refuse WITHOUT crediting, so the
   agent can correct it; the same invalid answer after the window must be
   accepted as silent. Pinned in Task 6.

---

### Task 1: Bind the challenge into the signature (ruling 4)

**Files:**
- Modify: `warden/src/door/verify.mjs` (return the covered list)
- Modify: `warden/src/door/middleware.mjs` (`admit` requires the two components)
- Modify: `client/src/signing.mjs`, `client/src/door.mjs`
- Modify: `warden/test/door.test.mjs`, `warden/test/e2e/join.test.mjs`
- Modify: `warden/tools/protocol-transcript.mjs`, `warden/tools/x402-live-mint-check.mjs`
- Modify: `docs/2026-09-01-mro-raw-protocol.md` (the components rule, the worked example)
- Modify: `skills/machine-readable-only/references/refusals.md` (it lists four components; the door requires seven)

**Interfaces:**
- Produces: `verifyRequest(...)` returns `{ ok: true, keyId, expiresAt, sigHash, covered: string[] }`.
- Produces: `BOUND_COMPONENTS = ["challenge", "challenge-response"]` exported from `middleware.mjs`.
- Produces: `signRequest({ ..., challenge })` in the client; the returned headers include `challenge` and `challenge-response`, both covered. `REQUIRED_COMPONENTS` has seven entries.

- [ ] **Step 1: Write the failing door test (the relayer)**

Add to `warden/test/door.test.mjs`, beside the existing replay tests. It signs
WITHOUT the challenge components, then attaches a correct answer -- exactly what
a relayer holding someone's fresh signature can do today.

```js
test("a challenge answered outside the signature is refused components", async () => {
  const { challenge } = issueChallenge(SECRET, NOW);
  const signer = await signerFromJWK(ED.key);
  const req = await signedRequest({
    components: ["@authority", "@method", "@path", "signature-agent", "content-digest"],
    extraHeaders: {},
  });
  req.headers = { ...req.headers, challenge, "challenge-response": answerFor(challenge, signer.keyid) };
  const decision = await admit(req, deps());
  assert.equal(decision.ok, false);
  assert.equal(decision.body.reason, "components");
});
```

(`deps()`, `SECRET`, `NOW`, `answerFor` and `signedRequest` are the file's
existing helpers; if `deps` is named differently there, use the existing
factory that builds `admit`'s dependencies.)

- [ ] **Step 2: Run it and watch it fail**

Run: `cd warden && npm test -- --test-name-pattern "outside the signature"`
Expected: FAIL -- `decision.ok` is `true`, because today the challenge is
checked but not required to be signed.

- [ ] **Step 3: Return the covered list from the verifier**

In `warden/src/door/verify.mjs`, capture `covered` beside `verifiedKeyId` and
return it:

```js
  let verifiedCovered = null;
```
inside the callback, after the REQUIRED loop passes:
```js
      verifiedCovered = covered;
```
and the final return:
```js
  return { ok: true, keyId: verifiedKeyId, expiresAt: verifiedExpiresAt, sigHash: verifiedSigHash, covered: verifiedCovered };
```

- [ ] **Step 4: Require the challenge components in `admit`**

In `warden/src/door/middleware.mjs`, export the list and check it straight
after `verified.ok` is known:

```js
/// The door's own rule on top of verify.mjs: the challenge must be SIGNED, so
/// only the key holder can answer it.
export const BOUND_COMPONENTS = ["challenge", "challenge-response"];
```
```js
  if (!BOUND_COMPONENTS.every((c) => verified.covered?.includes(c))) return fail("components");
```

- [ ] **Step 5: Sign the challenge in the door test helper**

`signedRequest` in `door.test.mjs` currently signs and then spreads
`extraHeaders` on top. Move `extraHeaders` INTO `message.headers` before
signing, and add the two components to `CLIENT_COMPONENTS`:

```js
const CLIENT_COMPONENTS = ["@authority", "@method", "@path", "signature-agent", "content-digest", "challenge", "challenge-response"];
```
```js
  const message = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: { "signature-agent": '"https://example.com"', host: "example.com", "content-digest": contentDigest(body), ...extraHeaders },
  };
```

Every existing call already passes the challenge pair through `extraHeaders`,
so they now sign it. A call that passes NO challenge now signs two empty
header values; it still verifies, passes the components check, and is refused
`challenge` by `checkChallenge` exactly as before. Confirm by running the
suite; do not assume. The two other
`signatureHeaders` calls in this file (near lines 620 and 753) get the same
treatment: put `challenge` and `challenge-response` in the message headers
before signing.

Apply the same change to `warden/test/e2e/join.test.mjs` and to both tools in
`warden/tools/` that sign by hand: add the pair to the message headers before
`signatureHeaders`, and add both names to their component lists.

- [ ] **Step 6: Make the reference client sign the challenge**

`client/src/signing.mjs`:

```js
export const REQUIRED_COMPONENTS = [
  "@authority", "@method", "@path", "signature-agent", "content-digest", "challenge", "challenge-response",
];
```
```js
import { answerChallenge } from "./challenge.mjs";

export async function signRequest({ privateJwk, origin, signatureAgent, challenge, method = "POST", path = "/mcp", body = "", now = new Date() }) {
  if (typeof challenge !== "string") throw new Error("signRequest needs the door's challenge: it is a signed component");
  const signer = await signerFromJWK(privateJwk);
  const message = {
    method,
    url: new URL(path, origin).toString(),
    headers: {
      "signature-agent": `${SIGNATURE_LABEL}="${signatureAgent}"`,
      host: new URL(origin).host,
      "content-digest": contentDigest(body),
      challenge,
      "challenge-response": answerChallenge(challenge, signer.keyid),
    },
  };
```
(the rest of the function is unchanged). Update the doc comment above
`REQUIRED_COMPONENTS`: seven components, and the challenge pair is signed so
that only the key holder can answer.

`client/src/door.mjs` `admittedFetch`: pass `challenge` into `signRequest` and
delete the two lines that add `challenge` and `challenge-response` after
signing (they are now in `headers`).

- [ ] **Step 7: Run all four suites**

Run each, separately, through the wrapper:
`cd contracts && ~/scripts/safe-build.sh forge test`, then
`~/scripts/safe-build.sh npm test` in `tools/`, `warden/`, `client/`.
Expected: all PASS, including the new test. If a client test fails with
`components`, a signing path was missed: find it with
`/bin/grep -rn "signatureHeaders(\|signRequest(" warden client --include=*.mjs`.

- [ ] **Step 8: Correct the agent-facing protocol text**

`docs/2026-09-01-mro-raw-protocol.md`, the "Four rules" section (near line
284): the components rule now lists seven, and says the challenge pair is
signed, so the answer is computed BEFORE signing. Re-run
`node tools/protocol-transcript.mjs` only if that document's worked example is
generated by it (read its header); otherwise update the example's
`Signature-Input` line by hand to list seven components.
`skills/machine-readable-only/references/refusals.md`: the `components` entry
lists the seven names.

These two files are agent-facing PROTOCOL facts, not the locked narrative copy;
a wrong component list is a defect, not a wording choice.

- [ ] **Step 9: Commit**

```bash
git add warden/src/door client/src warden/test warden/tools docs/2026-09-01-mro-raw-protocol.md skills/machine-readable-only/references/refusals.md
git commit -m "feat(door): the challenge is a signed component"
```

---

### Task 2: Admit a conforming `"signature-agent";key=` signer (ruling 5)

**Files:**
- Modify: `warden/src/door/verify.mjs`
- Test: `warden/test/verify.test.mjs`

**Interfaces:**
- Produces: `keyedMessage(request) -> request` exported from `verify.mjs`: the
  request unchanged, or a copy whose `signature-agent` header is the serialised
  member the signature selected. Throws on an ambiguous or unresolvable key.

`http-message-sig` 0.2.0 `buildSignedData` reads the WHOLE header for a header
component and ignores its `key` parameter, so a base line RFC 9421 2.1.2 builds
as `"signature-agent";key="sig1": "https://a.example"` is built by the library
from the entire dictionary, and a conforming signature fails.

- [ ] **Step 1: Write the failing test, signed from a HAND-BUILT base**

The base is written out line by line, per RFC 9421 2.1.2 and 2.5, and signed
with Node's own Ed25519 -- no signing library -- so the test cannot share a bug
with the code under test.

```js
import { createPrivateKey, sign as edSign } from "node:crypto";

test("a signature over \"signature-agent\";key= verifies, from a hand-built base", async () => {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 60;
  const agent = 'sig1="https://example.com"';
  const params =
    `("@authority" "@method" "@path" "signature-agent";key="sig1" "content-digest")` +
    `;created=${created};expires=${expires};keyid="${ED.key.kid}";tag="web-bot-auth"`;
  const base = [
    `"@authority": example.com`,
    `"@method": POST`,
    `"@path": /mcp`,
    `"signature-agent";key="sig1": "https://example.com"`,
    `"content-digest": ${EMPTY_DIGEST}`,
    `"@signature-params": ${params}`,
  ].join("\n");
  const sig = edSign(null, Buffer.from(base, "utf8"), createPrivateKey({ key: ED.key, format: "jwk" })).toString("base64");
  const req = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: {
      host: "example.com",
      "signature-agent": agent,
      "content-digest": EMPTY_DIGEST,
      "signature-input": `sig1=${params}`,
      signature: `sig1=:${sig}:`,
    },
  };
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, true, r.reason);
});
```

If `ED.key` has no `kid`, compute the key id the way the file's other tests
obtain it (`(await signerFromJWK(ED.key)).keyid`) and use that.

Add the two refusals beside it, built the same way:

- covering BOTH `"signature-agent"` and `"signature-agent";key="sig1"` -> `ok: false`;
- `;key="sig9"`, a member the header does not have -> `ok: false`.

- [ ] **Step 2: Run them and watch the first fail**

Run: `cd warden && npm test -- --test-name-pattern "signature-agent"`
Expected: the hand-built test FAILS with `reason: "signature"`; the two refusal
tests already pass (they must still pass after the fix).

- [ ] **Step 3: Implement `keyedMessage`**

In `verify.mjs`, import `serializeItem` beside `parseDictionary`, and add:

```js
/**
 * RFC 9421 2.1.2: a component carrying `;key=` signs ONE dictionary member,
 * serialised. http-message-sig 0.2.0 signs the whole header instead, so the
 * header handed to it is replaced by the selected member. Parsed, never sliced.
 */
export function keyedMessage(request) {
  const [first] = parseDictionary(headerOf(request, "signature-input") ?? "").values();
  const members = Array.isArray(first?.[0]) ? first[0] : [];
  const agents = members.filter(([name]) => name === "signature-agent");
  const keyed = agents.filter(([, params]) => params.has("key"));
  if (keyed.length === 0) return request;
  if (agents.length > 1) throw new Error("signature-agent covered more than once");
  const key = keyed[0][1].get("key");
  if (typeof key !== "string") throw new Error("signature-agent key is not a string");
  const member = parseDictionary(headerOf(request, "signature-agent") ?? "").get(key);
  if (!member) throw new Error("signature-agent has no member for that key");
  const headers = {};
  if (typeof request.headers?.forEach === "function") request.headers.forEach((v, k) => { headers[k] = v; });
  else Object.assign(headers, request.headers);
  for (const k of Object.keys(headers)) if (k.toLowerCase() === "signature-agent") delete headers[k];
  headers["signature-agent"] = serializeItem(member);
  return { ...request, headers };
}
```

In `verifyRequest`, keep reading `signatureAgentHeader` from the ORIGINAL
request (the URL lookup needs the dictionary), and verify the keyed copy:

```js
  let message;
  try {
    message = keyedMessage(request);
  } catch {
    return { ok: false, reason: "components" };
  }
```
then pass `message` instead of `request` to `verifyWebBotAuth`. `timeReason`
keeps reading `request`.

- [ ] **Step 4: Run the suites**

All four, as in Task 1 Step 7. Expected: PASS, and the existing tests that sign
a plain `signature-agent` are untouched (`keyedMessage` returns them as they
came).

- [ ] **Step 5: Commit**

```bash
git add warden/src/door/verify.mjs warden/test/verify.test.mjs
git commit -m "fix(door): a signature-agent component with key= signs the selected member"
```

---

### Task 3: The question bank

**Files:**
- Create: `warden/src/mcp/question.mjs`
- Create: `warden/test/fixtures/question-bank.json`
- Test: `warden/test/question.test.mjs`

**Interfaces:**
- Produces, from `question.mjs`:
  - `ANSWER_WINDOW_MS` (number, `60_000` until Task 10)
  - `assertBankSane(bank) -> bank` (throws on any malformed entry)
  - `loadBank(path) -> bank` (reads JSON, then `assertBankSane`)
  - `questionFor(day, secret, bank) -> entry` (deterministic per day)
  - `answerIndex(entry, answer) -> number | null` (`null` when not in the set)
  - `publicShape(entry) -> { question, answers } | { question, range }`
- A bank entry is `{ "id": "fog-thunder", "text": "Fog or thunder?", "answers": ["fog", "thunder"] }`
  or `{ "id": "legs", "text": "How many legs is the right number of legs?", "range": { "min": 0, "max": 100 } }`.

- [ ] **Step 1: Write the fixture**

`warden/test/fixtures/question-bank.json` -- four entries, deliberately
covering every shape and NOT drawn from the real bank:

```json
[
  { "id": "t-two", "text": "Fog or thunder?", "answers": ["fog", "thunder"] },
  { "id": "t-list", "text": "Keep one: a key, a feather, or a lantern?", "answers": ["key", "feather", "lantern"] },
  { "id": "t-range", "text": "How many legs is the right number of legs?", "range": { "min": 0, "max": 100 } },
  { "id": "t-shy", "text": "Is a tomato brave or shy?", "answers": ["brave", "shy"] }
]
```

- [ ] **Step 2: Write the failing tests**

`warden/test/question.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertBankSane, questionFor, answerIndex, publicShape } from "../src/mcp/question.mjs";

const BANK = JSON.parse(readFileSync(new URL("./fixtures/question-bank.json", import.meta.url), "utf8"));
const byId = (id) => BANK.find((q) => q.id === id);

test("the fixture bank is sane", () => { assert.equal(assertBankSane(BANK), BANK); });

test("a malformed bank is refused, entry by entry", () => {
  const bad = [
    [{ id: "a", text: "x", answers: ["one"] }],
    [{ id: "a", text: "x", answers: Array.from({ length: 17 }, (_, i) => `o${i}`) }],
    [{ id: "a", text: "x", answers: ["same", "SAME"] }],
    [{ id: "a", text: "x", range: { min: 0, max: 101 } }],
    [{ id: "a", text: "x", range: { min: 5, max: 5 } }],
    [{ id: "a", text: "x" }],
    [{ id: "a", text: "x", answers: ["a", "b"] }, { id: "a", text: "y", answers: ["a", "b"] }],
    [{ id: "a", text: "caf\u00e9?", answers: ["a", "b"] }],
    [],
  ];
  for (const bank of bad) assert.throws(() => assertBankSane(bank), undefined, JSON.stringify(bank));
});

test("the day's question is the same for every caller and changes by day", () => {
  const a = questionFor(20700, "s", BANK);
  assert.deepEqual(questionFor(20700, "s", BANK), a);
  const seen = new Set(Array.from({ length: 40 }, (_, i) => questionFor(20700 + i, "s", BANK).id));
  assert.ok(seen.size > 1);
});

test("answers match ignoring case and surrounding space", () => {
  assert.equal(answerIndex(byId("t-two"), "Fog "), 0);
  assert.equal(answerIndex(byId("t-two"), "THUNDER"), 1);
  assert.equal(answerIndex(byId("t-two"), "rain"), null);
});

test("a range takes a number or a numeric string, inside the range only", () => {
  const legs = byId("t-range");
  assert.equal(answerIndex(legs, 42), 42);
  assert.equal(answerIndex(legs, "42"), 42);
  assert.equal(answerIndex(legs, 101), null);
  assert.equal(answerIndex(legs, 4.5), null);
  assert.equal(answerIndex(legs, "4x"), null);
});

test("the public shape never carries the id", () => {
  assert.deepEqual(publicShape(byId("t-range")), { question: "How many legs is the right number of legs?", range: { min: 0, max: 100 } });
  assert.equal("id" in publicShape(byId("t-two")), false);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd warden && npm test -- --test-name-pattern "bank|question|answers|range|public shape"`
Expected: FAIL -- module not found.

- [ ] **Step 4: Implement `question.mjs`**

```js
// The daily question: which one is asked, and whether an answer is in its set.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

/// Measured in Task 10 of Plan B; a constant so changing it needs no redeploy.
export const ANSWER_WINDOW_MS = 60_000;

const MAX_OPTIONS = 16;
const MAX_RANGE = 101;
const ASCII = /^[\x20-\x7e]+$/;
const norm = (s) => String(s).trim().toLowerCase();

export function assertBankSane(bank) {
  if (!Array.isArray(bank) || bank.length === 0) throw new Error("question bank is empty");
  const ids = new Set();
  for (const q of bank) {
    if (typeof q.id !== "string" || !q.id || ids.has(q.id)) throw new Error(`question id missing or repeated: ${q.id}`);
    ids.add(q.id);
    if (typeof q.text !== "string" || !ASCII.test(q.text)) throw new Error(`question ${q.id}: text must be printable ASCII`);
    if (Array.isArray(q.answers) === (q.range !== undefined)) throw new Error(`question ${q.id}: exactly one of answers or range`);
    if (q.answers) {
      if (q.answers.length < 2 || q.answers.length > MAX_OPTIONS) throw new Error(`question ${q.id}: 2 to ${MAX_OPTIONS} answers`);
      if (!q.answers.every((a) => typeof a === "string" && ASCII.test(a))) throw new Error(`question ${q.id}: answers must be printable ASCII`);
      if (new Set(q.answers.map(norm)).size !== q.answers.length) throw new Error(`question ${q.id}: answers repeat`);
    } else {
      const { min, max } = q.range;
      if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min + 1 > MAX_RANGE) {
        throw new Error(`question ${q.id}: range must be 2 to ${MAX_RANGE} integers`);
      }
    }
  }
  return bank;
}

export function loadBank(path) {
  return assertBankSane(JSON.parse(readFileSync(path, "utf8")));
}

/// Keyed by the Warden's secret so the day's question cannot be read in advance.
export function questionFor(day, secret, bank) {
  const h = createHmac("sha256", secret).update(`question:${day}`).digest();
  return bank[h.readUInt32BE(0) % bank.length];
}

export function answerIndex(q, answer) {
  if (q.answers) {
    if (typeof answer !== "string") return null;
    const i = q.answers.findIndex((a) => norm(a) === norm(answer));
    return i === -1 ? null : i;
  }
  const n = typeof answer === "number" ? answer : /^\s*-?\d+\s*$/.test(String(answer)) ? Number(answer) : NaN;
  if (!Number.isInteger(n) || n < q.range.min || n > q.range.max) return null;
  return n - q.range.min;
}

export function publicShape(q) {
  return q.answers ? { question: q.text, answers: [...q.answers] } : { question: q.text, range: { ...q.range } };
}
```

Note the range index is `n - min`, so `answerIndex(legs, 42)` is 42 only
because that range starts at 0 -- the test above uses that range on purpose.

- [ ] **Step 5: Run the tests and watch them pass**

Same command as Step 3. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add warden/src/mcp/question.mjs warden/test/question.test.mjs warden/test/fixtures/question-bank.json
git commit -m "feat(warden): the question bank, its checks and the day's choice"
```

---

### Task 4: The mirror's `questions` table

**Files:**
- Modify: `warden/src/mirror/schema.sql`
- Modify: `warden/src/mirror/queries.mjs`
- Test: `warden/test/mirror.test.mjs`

**Interfaces:**
- Produces, on `q`:
  - `issueQuestion(tokenId, day, questionId, issuedAt) -> { questionId, issuedAt }` -- the FIRST issue wins; a repeat returns the stored row.
  - `getQuestion(tokenId, day) -> row | undefined` (`{ tokenId, day, questionId, issuedAt, answer, answeredAt }`)
  - `recordAnswer(tokenId, day, answer, answeredAt) -> void` (call inside the credit transaction)

A NEW table needs no `migrate()` step: `CREATE TABLE IF NOT EXISTS` is safe on
every open, and nothing in it references a column `migrate()` adds
(`.claude/rules/warden.md`).

- [ ] **Step 1: Write the failing tests**

Append to `warden/test/mirror.test.mjs` (use its existing `openDb(":memory:")`
+ `queries(db)` setup):

```js
test("a question is issued once per token and day; the first issue wins", () => {
  const q = queries(openDb(":memory:"));
  assert.deepEqual(q.issueQuestion(1, 20700, "t-two", 1000), { questionId: "t-two", issuedAt: 1000 });
  assert.deepEqual(q.issueQuestion(1, 20700, "t-list", 5000), { questionId: "t-two", issuedAt: 1000 });
  assert.deepEqual(q.issueQuestion(2, 20700, "t-list", 5000), { questionId: "t-list", issuedAt: 5000 });
});

test("an answer is recorded against the issued question", () => {
  const q = queries(openDb(":memory:"));
  q.issueQuestion(1, 20700, "t-two", 1000);
  q.recordAnswer(1, 20700, 1, 3000);
  const row = q.getQuestion(1, 20700);
  assert.equal(row.answer, 1);
  assert.equal(row.answeredAt, 3000);
  assert.equal(q.getQuestion(1, 20701), undefined);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd warden && npm test -- --test-name-pattern "question is issued|answer is recorded"`
Expected: FAIL -- `q.issueQuestion is not a function`.

- [ ] **Step 3: Add the table**

Append to `schema.sql`:

```sql
-- The day's question as issued to one token, and the answer it gave.
-- answer is the index into the question's answer set; NULL is silent.
CREATE TABLE IF NOT EXISTS questions (
  tokenId    INTEGER NOT NULL,
  day        INTEGER NOT NULL,
  questionId TEXT    NOT NULL,
  issuedAt   INTEGER NOT NULL,
  answer     INTEGER,
  answeredAt INTEGER,
  PRIMARY KEY (tokenId, day)
);
```

- [ ] **Step 4: Add the queries**

In `queries.mjs`, in the prepared-statement object `s`:

```js
    issueQuestion: db.prepare(
      "INSERT OR IGNORE INTO questions (tokenId, day, questionId, issuedAt) VALUES (?, ?, ?, ?)"
    ),
    getQuestion: db.prepare("SELECT * FROM questions WHERE tokenId = ? AND day = ?"),
    recordAnswer: db.prepare("UPDATE questions SET answer = ?, answeredAt = ? WHERE tokenId = ? AND day = ?"),
```

and in the returned object:

```js
    issueQuestion(tokenId, day, questionId, issuedAt) {
      s.issueQuestion.run(tokenId, day, questionId, issuedAt);
      const row = s.getQuestion.get(tokenId, day);
      return { questionId: row.questionId, issuedAt: row.issuedAt };
    },
    getQuestion(tokenId, day) {
      return s.getQuestion.get(tokenId, day);
    },
    recordAnswer(tokenId, day, answer, answeredAt) {
      s.recordAnswer.run(answer, answeredAt, tokenId, day);
    },
```

- [ ] **Step 5: Run and watch them pass, then the whole Warden suite**

Run the Step 2 command, then `cd warden && ~/scripts/safe-build.sh npm test`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add warden/src/mirror/schema.sql warden/src/mirror/queries.mjs warden/test/mirror.test.mjs
git commit -m "feat(mirror): the questions table"
```

---

### Task 5: The `question` tool

**Files:**
- Create: `warden/src/mcp/tools/question.mjs`
- Modify: `warden/src/mcp/server.mjs` (`TOOL_FACTORIES`, `instructions`)
- Modify: every place that builds `makeMcpHandler` deps: `warden/test/e2e/join.test.mjs`,
  `warden/test/mcp.test.mjs`, `warden/test/tool-convention.test.mjs`,
  `warden/test/resources.test.mjs`, `client/test/journey.test.mjs`,
  `client/test/cli.test.mjs`, `warden/tools/protocol-transcript.mjs`,
  `warden/tools/x402-live-mint-check.mjs`
- Test: `warden/test/question-tool.test.mjs`

**Interfaces:**
- Consumes: `questionFor`, `publicShape`, `ANSWER_WINDOW_MS` (Task 3); `q.issueQuestion`, `q.getToken` (Task 4).
- Produces: `makeQuestionTool({ q, bank, challengeSecret, today = utcDay, now = Date.now })`, tool name `"question"`, input `{ tokenId }`.
  Reply `{ ok: true, day, question, answers | range, answerBy }`.
- Produces: `makeMcpHandler` deps gain `bank` (required).

- [ ] **Step 1: Write the failing tests**

`warden/test/question-tool.test.mjs`:

```js
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd warden && npm test -- --test-name-pattern "the question is the day|second look|refusals: unbound"`
Expected: FAIL -- module not found.

- [ ] **Step 3: Implement the tool**

`warden/src/mcp/tools/question.mjs`:

```js
// The daily question. Seeing it spends the token's look for the day.
import * as z from "zod";
import { utcDay } from "../../day.mjs";
import { FINISH_LEVEL } from "../ladder.mjs";
import { questionFor, publicShape, ANSWER_WINDOW_MS } from "../question.mjs";

export function makeQuestionTool({ q, bank, challengeSecret, today = utcDay, now = Date.now }) {
  if (!Array.isArray(bank)) throw new Error("question tool needs the question bank");
  if (!challengeSecret) throw new Error("question tool needs the challenge secret");
  return {
    name: "question",
    config: {
      title: "Today's question",
      description:
        "Today's question for a token bound to your key. Free. Answer it with `checkin { tokenId, answer }` before `answerBy`. One look per token per UTC day: asking again returns the same question and the same deadline. A late or missing answer still credits the day.",
      inputSchema: z.object({ tokenId: z.number().int().positive().describe("A token bound to your key.") }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },

    async handler({ tokenId }, ctx) {
      const token = q.getToken(tokenId);
      if (!token) return { ok: false, reason: "unknown-token" };
      // Mirror only: a stale binding costs a look, never a credit; checkin re-checks the chain.
      if (token.keyId !== ctx.keyId) return { ok: false, reason: "not-bound-to-caller" };
      if (token.level >= FINISH_LEVEL) return { ok: false, reason: "year-complete" };
      const day = today();
      if (day <= token.lastDay) return { ok: false, reason: "already-credited-today" };

      const chosen = questionFor(day, challengeSecret, bank);
      const issued = q.issueQuestion(tokenId, day, chosen.id, now());
      const asked = bank.find((b) => b.id === issued.questionId) ?? chosen;
      return {
        ok: true,
        day,
        ...publicShape(asked),
        answerBy: new Date(issued.issuedAt + ANSWER_WINDOW_MS).toISOString(),
      };
    },
  };
}
```

- [ ] **Step 4: Register it and require the bank everywhere**

`server.mjs`: import `makeQuestionTool` and add it to `TOOL_FACTORIES` directly
before `makeCheckinTool`. In `instructions`, after "checkin is free and is the
whole daily obligation;" insert "ask `question` first and pass your answer to
checkin;". Then add `bank` to every `makeMcpHandler({...})` call listed under
Files, loaded from the fixture:

```js
const BANK = JSON.parse(readFileSync(new URL("<relative path to>/warden/test/fixtures/question-bank.json", import.meta.url), "utf8"));
```

(use the correct relative path from each file; the two `warden/tools` scripts
take `loadBank(process.env.MRO_QUESTION_BANK ?? join(homedir(), ".mro-questions", "bank.json"))`
instead, because they talk to a real bank). Make sure each of those call sites
also passes `challengeSecret` -- most already do.

- [ ] **Step 5: Run all four suites**

Expected: PASS. `tool-convention.test.mjs` iterates `TOOL_FACTORIES`, so it
checks the new tool's `ok` convention with no edit beyond its deps.

- [ ] **Step 6: Commit**

```bash
git add warden/src/mcp warden/test client/test warden/tools
git commit -m "feat(warden): the question tool"
```

---

### Task 6: `checkin` takes an answer

**Files:**
- Modify: `warden/src/mcp/tools/checkin.mjs`
- Test: `warden/test/tools.test.mjs`

**Interfaces:**
- Consumes: `answerIndex`, `ANSWER_WINDOW_MS` (Task 3); `q.getQuestion`, `q.recordAnswer` (Task 4).
- Produces: `makeCheckinTool({ q, chain, bank, today, now = Date.now })`; input
  `{ tokenId, answer? }` with `answer` a string or an integer. Every accepted
  reply gains `answered: boolean`. New refusal reason `invalid-answer`, carrying
  `answerBy`.

- [ ] **Step 1: Write the failing tests**

In `tools.test.mjs`, the existing `makeCheckinTool` calls gain `bank: BANK`
(load the fixture as in Task 5). Then add:

```js
function withQuestion({ issuedAt = 1_000 } = {}) {
  const { db, q } = withToken();
  q.issueQuestion(1, 101, "t-two", issuedAt);
  return { db, q };
}

test("an answer inside the window is recorded with the credit", async () => {
  const { q } = withQuestion();
  const tool = makeCheckinTool({ q, chain: noChainRead, bank: BANK, today: () => 101, now: () => 5_000 });
  const r = await tool.handler({ tokenId: 1, answer: "Thunder" }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(r.answered, true);
  assert.equal(q.getQuestion(1, 101).answer, 1);
});

test("an answer outside the set, in time, is refused and NOT credited", async () => {
  const { db, q } = withQuestion();
  const tool = makeCheckinTool({ q, chain: noChainRead, bank: BANK, today: () => 101, now: () => 5_000 });
  const r = await tool.handler({ tokenId: 1, answer: "rain" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid-answer");
  assert.equal(creditsFor(db, 1).length, 0);
  const again = await tool.handler({ tokenId: 1, answer: "fog" }, { keyId: "k1" });
  assert.equal(again.answered, true);
});

test("a late answer, valid or not, credits the day as silent", async () => {
  const { q } = withQuestion();
  const late = 1_000 + ANSWER_WINDOW_MS + 1;
  const tool = makeCheckinTool({ q, chain: noChainRead, bank: BANK, today: () => 101, now: () => late });
  const r = await tool.handler({ tokenId: 1, answer: "rain" }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(r.answered, false);
  assert.equal(q.getQuestion(1, 101).answer, null);
});

test("an answer with no question asked credits the day as silent", async () => {
  const { q } = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, bank: BANK, today: () => 101, now: () => 5_000 });
  const r = await tool.handler({ tokenId: 1, answer: "fog" }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(r.answered, false);
});

test("no answer at all is accepted and says so", async () => {
  const { q } = withQuestion();
  const tool = makeCheckinTool({ q, chain: noChainRead, bank: BANK, today: () => 101, now: () => 5_000 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.answered, false);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd warden && npm test -- --test-name-pattern "answer"`
Expected: FAIL -- `answered` is undefined and `invalid-answer` is never returned.

- [ ] **Step 3: Implement**

In `checkin.mjs`: accept `bank` and `now` in the factory, and require the bank
the same way `requireChain` requires the chain:

```js
export function makeCheckinTool({ q, chain, bank, today = utcDay, now = Date.now }) {
  requireChain(chain, "checkin");
  if (!Array.isArray(bank)) throw new Error("checkin needs the question bank");
```

The input schema:

```js
      inputSchema: z.object({
        tokenId: z.number().int().positive().describe("A token bound to your key."),
        answer: z.union([z.string().max(64), z.number().int()]).optional()
          .describe("Your answer to today's `question`, before its answerBy."),
      }),
```

and the description gains, at its end: " Ask `question` first and pass your
answer here; a late or missing answer still credits the day."

In the handler signature, take `{ tokenId, answer }`. Directly AFTER the
`day <= token.lastDay` guard and BEFORE the chain reads, decide the answer:

```js
      const asked = q.getQuestion(tokenId, day);
      const inTime = asked && answer !== undefined && now() <= asked.issuedAt + ANSWER_WINDOW_MS;
      let answerIdx = null;
      if (inTime) {
        const entry = bank.find((b) => b.id === asked.questionId);
        answerIdx = entry ? answerIndex(entry, answer) : null;
        if (answerIdx === null) {
          return {
            ok: false, accepted: false, reason: "invalid-answer",
            answerBy: new Date(asked.issuedAt + ANSWER_WINDOW_MS).toISOString(),
          };
        }
      }
```

Inside the existing credit transaction, after `q.creditDay(...)`:

```js
        if (answerIdx !== null) q.recordAnswer(tokenId, day, answerIdx, now());
```

and add `answered: answerIdx !== null,` to the accepted reply, after `heart`.

Import `answerIndex` and `ANSWER_WINDOW_MS` from `../question.mjs`.

- [ ] **Step 4: Add `invalid-answer` to the next-step table**

`warden/src/mcp/nextSteps.mjs` maps every refusal reason to a next step (C3.7).
Add: `"invalid-answer": "Your answer is not one of today's options. Send one of them before answerBy; after that the day is credited without an answer."`
Read `warden/test/next-steps.test.mjs` first: if it already fails for a
reason with no entry, running `cd warden && npm test` checks this step; if it
does not, add a test there asserting `withNext({ ok: false, reason:
"invalid-answer" })` carries a `next`.

- [ ] **Step 5: Run all four suites**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add warden/src/mcp warden/test
git commit -m "feat(warden): checkin records the day's answer"
```

---

### Task 7: The Warden loads the bank at boot

**Files:**
- Modify: `warden/src/main.mjs`
- Modify: `warden/.env.example`
- Test: `warden/test/question.test.mjs`

**Interfaces:**
- Produces: `bankPath(env = process.env) -> string` exported from `question.mjs`.

- [ ] **Step 1: Write the failing test**

```js
import { bankPath } from "../src/mcp/question.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

test("the bank path is the setting, else the private default outside the worktree", () => {
  assert.equal(bankPath({ MRO_QUESTION_BANK: "/x/bank.json" }), "/x/bank.json");
  assert.equal(bankPath({}), join(homedir(), ".mro-questions", "bank.json"));
});
```

- [ ] **Step 2: Run, watch it fail, implement, watch it pass**

In `question.mjs`:

```js
import { homedir } from "node:os";
import { join } from "node:path";

/// Outside every worktree: the repository is public and the bank must not be.
export function bankPath(env = process.env) {
  return env.MRO_QUESTION_BANK || join(homedir(), ".mro-questions", "bank.json");
}
```

- [ ] **Step 3: Load it in `main.mjs`, failing loudly**

Beside the other boot-time reads, before `makeMcpHandler`:

```js
  // A missing or malformed bank stops the Warden here, before it admits anyone.
  const bank = loadBank(bankPath());
```

and pass `bank` in the `makeMcpHandler({...})` deps.

`.env.example` gains, commented, after `STATE_DB_PATH`:

```
# Optional. The private question bank; default is .mro-questions/bank.json in the home directory.
# MRO_QUESTION_BANK=
```

- [ ] **Step 4: Run all four suites, then commit**

```bash
git add warden/src/main.mjs warden/src/mcp/question.mjs warden/test/question.test.mjs warden/.env.example
git commit -m "feat(warden): the question bank is loaded at boot"
```

---

### Task 8: The reference client asks and answers

**Files:**
- Modify: `client/src/cli.mjs`
- Test: `client/test/cli.test.mjs`, `client/test/journey.test.mjs`

**Interfaces:**
- Produces: command `mro-agent question --token <id>`; flag `--answer <value>`
  on `beat`. A value of only digits (optionally signed) is sent as an integer,
  anything else as a string.

- [ ] **Step 1: Write the failing journey test**

In `journey.test.mjs`, after the existing check-in step of the journey (or as a
new test using the same harness), drive the two commands against the real
in-process Warden:

```js
test("question, then beat --answer, records the answer", async () => {
  const asked = await runCli(["question", "--token", String(tokenId), ...siteArgs]);
  assert.match(asked.stdout, /question: /);
  const shape = JSON.parse(asked.stdout.slice(asked.stdout.indexOf("{")));
  const answer = shape.answers ? shape.answers[0] : String(shape.range.min);
  const beat = await runCli(["beat", "--token", String(tokenId), "--answer", answer, ...siteArgs]);
  assert.match(beat.stdout, /"answered": true/);
});
```

(`runCli`, `tokenId` and `siteArgs` stand for the harness's existing helpers
for running the CLI against the test Warden and for the minted token; use the
names that file already defines.)

Also add to `cli.test.mjs`: `--answer` is a known flag, and `question` without
`--token` throws `--token <id> is required for question`.

- [ ] **Step 2: Run, watch them fail**

Run: `cd client && npm test`
Expected: FAIL -- unknown command `question`, unknown option `--answer`.

- [ ] **Step 3: Implement**

`cli.mjs`:
- `COMMANDS` gains `"question"`; `FLAGS` gains `"answer"`.
- Usage lines:
  `mro-agent question --token <id>    today's question; answer it with beat --answer`
  `mro-agent beat   --token <id> [--answer <a>]  check in for today, with your answer`
- `question` joins the `ladder`/`rebind`/`rest` branch, which already calls the
  tool named by the command with `{ tokenId }`.
- `beat`:

```js
  if (command === "beat") {
    if (!args.token) throw new Error("--token <id> is required");
    const toolArgs = { tokenId: Number(args.token) };
    if (args.answer !== undefined) toolArgs.answer = /^\s*-?\d+\s*$/.test(args.answer) ? Number(args.answer) : args.answer;
    const result = await callTool({ ...call, name: "checkin", arguments: toolArgs });
    report("checkin", result);
    return;
  }
```

- [ ] **Step 4: Run all four suites, then commit**

```bash
git add client/src/cli.mjs client/test
git commit -m "feat(client): question, and beat --answer"
```

---

### Task 9: The bank itself, and the agent-facing copy -- STOP for approval

**Files:**
- Create (OUTSIDE the repository): `.mro-questions/bank.json` in the home directory, directory mode 700, file mode 600
- Create: `warden/tools/check-question-bank.mjs`
- Modify (after approval only): `warden/public/llms.txt`, `skills/machine-readable-only/SKILL.md`,
  `docs/2026-09-01-mro-raw-protocol.md`, the door page under `warden/public/`

- [ ] **Step 1: The bank checker**

`warden/tools/check-question-bank.mjs` -- prints counts only, never a question,
so its output is safe in any log:

```js
// Validate the private question bank and print its shape, never its content.
//   node warden/tools/check-question-bank.mjs
import { loadBank, bankPath } from "../src/mcp/question.mjs";

const bank = loadBank(bankPath());
const two = bank.filter((q) => q.answers?.length === 2).length;
const list = bank.filter((q) => q.answers?.length > 2).length;
const range = bank.filter((q) => q.range).length;
console.log(`question bank: ${bank.length} questions (${two} two-way, ${list} lists, ${range} ranges)`);
```

- [ ] **Step 2: Write the bank**

At least 300 questions, written to the path above with `mkdir -m 700` and
`chmod 600`. Rules, from the spec and the operator: short; a little strange;
concrete; fun to repeat when an agent is asked "what were you asked today?";
roughly 60% two-way, 25% lists of 3 to 6, 15% ranges; no question about the
agent's operator, money, politics, religion, health or real people; printable
ASCII; ids in kebab-case. Run the checker; it must pass.

Copy the file to the existing private backups directory (`.mro-state-backups`
in the home directory) with mode 600.

- [ ] **Step 3: Draft the agent-facing copy, and STOP**

The narrative copy is LOCKED (`docs/2026-09-01-mro-agent-facing-copy.md`; the
`agent-facing-copy-locked` memory). Draft, in one file at
`tools/out/plan-b-copy-draft.md` (gitignored), every sentence this feature adds
to `llms.txt`, SKILL.md, the raw protocol doc and the door page:

- the daily step: ask `question`, then `checkin` with `answer`;
- the window, as "about a minute" until Task 10 measures it;
- one look per day; silence still credits the day;
- **a scheduled (cron) check-in has no model in it, so it is silent every day**
  -- the agent answers only when it runs the two steps itself;
- the answers become the border; the rule that turns them into squares is
  secret on the day and checkable afterwards;
- never the rule itself.

Render it (`~/scripts/render-md-to-html.js`, one argument), send it to the
operator, and wait. Apply only the approved wording, then run all four suites
(copy is pinned by tests in `warden/test/door-page.test.mjs` and others; update
the pins to the approved text, never the reverse).

- [ ] **Step 4: Commit (after approval)**

```bash
git add warden/tools/check-question-bank.mjs warden/public skills docs/2026-09-01-mro-raw-protocol.md
git commit -m "docs: the daily question reaches every agent-facing surface"
```

---

### Task 10: Measure the window, then go live on Base Sepolia

**Files:**
- Create: `tools/out/answer-window/probe.mjs` (gitignored; throwaway)
- Modify: `warden/src/mcp/question.mjs` (`ANSWER_WINDOW_MS`, the measured value)

- [ ] **Step 1: The probe**

A script that starts a Warden IN PROCESS on `127.0.0.1` with a SCRATCH mirror
(never the live one: `.claude/rules/warden.md`), the REAL bank,
`chain-stub.mjs`'s open chain, and five tokens seeded directly into the scratch
mirror, each bound to a fresh probe key. Build it from the same parts
`client/test/journey.test.mjs` uses; print the endpoint and the five token ids.

- [ ] **Step 2: Five real-agent trials**

For each token, dispatch a FRESH subagent with only SKILL.md and this
instruction: "You are checking in for token N at <endpoint>. Run `mro-agent
question --token N --endpoint <endpoint> --site <site>`, answer the question as
yourself, then run `mro-agent beat --token N --answer <your answer> ...`."
Read `issuedAt` and `answeredAt` from the scratch mirror for each.

- [ ] **Step 3: Set the window**

`ANSWER_WINDOW_MS` = twice the slowest of the five, rounded UP to the next
15 seconds, and never below 30 seconds. Write the five measurements and the
chosen value into the commit message, not the code. Run all four suites.

```bash
git add warden/src/mcp/question.mjs
git commit -m "feat(warden): the answer window, as measured"
```

- [ ] **Step 4: Rehearse, then STOP for the push and the re-create**

Run `warden/tools/rehearse-start.sh` (the real `main.mjs` against a copy of
production state); it must boot with the real bank. Then STOP: the push and the
live Warden re-create are outward-facing. Ask the operator. On approval:
`git push` (the pre-push hook runs both leak guards), then re-create the Warden
as the `warden-deployed` memory describes (`pm2 delete` + `pm2 start`, then
`pm2 save` -- never `--update-env`).

- [ ] **Step 5: Probe what changed, live**

- An unsigned POST to `/mcp` answers 401 with a challenge (unchanged).
- A request signed WITHOUT the challenge components, with a correct answer,
  answers 401 `components` -- the relayer case, live.
- The test agent's daily check-in (its cron) still succeeds on the next run;
  confirm from the Warden log the next UTC day.
- `mro-agent question` then `beat --answer` on the test agent's token succeeds
  on a day it has not yet checked in.

---

### Task 11: The staged npm package -- STOP

`mro-agent@0.1.0` is STAGED with signed provenance and signs only five
components, so after Task 10 it cannot get through the door. It must NOT be
approved. Record this in the `publishing-facts` memory. A new version is staged
through the release workflow only on the operator's word, because staging
publishes.

---

## Self-review

- Spec coverage: section 4 (bank: Tasks 3, 7, 9), section 6 (`question`: Task
  5; `checkin` answer: Task 6; window: Task 10; client: Task 8; signed answer:
  already covered by content-digest, pinned by Task 1's component rule),
  section 8 (warden, client, agent copy: Tasks 3-9), section 9 (Plan B's share).
  Sections 5 and 7 (the split, the chain) are Plan A by design.
- Rulings 4 and 5: Tasks 1 and 2, each with the relayer / hand-built-base test.
- The live seed agent (token 1's daily script) and every cron user are silent
  by construction; the copy says so (Task 9), and the spec accepts it.
