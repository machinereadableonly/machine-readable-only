# MRO review triage -- 2026-09-05

A second opinion on the three reviews of 2026-09-04, written by the model that
has been building this project, against the code as it stands and against the
CURRENT published documentation of every dependency the findings turn on.

- Triaged: `2026-09-04-mro-review-fable-quality.md` (73 findings + 46 test
  gaps), `2026-09-04-mro-review-creative.md` (43 findings),
  `2026-09-04-mro-review-security.md` (67 findings).
- Working tree at triage: clean, `main` at `e39c947`, three commits ahead of
  `origin/main`.
- Suites re-run today: contracts 268, warden 377, tools 66, client 25. All
  green.

## Method, and what makes this different from the verifier passes

Each report already carries an adversarial verifier. Repeating that would buy
nothing. This pass asks the two questions a verifier working inside one report
cannot ask:

1. **Is the claim still true of the STACK, checked against the live
   documentation today** -- not against the installed package, which is what
   the security verifier read, and not against training data.
2. **Does knowing this codebase change the finding's shape** -- is it really
   independent, is it really new, and is the proposed fix the one the
   dependency already supports.

Checked live today: the MCP 2026-07-28 changelog and the Streamable HTTP
transport page; the Web Bot Auth architecture draft; `nodejs.org/api/sqlite`;
viem's `waitForTransactionReceipt`; Coinbase CDP's x402 network-support page;
the npm registry for the four `@x402` packages. Read at source in this
checkout: `@x402/mcp` and `@x402/core` 2.24.0, the two paid tools, the door,
the Clock's reconcile and run loops, `MachineReadableOnly.sol` around the Mark
gate, and the mirror's statements.

**Headline: the three reports hold up.** Nothing in the two Criticals or the
nine Highs collapsed under this pass. Four things changed, and all four change
what to do rather than whether to do it.

---

## 1. Confirmed, and stronger than the report states

### 14.1 Critical -- the paid effect is committed before settlement

Confirmed at source. `paymentTx` exists at `schema.sql:48` and `:72` and has
**zero writers** anywhere in `warden/src` -- the only other occurrence in the
tree is a test fixture's `CREATE TABLE`. `settlePaymentResult`
(`@x402/mcp/dist/esm/index.mjs:1016`) settles after the handler has returned,
and on `!settleResult.success` it discards the handler's result and returns
`createSettlementFailedResult`. The row the handler wrote is untouched. The
Clock's `pendingMints()` then mints it.

**What the reports do not say: the SDK already ships the remedy.** The
installed `@x402/mcp` declares a settlement lifecycle hook --

```
hooks?: {
  onBeforeExecution?: BeforeExecutionHook;   // after verification, before the handler
  onAfterExecution?: AfterExecutionHook;     // after the handler, before settlement
  onAfterSettlement?: AfterSettlementHook;   // after SUCCESSFUL settlement
}
```

`onAfterSettlement` is called only on `settleResult.success`, and its context
carries `settlement`, whose `transaction` is exactly the value `paymentTx` was
schema'd to hold. The package's own doc comment shows the pattern
(`onAfterSettlement: async ({ settlement }) => { await sendReceipt(settlement.transaction) }`).

So the fix has a supported shape rather than needing invention: the handler
reserves in an unsettled state, `onAfterSettlement` promotes it and writes
`paymentTx`, and the Clock only ever mints promoted rows.

**One real obstacle the fix plan must solve, which no report names.**
`SettlementContext` carries `toolName`, `arguments`, `paymentRequirements`,
`paymentPayload` and `settlement` -- it does **not** carry the handler's
return value. So the hook cannot see the `tokenId` the handler chose, and
`mint`'s arguments alone (`to`) do not identify the row. Correlating the two
halves is the design work; the EIP-3009 authorisation nonce in
`paymentPayload` is the natural key, and it is reachable from both sides.

`@x402/core` also exposes `PAYMENT_FLOWS`, where `upfront` and `escrow` both
carry `settleBeforeHandler: true`. If the facilitator supports either, the
whole ordering problem disappears. Worth ten minutes before committing to the
hook route.

**A prerequisite for the fix, not a finding.** Installed `@x402/*` is 2.24.0;
current on npm is **2.25.0**. The fix touches precisely the settle path, so
the upgrade question has to be settled BEFORE the fix is written, not after --
under the usual 3-4 day buffer rule.

### 5.H1 High -- the client speaks the legacy MCP leg

Confirmed against the live 2026-07-28 specification, and the report
understates the strictness. From the Streamable HTTP transport page:

- `MCP-Protocol-Version` **MUST** be on every POST, and its value **MUST**
  match `io.modelcontextprotocol/protocolVersion` in the body's `_meta`.
- `Mcp-Method` (all requests) and `Mcp-Name` (`tools/call`, `resources/read`,
  `prompts/get`) are "**REQUIRED** for compliance".
- A missing required standard header is an explicit validation failure:
  servers **MUST** answer `400 Bad Request` with JSON-RPC `-32020`
  `HeaderMismatch`.
- `server/discover` -- servers **MUST** implement it.

`client/src/door.mjs:96-102` sends `content-type` and `accept` (the `accept`
value is correct) plus the signature headers, and nothing else. No
`Mcp-Method`, no `Mcp-Name`, no `MCP-Protocol-Version`, and `mcp.mjs:31` posts
a bare JSON-RPC envelope with no `_meta` version claim.

The consequence is worse than "three written claims are false on the wire":
**any spec-conforming server or intermediary must reject every request the
reference client sends.** It works today only because our own server accepts
the legacy shape. That makes this an interoperability failure, not a
documentation defect, and it is the one High that gets harder to fix after
agents are relying on the published protocol doc.

### 13.1 High -- one signature replays for five minutes

Confirmed, and the remedy is standardised rather than bespoke. The Web Bot
Auth architecture draft says agents SHOULD extend `@signature-params` with a
`nonce` (base64url, 64 bytes recommended) and that the **client MUST ensure
the nonce is unique for the validity window**; origins may enforce it with a
global store or a local cache.

MRO already issues a `challenge` and already keeps a `seen` set. It simply
does not put the challenge inside the signed component set (`REQUIRED` at
`verify.mjs:45` omits it). So the fix is to sign what is already being sent,
which is the draft's own prescription.

### 1.H1 High -- the run gate reads a streak that never lapses

Confirmed at source. `s.streak` is written in exactly two places
(`MachineReadableOnly.sol:330` and `:406`, both check-in paths) and read at
`:502` for the Mark gate. There is no decay term anywhere. A token that
reached 365 and went silent keeps `streak = 365` forever and can still take
Break; a token that missed one day and came back is at `streak = 1` and is
refused. The contract has no upgrade path, so whichever reading ships is
permanent.

This is the same stored field the creative review's C2.2 attacks from the
colour side. **They are one decision, and the reports are right to say so.**

### 4.H1 High -- `seed` writes a token no code path can mint

Confirmed exactly, and slightly worse than stated. `seed.mjs:59-62` writes
`tokens` and `setLineage` and nothing else. `pendingMints`
(`queries.mjs:46-50`) selects `FROM mints m JOIN tokens t`, so a child with no
`mints` row can never be returned. `stuckMints` (`:51`) also selects from
`mints` -- so the orphan is invisible to the alert path as well as to the
write path. The key's one seed for the agent-year is spent, the agent is told
`ok: true, txStatus: "queued"`, and `/t/<id>` serves the phantom forever.

### Confirmed without amendment

- **3.M1** -- the current Web Bot Auth draft uses a structured-field
  **dictionary** for `Signature-Agent` (`agent2="https://..."`); the string
  form is the legacy shape, and it is the only one the door accepts.
- **4.M4 / 15.4** -- `node:sqlite`'s `timeout` default is `0`, quoted
  verbatim from the live Node documentation. Two processes do write this file.
- **4.M7** -- viem's `waitForTransactionReceipt` default timeout is
  `180_000` ms, confirmed on viem's docs. The await at `write.mjs:159` is
  uncaught while every other call in `send()` is wrapped.
- **16.4** -- the verifier's correction is right and matters: `Ownable2Step`
  IS in use (`MachineReadableOnly.sol:24`), so a wrong owner is recoverable.
  The finding's own closing sentence was backwards. The substantive half --
  no deploy script asserts `block.chainid`, and the only deployer variable is
  one the schema calls a throwaway -- stands.

---

## 2. Corrections that change what to do

### 2.1 12.1 is not an independent High; it is 14.3's symptom

The security review lists **12.1** (a sold token stays under the seller's key)
and **14.3** (the mirror's key binding never converges) as separate findings,
and puts 12.1 tenth on the mainnet blocker list.

The spec at
`docs/specs/2026-08-27-machine-readable-only-design.md:132-133` **designs**
this: "The buyer's agent runs `mro-agent rebind <tokenId>`, which returns the
on-chain call the owner's wallet must sign; once mined, the buyer's ..." A
window between sale and rebind is intended behaviour, and CLAUDE.md already
records the rebind trust boundary as decided.

What is NOT intended is that the window never closes. That is 14.3 alone:
`reconcile.mjs:101-109` only `log()`s a `Rebound`, and `q.setKeyId`
(`queries.mjs:73`, `:248`) has no caller. **Fix 14.3 and 12.1's Warden half
goes with it.** Treat them as one item; do not schedule two.

### 2.2 14.3's remedy is larger than "add a chain read to `upgrade` and `seed`" -- and `checkin` is already broken in the other direction

Both reports frame the remedy as giving `upgrade` and `seed` the live re-check
that `checkin` has. Reading `checkin.mjs:31-44` shows that re-check is
**one-sided**:

```javascript
if (token.keyId !== ctx.keyId) {
  // only here does it ask the chain
  const onChain = await chain.boundKeyOf(tokenId);
  ...
}
```

The chain is consulted **only when the mirror does not recognise the caller**.
So after a sale and a mined rebind:

- the **buyer** presents an unrecognised key, the chain is read, and the buyer
  is correctly admitted to `checkin`;
- the **seller** presents the key the mirror still holds, the branch is not
  taken, no chain read happens, and **the seller can go on checking in on a
  token they no longer own, forever.**

No finding in any of the three reports states this. It is the same root cause
as 14.3, but it means the remedy cannot be "copy checkin's pattern" -- that
pattern is itself incomplete. Closing the seller's side means re-reading on
the recognised-caller path, which is exactly the behaviour
`warden/test/tools.test.mjs:29-31` deliberately pins as intended ("the binding
must not be re-read here"). So this is a design decision with a test to
overturn and a per-call RPC cost to accept, not a patch.

### 2.3 16.3 is a real blocker but a small one, and its framing is wrong

The report says mainnet payment "cannot work as built" because there is no
configuration slot for a CDP API key. True. But it presents this as a gap in
the credential supply, and the security verifier's own late discovery
contradicts that: the live Warden process already carries `CDP_API_KEY_ID` and
`CDP_API_KEY_SECRET`, inherited from the operator's shell at `pm2 start`.

The live CDP documentation gives the rest: Base mainnet (`eip155:8453`) is
supported with the `exact` scheme, the facilitator authenticates with the CDP
key id and secret, and the SDK route is
`createFacilitatorConfig(CDP_API_KEY_ID, CDP_API_KEY_SECRET)` feeding
`createAuthHeaders`, which the installed `@x402/core` already declares as an
optional `FacilitatorConfig` field. Pricing is 1,000 free onchain transactions
a month, then $0.001 each.

So: still a hard blocker, still invisible to testnet, but it is a config slot
and one import rather than a research task. **Re-rate the effort, not the
severity.**

### 2.4 The severity argument between 15.5 and 16.2 is the wrong argument

The verifier lowered 16.2 to Medium to match 15.5, reasoning that one defect
cannot be two severities. That is correct bookkeeping and operationally
irrelevant: whatever it is called, the first mainnet Clock run throws AFTER
writing to chain, every night, until someone edits one line. The same is true
of **14.5** (nothing checks `MRO_CHAIN_ID` against the RPC).

Put both on the mainnet-cutover checklist as one-line prerequisites and stop
discussing their severity.

---

## 3. What all three reports missed

### 3.1 The Warden holds five credentials nobody scoped it for

The security verifier found this while checking 16.14 and recorded it as "new
material" rather than raising it as a finding, so it appears nowhere in the
severity tally or the blocker list. It deserves to be a finding, above several
of the Lows that are in the list.

`/proc/<warden pid>/environ` carries `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`CLOUDFLARE_API_TOKEN_MRO`, `GH_TOKEN` and `GITHUB_TOKEN_MRO`, inherited from
the operator's interactive shell when `pm2 start` was run. `main.mjs:65`
deletes only `CLOCK_PRIVATE_KEY`. An internet-facing Node process that needs
none of these is holding a DNS-zone token and two GitHub tokens.

This widens 16.5 considerably and it is cheap to fix (start PM2 from a clean
environment, or extend the `main.mjs:65` delete list). It should not wait for
a mainnet deploy.

### 3.2 The `onAfterSettlement` hook

Covered in 1 above. Both reviews describe 14.1's mechanism precisely and
neither notices that the package they read ships the lifecycle hook that fixes
it. This is the single most useful thing this triage adds.

### 3.3 The seller can still check in

Covered in 2.2 above.

---

## 4. The creative review

I have not re-derived the creative findings the way I did the technical ones:
they are judgement calls about the piece, and the reports are right that three
of them belong to the operator and not to an engineer. Two observations from the
engineering side:

- **C4.1/C4.2 (the ending), C2.2 (the slip) and C4.3 (closing the ladder) are
  the only three items in all 158 findings that a mainnet deploy makes
  permanent.** Everything else in every report can be fixed after launch. That
  is the whole argument for deciding them first, and it is stronger than the
  "cost of being wrong" ordering the report uses, because it is a hard
  boundary rather than a ranking.
- **C2.2 and quality 1.H1 are one change to one struct field.** Both reports
  say so independently. The engineering consequence is that the contract
  change is small (`fellFrom`/`fellDay` in the existing `uint56 reserved`,
  written on the reset that already happens, no extra SSTORE) and the decision
  is not.

---

## 5. Recommended order

Grouped by what forces the grouping, not by severity.

**Group A -- permanent on deploy. Decide before anything is written.**
`1.H1` with `C2.2` as one decision; `C4.1` with `C4.2`; `C4.3`. These need
the operator, not an engineer, and every other group's work is wasted if the contract
changes afterwards.

**Group B -- the money path.** `14.1` and `14.3`/`12.1` as one design pass
over the paid tools and the mirror's binding. Both are Critical, both live in
the same two files, and both turn on the same question -- what the mirror is
allowed to believe without asking the chain. Settle the `@x402` 2.24.0 ->
2.25.0 question first.

**Group C -- mainnet cutover prerequisites.** `16.3` (CDP auth slot),
`15.5`/`16.2` (`DEPLOY_BLOCK` for 8453), `14.5` (chain id versus RPC),
`16.4` (a `block.chainid` assert and a real deployer key), plus the standing
items already in memory: a real treasury, every QR bitmap re-solved against
the real domain, the testnet section removed from `llms.txt`. These are short
and mechanical; do them as one commit each.

**Group D -- the door.** `13.1` (sign the challenge) and `13.2` (the key
table has no prune or expiry). 13.1 is small and standardised. 13.2 needs a
policy decision about eviction before it needs code.

**Group E -- the Clock's failure seams.** `4.H2`/`16.1` (condemnation by
token rather than by token-and-day) and `15.2` (the uncaught receipt wait).
These are the same seam from two sides and should be fixed together.

**Group F -- the client.** `5.H1`. Contained entirely in `client/src`, and
the published protocol doc has to change with it.

**Then** the four Highs not yet named (`15.1` the key on `cast`'s argv,
`15.3` the false spec sentence, `4.H1` the orphan seed), the credential
cleanup in 3.1 above, and the long tail.

## 6. What I did not do

- I did not re-verify all 158 findings individually. I re-derived the two
  Criticals, the eleven blocker-list entries, the four quality Highs, and
  every finding whose truth depends on a third party's current behaviour.
  The Lows and Infos I read but did not re-measure; the verifier passes on
  those looked sound and several corrected themselves.
- I changed no code. All three reviews were read-only by instruction and this
  triage is too.
