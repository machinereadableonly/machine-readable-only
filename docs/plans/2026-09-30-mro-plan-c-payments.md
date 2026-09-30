# Plan C: payments -- the refusal probe and the unresolved-payment answer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> After completing any operator-only step, tell Claude so it can update memory
> immediately. This plan has none: the live probe (Task 2) was approved by the
> operator on 2026-09-30 and runs on Base Sepolia only.

**Goal:** Learn how both facilitators refuse a payment, treat an explicit
refusal as declined whatever HTTP status it arrives with, and tell an agent the
truth when a payment's outcome is unknown.

**Why:** Rulings 7 and 6 of the 2026-09-28 review. Today every thrown settle is
"unknown", so a facilitator that refuses with a non-2xx makes an agent wait a
night for an answer that was already "no". And when the outcome really is
unknown, the agent is told "NOTHING WAS MINTED, and the site released its
reservation" -- both false since the 2026-09-28 fixes, and the sentence that
invites paying twice. The client is staged on npm and not yet released, so
this must land before it is.

**Architecture:** The gateway's `settlePayment` observer already classifies a
returned `success: false` with `isDeclined`. It gains the same judgement for a
thrown `SettleError`, which carries the facilitator's own answer. The unresolved
branch of `paid()` stops returning @x402/mcp's settlement-failed demand and
returns a refusal of its own, reason `payment-unresolved`, whose `next` carries
the approved wording. The client prints the approved message for that reason.

**Tech Stack:** Node 24.14.1, `node:test`, `@x402/core` / `@x402/mcp` /
`@x402/evm` as installed, viem.

**Spec:** `docs/reviews/2026-09-28/00-verification.md` (Payments table and
Rulings 6 and 7); roadmap `docs/plans/2026-09-30-mro-rulings-roadmap.md`.

## Global Constraints

- Plain ASCII only in code, comments and docs.
- All four suites green before every commit: `cd contracts && forge test`, and
  `npm test` in `tools/`, `warden/`, `client/`. Heavy runs go through
  `~/scripts/safe-build.sh`. Never pipe a gate into anything.
- Use `/bin/grep`, never bare `grep`. Node needs `source ~/.nvm/nvm.sh`.
- The repository is PUBLIC: no absolute paths, no key ids, no secrets, no AI
  attribution in files or commit messages.
- New files take the licence LICENSING.md assigns their directory
  (`warden/tools` is PolyForm Noncommercial; nothing new here is agent-run).
- Never print a secret. The probe reads keys itself and prints none of them.
- The approved mint wording, verbatim (ruling 6):
  "The payment's outcome is not known yet. It may have gone through, so the
  site is HOLDING your reservation. Do not pay again. At the next 00:05 UTC the
  site checks the chain. If the payment landed, your token is minted then. If
  it did not, the reservation is released and no money moved. Check after
  00:05 UTC: mro-agent status --site <site>". For a Mark: "your Mark is applied
  then". The Warden's `next` says "Check after 00:05 UTC with `status`" instead
  of the `mro-agent` line, because an MCP caller may not be running mro-agent.
- The plain-refusal text (`paymentFailedMessage`) stays exactly as it is.

## Review Focus

1. **A non-2xx refusal carrying a transaction hash** must stay HELD: a hash
   means a transfer was broadcast. Pinned in Task 3.
2. **A non-2xx refusal with a reason this build has never seen** must stay
   HELD. Pinned in Task 3.
3. **A thrown error that is not a SettleError** (timeout, 502 with an HTML
   body, a dropped socket) must stay HELD. Pinned in Task 3.
4. **The hold itself failing** (the database write throws) must still answer
   `payment-unresolved`, never the old "released" demand: the money is unknown
   either way. Pinned in Task 4.
5. **A Mark order held unresolved** must say "Mark", not "token". Pinned in
   Task 4.

## Files

| File | Change |
|---|---|
| `warden/src/pay/x402.mjs` | Export `initResourceServer`; classify a thrown `SettleError`; export `unresolvedRefusal(tool)`; the unresolved branch returns it |
| `warden/src/mcp/nextSteps.mjs` | `NEXT["payment-unresolved"]` (mint wording) and `UNRESOLVED_MARK_NEXT` |
| `warden/tools/facilitator-refusal-probe.mjs` | New: the live probe, with a pure `refusalCases()` |
| `warden/test/facilitator-refusal-probe.test.mjs` | New: offline test of `refusalCases()` |
| `warden/test/settlement-commit.test.mjs` | Non-2xx facilitator modes; unresolved answers |
| `client/src/messages.mjs`, `client/src/index.mjs` | `unresolvedPaymentMessage(site)` |
| `client/src/cli.mjs` | Print it for `payment-unresolved`, exit 2 |
| `client/test/cli.test.mjs` | The unresolved path through the real CLI |
| `skills/machine-readable-only/references/refusals.md` | A `payment-unresolved` row |
| `docs/2026-09-01-mro-raw-protocol.md` + skill copy | The unknown-outcome paragraph |
| `docs/reviews/2026-09-28/40-facilitator-refusal-probe.md` | New: what both facilitators answered |

---

### Task 1: The refusal probe tool

**Files:**
- Modify: `warden/src/pay/x402.mjs:191` (`async function initResourceServer` -> `export async function initResourceServer`)
- Create: `warden/tools/facilitator-refusal-probe.mjs`
- Test: `warden/test/facilitator-refusal-probe.test.mjs`

**Interfaces:**
- Produces: `refusalCases({ requirement, walletPrivateKey, now }) -> Promise<Array<{ name, requirement, payload }>>`, three cases named `expired`, `overdrawn`, `bad-signature`, each with its own nonce.
- Consumes: `signAuthorization` and `paymentMeta` from `client/src/pay.mjs` (the real signer, so the probe signs exactly as an agent does).

None of the three can move money: `expired` has `validBefore` in the past,
`overdrawn` asks for a million USDC from a wallet holding a few, and
`bad-signature` fails signature recovery.

- [ ] **Step 1: Write the failing test**

```js
// warden/test/facilitator-refusal-probe.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { refusalCases } from "../tools/facilitator-refusal-probe.mjs";

const REQUIREMENT = {
  scheme: "exact", network: "eip155:84532", amount: "1000000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x000000000000000000000000000000000000dEaD", maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};
const NOW = 1_790_000_000;

test("the probe builds three refusals, each unable to move money", async () => {
  const cases = await refusalCases({ requirement: REQUIREMENT, walletPrivateKey: generatePrivateKey(), now: NOW });
  assert.deepEqual(cases.map((c) => c.name), ["expired", "overdrawn", "bad-signature"]);

  const auth = (c) => c.payload.payload.authorization;
  const expired = cases[0];
  assert.ok(Number(auth(expired).validBefore) < NOW, "an expired authorisation is dead on arrival");

  const overdrawn = cases[1];
  assert.equal(overdrawn.requirement.amount, "1000000000000", "a million USDC");
  assert.equal(auth(overdrawn).value, overdrawn.requirement.amount, "signed for exactly what is asked");

  const bad = cases[2];
  assert.match(bad.payload.payload.signature, /^0x[0-9a-f]{130}$/);
  assert.notEqual(bad.payload.payload.signature, cases[0].payload.payload.signature);

  const nonces = new Set(cases.map((c) => auth(c).nonce));
  assert.equal(nonces.size, 3, "one nonce per case, so no case can spend another's");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd warden && node --test test/facilitator-refusal-probe.test.mjs`
Expected: FAIL, `Cannot find module '../tools/facilitator-refusal-probe.mjs'`.

- [ ] **Step 3: Export `initResourceServer`**

In `warden/src/pay/x402.mjs` change `async function initResourceServer(` to
`export async function initResourceServer(`. Nothing else in the function changes.

- [ ] **Step 4: Write the probe**

```js
// warden/tools/facilitator-refusal-probe.mjs
// How does a facilitator say "no" to a settlement?
//
//   MRO_PROBE_KEY_FILE=<wallet key file> node tools/facilitator-refusal-probe.mjs [facilitator url]
//
// For CDP, pinned to IPv4 as the Warden runs, with the key from .env:
//   MRO_PROBE_KEY_FILE=<wallet key file> node --dns-result-order=ipv4first \
//     --no-network-family-autoselection --env-file=.env \
//     tools/facilitator-refusal-probe.mjs https://api.cdp.coinbase.com/platform/v2/x402
//
// Base Sepolia only. Each case is refused before any transfer can happen, so
// nothing moves. It prints what the Warden's own resource server saw: a
// returned settlement, or a thrown error with its status and reason.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { initResourceServer, MINT_PRICE } from "../src/pay/x402.mjs";
import { isCdpFacilitator, makeCdpAuthHeaders } from "../src/pay/cdp.mjs";
import { signAuthorization, paymentMeta, PAYMENT_META_KEY } from "../../client/src/pay.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const RESOURCE = { url: "mcp://tool/refusal-probe" };

async function payloadFor(requirement, walletPrivateKey, now) {
  const payload = await signAuthorization({ accepted: requirement, walletPrivateKey, now });
  return paymentMeta({ demand: { x402Version: 2, resource: RESOURCE }, accepted: requirement, payload })[PAYMENT_META_KEY];
}

export async function refusalCases({ requirement, walletPrivateKey, now = Math.floor(Date.now() / 1000) }) {
  // A day in the past: validBefore = now - 86400 + window, well before now.
  const expired = await payloadFor(requirement, walletPrivateKey, now - 86_400);

  const bigAsk = { ...requirement, amount: "1000000000000" };
  const overdrawn = await payloadFor(bigAsk, walletPrivateKey, now);

  const tampered = await payloadFor(requirement, walletPrivateKey, now);
  const sig = tampered.payload.signature;
  const flipped = (parseInt(sig.slice(-4, -2), 16) ^ 0xff).toString(16).padStart(2, "0");
  tampered.payload.signature = `${sig.slice(0, -4)}${flipped}${sig.slice(-2)}`;

  return [
    { name: "expired", requirement, payload: expired },
    { name: "overdrawn", requirement: bigAsk, payload: overdrawn },
    { name: "bad-signature", requirement, payload: tampered },
  ];
}

function describe(outcome) {
  if (outcome.threw) {
    const e = outcome.error;
    return { threw: true, name: e?.name ?? null, statusCode: e?.statusCode ?? null,
      errorReason: e?.errorReason ?? null, transaction: e?.transaction || null, message: e?.message ?? null };
  }
  const s = outcome.settlement;
  return { threw: false, success: s?.success ?? null, errorReason: s?.errorReason ?? null,
    transaction: s?.transaction || null };
}

async function main() {
  const facilitatorUrl = process.argv[2] ?? "https://x402.org/facilitator";
  const keyFile = process.env.MRO_PROBE_KEY_FILE;
  if (!keyFile) {
    console.error("set MRO_PROBE_KEY_FILE to a Base Sepolia wallet key file");
    process.exit(2);
  }
  const walletPrivateKey = readFileSync(keyFile, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(walletPrivateKey)) {
    console.error(`${keyFile} does not hold a 32-byte hex private key`);
    process.exit(2);
  }

  let createAuthHeaders;
  if (isCdpFacilitator(facilitatorUrl)) {
    const keyId = process.env.CDP_API_KEY_ID;
    const secret = process.env.CDP_API_KEY_SECRET;
    if (!keyId || !secret) {
      console.error("CDP needs CDP_API_KEY_ID and CDP_API_KEY_SECRET (use --env-file=.env)");
      process.exit(2);
    }
    createAuthHeaders = makeCdpAuthHeaders({ keyId, secret, facilitatorUrl });
  }

  // Throws if the facilitator does not offer exact on Base Sepolia. That is a
  // result, not a crash: stop and report it rather than trying another chain.
  const server = await initResourceServer(facilitatorUrl, NETWORK, createAuthHeaders);
  const [requirement] = await server.buildPaymentRequirements({ scheme: "exact", payTo: PAY_TO, price: MINT_PRICE, network: NETWORK });

  console.log(`facilitator : ${facilitatorUrl}`);
  console.log(`payer       : ${privateKeyToAccount(walletPrivateKey).address}`);
  for (const c of await refusalCases({ requirement, walletPrivateKey })) {
    let outcome;
    try {
      outcome = { threw: false, settlement: await server.settlePayment(c.payload, c.requirement) };
    } catch (error) {
      outcome = { threw: true, error };
    }
    console.log(`${c.name.padEnd(13)} ${JSON.stringify(describe(outcome))}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd warden && node --test test/facilitator-refusal-probe.test.mjs`
Expected: PASS. Importing the file ran nothing: `main()` sits behind the entry guard.

- [ ] **Step 6: Run all four suites, then commit**

```bash
git add warden/src/pay/x402.mjs warden/tools/facilitator-refusal-probe.mjs warden/test/facilitator-refusal-probe.test.mjs
git commit -m "feat(tools): a probe of how a facilitator refuses a settlement"
```

---

### Task 2: Run the probe against both facilitators and record it

**Files:**
- Create: `docs/reviews/2026-09-28/40-facilitator-refusal-probe.md` (+ `.html` via the renderer)

This is the outside call the operator approved. Base Sepolia only, the test
agent wallet as payer, three refusals per facilitator, nothing moves.

- [ ] **Step 1: Probe x402.org**

Run from `warden/`: `MRO_PROBE_KEY_FILE=$HOME/.mro-test-wallet/wallet.key node tools/facilitator-refusal-probe.mjs`
Expected: three lines, one per case. Each is either `"threw":true` with a
`statusCode`, or `"threw":false` with `"success":false`.

- [ ] **Step 2: Probe CDP, pinned to IPv4**

Run from `warden/`: `MRO_PROBE_KEY_FILE=$HOME/.mro-test-wallet/wallet.key node --dns-result-order=ipv4first --no-network-family-autoselection --env-file=.env tools/facilitator-refusal-probe.mjs https://api.cdp.coinbase.com/platform/v2/x402`
Expected: three lines as above.
If `initResourceServer` throws "no supported payment kinds", CDP does not offer
Base Sepolia: **STOP** and report to the operator. Probing mainnet is a
separate approval.

- [ ] **Step 3: Stop conditions**

STOP and report instead of continuing to Task 3 if any case shows a
`transaction` hash, or `success: true`. Either means a refusal case was not a
refusal, and the plan's premise is wrong.

- [ ] **Step 4: Write the record**

`docs/reviews/2026-09-28/40-facilitator-refusal-probe.md`: the date, the two
facilitator urls, the three cases and why none can move money, a table of the
six outcomes exactly as printed (threw, name, statusCode, errorReason), and one
paragraph on what it means for Task 3: which facilitator (if any) sends an
explicit refusal as a non-2xx. No payer address, no key id, no local path.
Render with `node ~/scripts/render-md-to-html.js <md> <html>`.

- [ ] **Step 5: Commit**

```bash
git add docs/reviews/2026-09-28/40-facilitator-refusal-probe.md docs/reviews/2026-09-28/40-facilitator-refusal-probe.html
git commit -m "docs(review): how x402.org and CDP refuse a settlement, measured"
```

---

### Task 3: An explicit refusal is declined whatever its status

**Files:**
- Modify: `warden/src/pay/x402.mjs:460-464` (the `catch` in `observeSettlement`)
- Test: `warden/test/settlement-commit.test.mjs`

**Interfaces:**
- Consumes: `isDeclined(settlement)` (x402.mjs:154), which reads only `transaction` and `errorReason` -- both present on a `SettleError`.

This change is correct whatever Task 2 found: a `SettleError` IS the
facilitator's own answer. Task 2 says whether the path is live.

- [ ] **Step 1: Give the fake facilitator a status code**

In `fakeFacilitator`, change `send` to take a status, and add four modes before
the `malformed` line:

```js
    const send = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
```

```js
        // EXPLICIT REFUSALS SENT AS ERRORS. @x402/core throws a SettleError
        // for a non-2xx whose body has `success`, carrying the body's reason
        // and hash. The answer is the same answer; only the envelope differs.
        if (settle === "declined-4xx") {
          return send({ success: false, errorReason: "invalid_exact_evm_payload_authorization_valid_before",
            transaction: "", network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "hash-4xx") {
          return send({ success: false, errorReason: "invalid_exact_evm_transfer_event_mismatch",
            transaction: SETTLE_TX, network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "unknown-4xx") {
          return send({ success: false, errorReason: "some_reason_invented_after_this_build",
            transaction: "", network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "gateway-502") {
          res.writeHead(502, { "content-type": "text/html" });
          return res.end("<html>bad gateway</html>");
        }
```

- [ ] **Step 2: Write the failing tests**

Append after the `unknown-reason` test:

```js
test("an explicit refusal sent as a non-2xx is released, like the same refusal sent as a 200", async () => {
  const { db, settled } = await mintPaying({ settle: "declined-4xx" });
  assert.equal(settled, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0, "a plain no frees the key at once");
});

for (const settle of ["hash-4xx", "unknown-4xx", "gateway-502"]) {
  test(`a non-2xx that is not a plain refusal (${settle}) is held`, async () => {
    const { db } = await mintPaying({ settle });
    assert.equal(db.prepare("SELECT status FROM mints").get().status, "payment-unresolved");
  });
}
```

- [ ] **Step 3: Run them to verify the first fails**

Run: `cd warden && node --test test/settlement-commit.test.mjs`
Expected: `declined-4xx` FAILS (1 row held, expected 0); the three held cases PASS already.

- [ ] **Step 4: Classify the thrown answer**

Replace the `catch` body in `observeSettlement`:

```js
      } catch (err) {
        // A non-2xx whose body is a settlement answer reaches here as a
        // SettleError carrying that answer, and is judged exactly as a returned
        // one is. Every other throw -- a timeout, a dropped response, a proxy
        // page -- may follow a mined transfer, and stays unknown.
        const kind = err?.name === "SettleError" && isDeclined(err) ? "declined" : "unresolved";
        if (payNonce) outcomes.set(payNonce, { ...where, kind, detail: err?.errorReason ?? err?.message ?? null });
        throw err;
      }
```

Move the comment block "THE CASE THIS WHOLE FILE TURNS ON" into this one; do
not keep both.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd warden && node --test test/settlement-commit.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 6: Break the fix to prove the test sees it**

Temporarily change `"declined"` to `"unresolved"` in the new line, confirm
`declined-4xx` fails, then restore it from a copy made before the edit (never
`git checkout --`).

- [ ] **Step 7: Correct `.claude/rules/warden.md`**

In the "Failed and unknown" bullet, after "Declined means no transaction hash
AND a pre-broadcast `errorReason`", add: "-- whether it is returned as a 200
or thrown as a `SettleError` for a non-2xx".

- [ ] **Step 8: Run all four suites, then commit**

```bash
git add warden/src/pay/x402.mjs warden/test/settlement-commit.test.mjs .claude/rules/warden.md
git commit -m "fix(warden): an explicit refusal is declined whatever status carries it"
```

---

### Task 4: The Warden answers `payment-unresolved`

**Files:**
- Modify: `warden/src/mcp/nextSteps.mjs` (NEXT table and one new export)
- Modify: `warden/src/pay/x402.mjs:644-666` (the unresolved branch of `paid()`)
- Test: `warden/test/settlement-commit.test.mjs`
- Modify: `skills/machine-readable-only/references/refusals.md`

**Interfaces:**
- Produces: `export function unresolvedRefusal(tool)` in `x402.mjs`, returning an MCP tool result `{ content, structuredContent: { ok: false, reason: "payment-unresolved", next }, isError: true }`. `tool === "upgrade"` gets the Mark wording, anything else the token wording.
- Produces: `export const UNRESOLVED_MARK_NEXT` (string) in `nextSteps.mjs`.
- Consumed by: Task 5 (the client matches `reason === "payment-unresolved"`) and its test double.

- [ ] **Step 1: Write the failing tests**

Append to `settlement-commit.test.mjs`:

```js
test("an agent whose payment outcome is unknown is told so, and told not to pay again", async () => {
  const { result } = await mintPaying({ settle: "malformed" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.reason, "payment-unresolved");
  const next = result.structuredContent.next;
  assert.match(next, /outcome is not known yet/);
  assert.match(next, /HOLDING your reservation/);
  assert.match(next, /Do not pay again/);
  assert.match(next, /your token is minted then/);
  assert.doesNotMatch(JSON.stringify(result), /released its reservation/);
});

test("a Mark whose payment outcome is unknown says Mark, not token", async () => {
  const { result } = await upgradePaying({ settle: "malformed" });
  assert.equal(result.structuredContent.reason, "payment-unresolved");
  assert.match(result.structuredContent.next, /your Mark is applied then/);
  assert.doesNotMatch(result.structuredContent.next, /token is minted/);
});

test("when even the hold fails, the answer is still unresolved, never released", async () => {
  const fac = await fakeFacilitator({ settle: "malformed" });
  try {
    const db = openDb(":memory:");
    const q = queries(db);
    const gateway = makePaymentGateway({
      facilitatorUrl: fac.url, network: NETWORK, payTo: PAY_TO,
      onSettled: (n, tx) => q.settleByNonce(n, tx),
      onUnsettled: (n) => q.releaseReservation(n),
      onUnresolved: () => { throw new Error("disk full"); },
      alert: () => {},
      build: async () => {
        const server = registerExactEvmScheme(
          new x402ResourceServer(new HTTPFacilitatorClient({ url: fac.url })), { networks: [NETWORK] });
        await server.initialize();
        return server;
      },
    });
    const tool = makeMintTool({ q, chain: openChain(), paid: gateway, supplyCap: 100, today: () => 20_700, alert: () => {} });
    const demand = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: undefined } } });
    const meta = await payFor({ result: demand, expected: { payTo: PAY_TO, amount: readDemand(demand).accepts[0].amount },
      walletPrivateKey: generatePrivateKey() });
    const result = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: meta } } });
    assert.equal(result.structuredContent.reason, "payment-unresolved");
  } finally {
    await fac.close();
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd warden && node --test test/settlement-commit.test.mjs`
Expected: the three new tests FAIL (`structuredContent.reason` is undefined:
the agent still gets @x402/mcp's settlement-failed demand).

- [ ] **Step 3: Add the wording**

In `nextSteps.mjs`, beside `"paid-but-unavailable"` in `NEXT`:

```js
  "payment-unresolved":
    "The payment's outcome is not known yet. It may have gone through, so the site is HOLDING your reservation. Do not pay again. At the next 00:05 UTC the site checks the chain. If the payment landed, your token is minted then. If it did not, the reservation is released and no money moved. Check after 00:05 UTC with `status`.",
```

and after the `NEXT` table:

```js
/// The same answer for a Mark order, which `paid()` sets as `next` directly.
export const UNRESOLVED_MARK_NEXT =
  "The payment's outcome is not known yet. It may have gone through, so the site is HOLDING your reservation. Do not pay again. At the next 00:05 UTC the site checks the chain. If the payment landed, your Mark is applied then. If it did not, the reservation is released and no money moved. Check after 00:05 UTC with `status`.";
```

- [ ] **Step 4: Return it from the unresolved branch**

In `x402.mjs`, import `UNRESOLVED_MARK_NEXT` beside `withNext`, add after
`payRefusal`:

```js
/// What an agent is told when nobody knows whether its payment moved.
export function unresolvedRefusal(tool) {
  return payRefusal({
    ok: false,
    reason: "payment-unresolved",
    ...(tool === "upgrade" ? { next: UNRESOLVED_MARK_NEXT } : {}),
  });
}
```

and in `paid()`, replace the final `return result;` of the unresolved branch
so that BOTH the held path and the hold-failed `catch` fall through to
`return unresolvedRefusal(tool);`. The declined branch keeps `return result;`.

- [ ] **Step 5: Document the reason for agents**

In `skills/machine-readable-only/references/refusals.md`, after the
`paid-but-unavailable` row:

```
| `payment-unresolved` | The facilitator's answer about your payment was lost or unclear, so nobody knows yet whether it moved. **Your reservation is held. Do not pay again.** The chain is checked at the next 00:05 UTC: if the payment landed, what you paid for is written then; if not, the reservation is released and nothing moved. |
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warden && node --test test/settlement-commit.test.mjs test/next-steps.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run all four suites, then commit**

`tools/` runs `skill-doc.test.mjs`, which fails if the refusals.md row is missing.

```bash
git add warden/src/pay/x402.mjs warden/src/mcp/nextSteps.mjs warden/test/settlement-commit.test.mjs skills/machine-readable-only/references/refusals.md
git commit -m "fix(warden): an unknown payment outcome is answered as held, not released"
```

---

### Task 5: The client prints the approved message

**Files:**
- Modify: `client/src/messages.mjs`, `client/src/index.mjs:17`, `client/src/cli.mjs:14` and `:227-233`
- Test: `client/test/cli.test.mjs`
- Modify: `docs/2026-09-01-mro-raw-protocol.md` and its byte-identical copy `skills/machine-readable-only/references/raw-protocol.md`

**Interfaces:**
- Consumes: `unresolvedRefusal("mint")` from `warden/src/pay/x402.mjs` (Task 4), in the test double only.
- Produces: `export function unresolvedPaymentMessage(site = DEFAULT_SITE) -> string`.

- [ ] **Step 1: Make the test double switchable**

In `cli.test.mjs`, import `unresolvedRefusal` beside `adaptContext`, add
`let paidAnswer = "failed";` beside `let dir, ...`, and in the `paid` double:

```js
    paid: () => async (_args, ctx) => {
      const paying = adaptContext(ctx?.mcpCtx)._meta?.["x402/payment"];
      if (paying && paidAnswer === "unresolved") return unresolvedRefusal("mint");
      const body = paying ? SETTLEMENT_FAILED : DEMAND;
```

- [ ] **Step 2: Write the failing test**

After the "fails to settle" test:

```js
test("a payment whose outcome is unknown exits non-zero and says do not pay again", async () => {
  paidAnswer = "unresolved";
  try {
    const { code, out } = await withWallet(
      "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
      "--key", join(dir, "payer4.json"), "--to", "0x" + "a2".repeat(20),
      "--expect-payto", TREASURY, "--expect-amount", "1000000"
    );
    assert.equal(code, 2, out);
    assert.match(out, /The payment's outcome is not known yet/);
    assert.match(out, /Do not pay again/);
    assert.match(out, /Check after 00:05 UTC: mro-agent status --site https:\/\/example\.com/);
    assert.doesNotMatch(out, /NOTHING WAS MINTED/);
  } finally {
    paidAnswer = "failed";
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd client && node --test test/cli.test.mjs`
Expected: the new test FAILS (exit 2 from `report()`, but no message).

- [ ] **Step 4: Write the message and print it**

`messages.mjs`, after `paymentFailedMessage`:

```js
/**
 * A PAID call the site answered, but whose payment nobody can yet confirm.
 *
 * The opposite of paymentFailedMessage: the reservation is HELD, not released,
 * so the one harmful response is paying again.
 */
export function unresolvedPaymentMessage(site = DEFAULT_SITE) {
  return [
    "The payment's outcome is not known yet. It may have gone through, so the",
    "site is HOLDING your reservation. Do not pay again.",
    "At the next 00:05 UTC the site checks the chain. If the payment landed,",
    "your token is minted then. If it did not, the reservation is released and",
    "no money moved.",
    `Check after 00:05 UTC: mro-agent status --site ${site}`,
  ].join("\n");
}
```

Add it to the imports in `cli.mjs:14` and the re-exports in `index.mjs:17`.
In `cli.mjs`, directly after the `if (failed) { ... }` block:

```js
      if (structured(result)?.reason === "payment-unresolved") {
        out("mint", structured(result));
        console.log(`\n${unresolvedPaymentMessage(site)}`);
        process.exitCode = 2;
        return;
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && node --test test/cli.test.mjs`
Expected: PASS, including the unchanged "fails to settle" test.

- [ ] **Step 6: Correct the protocol document**

In `docs/2026-09-01-mro-raw-protocol.md`, after the paragraph ending "A token
id you were quoted but did not pay for is never minted.", add:

```
**When nobody knows whether the transfer happened, you get
`payment-unresolved`.** A settlement can end with no clear answer: the
facilitator timed out, its reply was lost, or it answered with a transaction
hash but no success. The transfer may still land, so the reservation is HELD,
not released, and the refusal says so. Do not pay again. The chain is checked
at the next 00:05 UTC: if the payment landed, what you paid for is written
then; if it did not, the reservation is released and no money moved.
```

Then copy the file byte for byte:
`cp docs/2026-09-01-mro-raw-protocol.md skills/machine-readable-only/references/raw-protocol.md`,
and re-render the HTML: `node ~/scripts/render-md-to-html.js docs/2026-09-01-mro-raw-protocol.md docs/2026-09-01-mro-raw-protocol.html`.

- [ ] **Step 7: Run all four suites, then commit**

```bash
git add client/src/messages.mjs client/src/index.mjs client/src/cli.mjs client/test/cli.test.mjs docs/2026-09-01-mro-raw-protocol.md docs/2026-09-01-mro-raw-protocol.html skills/machine-readable-only/references/raw-protocol.md
git commit -m "fix(client): an unknown payment outcome says held and do not pay again"
```

---

### Task 6: Put it live and prove it

- [ ] **Step 1: Rehearse the Warden start** with `warden/tools/rehearse-start.sh` (it boots the real `main.mjs` against a copy of production state).
- [ ] **Step 2: Restart the live Warden** as warden/DEPLOY.md describes it: `pm2 delete mro-warden`, `pm2 start` from `ecosystem.config.cjs`, `pm2 save`. Never `--update-env`.
- [ ] **Step 3: Probe it live** -- `curl -s -o /dev/null -w "%{http_code}" https://machinereadableonly.com/` answers 200, and `pm2 ls` shows `mro-warden` online with 0 restarts after one minute.
- [ ] **Step 4: Update memory** -- ruling 6 and 7 DONE in `operator-decisions-2026-09-30`, with the probe's one-line finding.
- [ ] **Step 5: Ask the operator before pushing.**
