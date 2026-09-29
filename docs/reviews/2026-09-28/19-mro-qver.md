# Machine Readable Only -- quality -- verified

**Snapshot:** 8d2a0d27e3
**Findings in:** 78 -- **after merging:** 71

All five reports were present and none said FAILED. Nothing was executed: every verdict below comes from opening the cited source, the installed libraries under `warden/node_modules/` and `tools/node_modules/`, and whole-tree searches. Gas, byte and timing figures are quoted from source, not measured.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 20 |
| Low | 43 |
| Info | 6 |

**Tagged [BLOCKS MAINNET]:** 9 (2 High, 5 Medium, 1 Low, 1 Info).

| Verdict | Count |
|---|---|
| CONFIRMED | 64 |
| PARTLY CONFIRMED | 7 |
| UNVERIFIED | 0 |
| REFUTED | 0 |

**Where independent reviewers converged (strong signal):**

- **A paid reservation can be released while the money may still move.** Three separate mechanisms, found by two reviewers (q3 and q4) working on different files: the `success: false` classification, the expiry sweep, and the Clock's resolve pass.
- **An unknown settlement is reported to the agent as a plain failure.** Found independently by q3 (server side) and q5 (client and skill side).
- **Version-5 leftovers (172 bytes, 37 modules).** Found by q1 (contract scripts), q2 (the robustness gate) and q4 (Warden rehearsal tools).
- **Stale comments.** All five reviewers; two items were reported twice (`TokenView.sol:25-36`, `warden/src/mcp/server.mjs:127`).

## Critical

None.

## High

### [CONFIRMED] A `success: false` settlement is always released, but the installed facilitator code returns it for transfers already broadcast [BLOCKS MAINNET]
**Where:** `warden/src/pay/x402.mjs:343-345` (classification), `:493-506` (release)
**What:** Every non-success answer is recorded as `declined` and the reservation is deleted. The installed reference facilitator returns `success: false` **with a transaction hash** in two cases: the receipt wait fails after broadcast (reason `settlement_pending`), and a mined transfer fails event validation.
**Why:** The transfer can still be mined after the row is deleted. The agent is debited up to $1250.00, holds nothing, and its nonce stays claimed in `pay_nonces`. This is the loss the project's own "failed and unknown are different outcomes" rule exists to prevent.
**Fix:** Treat as `declined` only when `settlement.transaction` is empty and `errorReason` is on an allowlist of pre-broadcast reasons. Hold everything else through `onUnresolved`. Add a fake-facilitator test answering `settlement_pending` with a hash.
**Verification:**
- `@x402/evm/dist/esm/chunk-KNDFHTKS.mjs:22-27` and `:80-88` return `success: false, errorReason: "settlement_pending", transaction: tx`.
- `exact/facilitator/index.mjs:352-358` returns `success: false` with `transaction: tx` on an event mismatch; `:363-371` returns `transaction: ""` for any throw.
- `@x402/core` itself treats `settlement_pending` with a hash as non-terminal: `chunk-H7ETXA5T.mjs:1677-1693` retries exactly once, then returns the result as it stands.
- Caveat: the Warden talks to a remote facilitator over HTTP. The installed code is the reference implementation, so the remote host's behaviour is inferred, not observed.

### [CONFIRMED] The expiry sweep deletes reservations on silence, and they carry nothing to ask the chain with [BLOCKS MAINNET]
**Where:** `warden/src/mirror/queries.mjs:788-798`, called from `warden/src/mcp/tools/mint.mjs:50` and `upgrade.mjs:230`
**What:** An `awaiting-payment` row older than ten minutes is deleted with no check. If the process stops between the handler returning and the settlement answer arriving, the row stays `awaiting-payment` and the next paid call by anyone sweeps it. `payer` and `asset` are written only by `holdUnresolvedMint` / `holdUnresolvedMarkOrder` (`queries.mjs:169-176`), so the row could not be resolved even if kept. The same happens when `onUnresolved` throws (`x402.mjs:521-526`).
**Why:** A restart during a settlement is ordinary (a deploy, a crash, `max_memory_restart: "512M"` at `ecosystem.config.cjs:93`). `.claude/rules/warden.md` says "never release on silence"; this path does.
**Fix:** Pass `payer` and `asset` to the handler beside `payNonce` and store them at reservation time. Make the sweep move expired rows to `payment-unresolved` instead of deleting, so the Clock's `authorizationState` read decides.
**Verification:** Read the sweep, both hold statements and both call sites. `queries.mjs:708-711` describes the sweep as the backstop for "a crash between the handler and the settle", which is the case where money may have moved. `warden/test/settlement-commit.test.mjs:316` asserts the deletion.
**Note on fix order:** the sweep-order finding below asks for the sweep to run earlier. Make the sweep non-destructive first, or that change widens this one.

## Medium

### [CONFIRMED] A held payment can be released while its authorisation is still spendable [BLOCKS MAINNET]
**Where:** `warden/src/clock/unresolved.mjs:55-91`, `:111-113`; `warden/src/mirror/queries.mjs:192-195`, `:691-697`; `warden/tools/run-clock-now.sh:7-10`
**What:** The resolve pass asks `authorizationState` about every `payment-unresolved` row the moment a run starts, with no minimum age. `reservedAt` is selected and used by nothing; `validBefore` is never stored. A `false` answer deletes the rows and is reported through `log`, not `alert`.
**Why:** `false` means "not spent yet". Inside the validity window the transfer can still land after the row is gone.
**Fix:** Store `validBefore` when the row is held. Release on `false` only once chain time is past it plus a margin. Report a release through `alert`. Add a test for a row younger than its window.
**Severity changed: High to Medium.** The exposure is a settlement going unknown within about five minutes before a Clock run (00:05 UTC, or a manual `run-clock-now.sh`). That is a narrow window per incident. The loss when it happens is the same as the two High findings, so the mainnet tag stays.
**Verification:** `x402.mjs:376-381` passes no timeout. The default is 300 seconds (`@x402/core/dist/esm/chunk-H7ETXA5T.mjs:1062`) and the client sets `validBefore = now + maxTimeoutSeconds` (`@x402/evm/dist/esm/chunk-TTRSMFXP.mjs:34`). The header at `unresolved.mjs:17-21` says the Clock "asks the next morning"; nothing enforces that.

### [CONFIRMED] On an unknown settlement outcome the agent is told the payment failed, and the docs promise an immediate retry [BLOCKS MAINNET]
**Merged from:** q3 and q5 (independent convergence).
**Where:** `warden/src/pay/x402.mjs:508-528`; `warden/public/llms.txt:228-233`; `docs/2026-09-01-mro-raw-protocol.md:797-806`; `client/src/messages.mjs:88-95`, `:107-115`; `skills/machine-readable-only/SKILL.md:124-125`
**What:** The gateway holds the row but returns the library's result unchanged: a payment demand reading "Payment settlement failed". The client prints "NOTHING WAS MINTED, and the site released its reservation. A failed settlement moves no money". The skill says "run it again". The protocol document says "you can call again immediately".
**Why:** All of those can be false in this case. No second charge results, because the retry is refused `already-minted` or `mark-already-applied` before payment. The harm is that the operator is told nothing happened while money may have moved.
**Fix:** In the unresolved branch return `payRefusal({ ok: false, reason: "payment-unresolved" })`. Add the reason to `NEXT`, document the third outcome in `llms.txt`, the protocol document, `refusals.md`, the two client messages and the skill sentence.
**Verification:** `@x402/mcp/dist/esm/index.mjs:1054-1086` funnels both outcomes into `createSettlementFailedResult`. `status` lists unpaid reservations too (`status.mjs:34` reads `tokensForKey`, which has no status filter), so "if a token is listed, the mint succeeded" is unsafe as written.

### [CONFIRMED] The wallet-cap and supply-cap gates ignore mints already paid for but not yet written [BLOCKS MAINNET]
**Where:** `warden/src/mcp/gates.mjs:89-93`, `:106-110`; `warden/src/chain/read.mjs:414-424`, `:443-453`; `warden/src/mcp/tools/mint.mjs:34`, `:81`
**What:** Both gates compare the cap against what the chain has minted, and the chain learns of a mint only at the next Clock run. `seedBudgetBlock` already subtracts unwritten reservations (`gates.mjs:136-140`); these two do not.
**Why:** With `walletCap` 20, the 21st mint to one address in a day is paid for and then reverts `WalletCap`. The mint pass has no branch for that error (`run.mjs:367-392`), so the row retries nightly.
**Fix:** Subtract the mirror's unwritten creations in both gates, before and after payment.
**Severity changed: High to Medium.** The loss is $1 per mint, the rows stay queued with a nightly alert, and both caps are owner dials (`setWalletCap`, `setSupplyCap` up to 65,535) that can be raised inside the 30-day `StaleDay` window. It needs more than 20 distinct keys minting to one address in one day, or the sell-out day.
**Verification:** Read both gates, both chain readers and the mint handler.

### [CONFIRMED] The expired-reservation sweep runs after the check it is meant to protect
**Where:** `warden/src/mcp/tools/mint.mjs:27` against `:50`; `warden/src/mirror/queries.mjs:259`
**What:** `hasMinted` counts every `mints` row for the key, including a dead `awaiting-payment` one, and runs at line 27. The sweep runs at line 50. The comment at `:45-49` says the sweep prevents exactly this lockout.
**Why:** A key with an orphaned reservation is refused `already-minted` until some other key's paid call triggers the sweep. The locked-out key cannot trigger it itself.
**Fix:** Move the sweep above the `hasMinted` check, after the sweep has been made non-destructive (see the second High finding). Add a same-key retry test.
**Tag removed.** No funds are at risk and the fix is a Warden deploy that can ship at any time.
**Verification:** Read the handler top to bottom.

### [CONFIRMED] `closeThePiece` can irreversibly sunset any contract, on any chain, with no guard [BLOCKS MAINNET]
**Where:** `contracts/script/SoakSepolia.s.sol:78-83`
**What:** It sends `sunset()` to whatever address it is given, signed by `deployerKey()`, without calling `guardChain()`. On chain 8453 `deployerKey()` returns the owner key (`MroScript.sol:66-84`).
**Why:** One wrong address or `--rpc-url` closes the real piece permanently.
**Fix:** Call `guardChain()`, require Base Sepolia, and refuse unless the target's `name()` is the spike's.
**Verification:** Searched every `external` function in `contracts/script/*.sol`. Every other broadcasting entry point calls `guardChain()`; this is the only one that does not.

### [CONFIRMED] The robustness gate renders every state with a heart mask cut off at the version-5 size [BLOCKS MAINNET]
**Where:** `tools/robust-solve.mjs:117`; reached in production by `warden/src/solve/worker.mjs:21`; repeated in `tools/test/robust-solve.test.mjs:121`, `:143`
**What:** `unpackModules(heartMaskBytes(), 37)` unpacks 1,369 entries of a 3,249-module mask. `renderSvg` reads `want[p]` up to 3,248 (`tools/render-token.mjs:752-757`), so everything past row 24 is `undefined` and drawn in the noise ink.
**Why:** The gate chooses the mask a token carries for life, and it is judging pictures no token will show. The two inks are close in weight so the verdicts are probably close, but that is unmeasured. Every mainnet bitmap will be solved through this path.
**Fix:** Use `VERSION_SIZE` at `:117` and `SIZE` in the two tests. Make `renderSvg` throw on a length mismatch. Re-run the gate on the ids already measured.
**Verification:** Searched every `unpackModules(` call in `tools/`. All 18 other callers pass `SIZE` or a solve's own size; these three are the only literal `37`.

### [PARTLY CONFIRMED] Rehearsal, soak and measurement tooling still builds 172-byte artwork; the contracts require 407
**Merged from:** q1 (contract scripts) and q4 (Warden tools).
**Where:** `contracts/script/SpikeBitmaps.sol:10-11`; `MintOnePlan1.s.sol:17-18`; `DeploySpike.s.sol`, `SoakSepolia.s.sol:48`, `AbSepolia.s.sol` (via `SpikeBitmaps.code`); `tools/spike-bitmaps.mjs:60-61`, `:73`; `warden/tools/chunk-rehearsal.mjs:73`; `warden/tools/mark-rehearsal.mjs:45`; `warden/test/clock-seed.test.mjs:34-35`
**What is true:**
- `SpikeBitmaps.sol` is version-5 output with 27 bitmaps; `SoakStates.sol:25` declares 52 states. Both token contracts revert `BadCodeLength` on anything but 407 (`MachineReadableOnly.sol:358`, `MROSpikeToken.sol:150`).
- `chunk-rehearsal.mjs` mints with 172 bytes, and `mark-rehearsal.mjs` refuses any bitmap that is not 172 bytes.
- `anvil-verify.sh:34` runs `DeploySpike`, so the documented read-back-and-decode check cannot pass.
**What is not:** `warden/tools/absence-on-chain.mjs:55` does not mint. It calls the Renderer's `svg()` with a 172-byte code, and the Renderer checks no length, so it runs and reads past the buffer. It is wrong, not broken.
**Why:** `CHECKIN_CHUNK = 1,400` says to re-run the rehearsal when `_credit` changes (`run.mjs:34-36`). `_credit` now carries the finish logic, and the tool that measures it cannot run.
**Fix:** Regenerate with `bash tools/spike-bitmaps.sh example.com 52`. Derive lengths from one shared constant. Re-run the chunk rehearsal and update the figure.
**Verification:** Read each file. The runtime failures are inferred from the length checks; nothing was run.

### [CONFIRMED] The settlement receipt never reaches the agent where the protocol document says it does
**Where:** `warden/src/pay/x402.mjs:486`; `warden/src/mcp/server.mjs:178-185`
**What:** On success `@x402/mcp` returns the handler's plain value with `_meta` added (`dist/esm/index.mjs:1070-1076`). That value has no `content`, so `server.mjs` wraps it and the receipt lands in `structuredContent._meta`.
**Why:** `docs/2026-09-01-mro-raw-protocol.md:861` promises it in the response `_meta`. A paying agent gets no transaction hash at the documented location.
**Fix:** In `paid()`, turn a settled success into a complete tool result with `_meta` at the top level. Assert it over the wire.
**Verification:** Traced the value through both files and the library.

### [CONFIRMED] The directory fetch has no overall deadline, so eight slow hosts close the third-party path
**Where:** `warden/src/door/directory.mjs:238`, `:279`, `:404`, `:476-478`
**What:** `timeout` on the request is the only time bound and there is no wall-clock deadline. Fetches are capped at eight in flight and the ninth distinct URL is refused.
**Why:** Eight dripping hosts, named by unauthenticated requests, refuse every agent hosting its own directory. The comment at `:399-403` and the protocol document (`:187`, "3 second timeout") describe a bound the code does not enforce. Agents registered through `POST /keys` are not affected.
**Fix:** Add a wall-clock deadline that destroys the request, and a slow-response test.
**Verification:** Read the fetch. The idle-timeout behaviour of Node's `timeout` option is from my knowledge of Node, not from a local source.

### [CONFIRMED] `"signature-agent";key="sig1"` is documented as accepted, but the installed verifier ignores `key`
**Where:** `docs/2026-09-01-mro-raw-protocol.md:274-282`; `warden/src/door/verify.mjs:283-303`; `warden/node_modules/http-message-sig/dist/index.mjs:120-126`
**What:** `buildSignedData` uses the whole header value for a parameterised component. `coveredComponents` strips parameters, so the component check passes and the signature then fails.
**Why:** A hand-signer following the document with a conforming library is refused `signature`. Hand-signing is currently the only way in.
**Fix:** Build the base line for `;key=` from the member value, or state that only the unparameterised component is accepted. Add a test signed from a hand-built base.
**Verification:** Read the library and the door. Searched `warden/test/` for `;key=`: no test covers a parameterised `signature-agent`. The RFC 9421 `key` semantics are from my knowledge of the standard.

### [CONFIRMED] Registration stores the caller's JWK verbatim and serves it publicly
**Where:** `warden/src/door/directory.mjs:307-311`, `:318-321`, `:574`; `warden/src/mirror/queries.mjs:421-424`; body cap at `warden/src/server.mjs:351`
**What:** Only the proof and the thumbprint are checked. The whole submitted object, up to 64 KB, is stored and rendered into the public directory.
**Why:** The 1,140,018-byte figure at `directory.mjs:329` assumes minimal keys. Padded keys at the 10,000 ceiling make the render hundreds of megabytes against a 512M restart limit.
**Fix:** Require `kty === "OKP"` and `crv === "Ed25519"`, and store only `{ kty, crv, x }`.
**Verification:** Read `registerRoute`, `registerKey`, `insertKey` and `renderDirectory`.

### [CONFIRMED] `x402-live-mint-check.mjs` cannot run
**Where:** `warden/tools/x402-live-mint-check.mjs:102-109`, `:126-161`
**What:** It calls `createServer` without `contract` and `chainId`, which `server.mjs:104-106` rejects by throwing. Its requests also carry no 2026-07-28 envelope, while the handler is `legacy: "reject"` (`mcp/server.mjs:206`).
**Why:** `contracts/script/adopt-deployment.sh:108` names it as the live payment check.
**Fix:** Pass `contract` and `chainId`, and reuse the client's envelope helper.
**Verification:** Read both files.

### [CONFIRMED] The heartbeat is skipped while the contract is paused, and is never told about sunset
**Where:** `warden/src/clock/run.mjs:727-733`, `:753`; `warden/src/clock/heartbeat.mjs:41-53`
**What:**
- The heartbeat block runs only when `!summary.aborted`. With any row queued before a pause, the first write reverts `EnforcedPause` and no heartbeat is sent.
- `heartbeatDue` has a `sunset` parameter that `run.mjs:753` never passes.
- `wroteThisRun` counts `healed` entries, which this run did not write.
**Why:** The contract leaves `heartbeat()` without `whenNotPaused` so a long pause cannot force the ending (`MachineReadableOnly.sol:166-169`). The Clock defeats that. After sunset with an empty queue, the Clock pays for a heartbeat every 30 days.
**Fix:** Send the heartbeat when the abort reason is `EnforcedPause`. Read `isSunset` and pass it in. Drop `healed` from `wroteThisRun`.
**Verification:** Read both files and the contract. `warden/test/clock-heartbeat.test.mjs:33` tests the `sunset` parameter on the pure function only.

### [CONFIRMED] A day that never landed can be recorded as "already on chain"
**Where:** `warden/src/clock/batch.mjs:96-98`, `:233-236`; `warden/src/clock/run.mjs:598-601`
**What:** The heal treats every queued entry with `day <= lastDay` as landed. When a chunk returns `attempts-exhausted`, the run keeps going, so a later chunk (or the second half in `writeInHalves`) can land a later day for the same token.
**Why:** The skipped day is then unwritable, and the next night it is marked written. A day of the artwork is lost while the mirror reports it kept.
**Fix:** Stop sending further chunks after `attempts-exhausted`. In the heal, mark as healed only when the chain's `level` accounts for the entry.
**Verification:** Read both files. The precondition (twelve condemnations in one chunk with a multi-day backlog) is rare.

### [CONFIRMED] Reconcile's `Minted` closes a paid mint without checking it is the same mint
**Where:** `warden/src/clock/reconcile.mjs:209-212`; `warden/src/clock/run.mjs:336-351`; `warden/src/mirror/queries.mjs:321`
**What:** The mint pass checks owner and key before marking a row written on `TokenExists`. `applyEvents` marks the mint written for any `Minted` whose id the mirror holds, ignores `keyId`, and the update has no status guard.
**Why:** When a different token holds a reserved id, the mint pass alerts correctly and reconcile then closes the paid row in the same run.
**Fix:** Compare `event.args.keyId` with `keyIdToBytes32(token.keyId)`. Restrict the update to `status = 'queued'`.
**Verification:** Read all three. The precondition is an id collision, which needs a restored or second mirror.

### [CONFIRMED] Reconcile is all-or-nothing, so a long backlog can never be worked off
**Where:** `warden/src/clock/run.mjs:963-974`; `warden/src/clock/reconcile.mjs:66-91`; `warden/src/clock/cursor.mjs:79-82`; `warden/deploy/mro-clock.service:31`
**What:** `readEvents` reads every page into memory, events are applied after the last page, and the cursor moves only on full completion. One failed page throws away the night's reading. The span is fixed at 1,000.
**Why:** A day is about 44 pages. Each failed night makes the next night's backlog longer, so a flaky provider makes success less likely every night.
**Fix:** Apply events and write the cursor per page. Cap pages per run. Halve the span on a range-limit error.
**Verification:** Read all four.

### [CONFIRMED] Every Clock alert is a line in a log file; nothing notifies anyone
**Where:** `warden/src/clock/run.mjs:217`; `warden/deploy/mro-clock.service:77-78`
**What:** `alert` is `console.error`, appended to `mro-clock.log`. The unit has no `OnFailure=`.
**Fix:** Add `OnFailure=` pointing at a small notifier unit.
**Verification:** Searched the whole tree for `OnFailure`: no match. The only `mro-clock` lines in `warden/DEPLOY.md` are `:382` and `:402`, the stop and start commands.

### [CONFIRMED] A condemned credit fails the run for one night only, and the mirror's level is never corrected
**Where:** `warden/src/clock/run.mjs:622-624`; `warden/src/mirror/queries.mjs:329`, `:961`; `warden/src/mcp/tools/checkin.mjs:193-215`
**What:** `failCredit` changes only the credit row. The Warden advanced `tokens.level`, `streak`, `lastDay` and `bestRun` at check-in time and nothing rolls that back.
**Why:** `status` and `/t/<id>` overstate the token permanently, and from the second night the run exits 0.
**Fix:** Collect `q.stuckCredits()` into the summary every run. Add a nightly comparison against `viewOf`.
**Verification:** Searched the whole tree for `stuckCredits`. `q.stuckCredits()` is defined at `queries.mjs:961` and called nowhere; every other hit is the unrelated `summary.stuckCredits` array.

### [CONFIRMED] The client exits 0 on HTTP refusals other than 401
**Where:** `client/src/mcp.mjs:109-141`, `:163-164`; `client/src/cli.mjs:329-334`
**What:** `rpc` handles only status 401. The Warden answers 429 and 500 with a JSON body that has no `result` (`warden/src/server.mjs:457`, `:474`), so `callTool` returns `undefined`, the CLI prints `checkin: undefined`, and the exit code stays 0.
**Why:** The documented deployment is a cron job that reports failure by exit status. `cli.mjs:268-276` says this defect was fixed.
**Fix:** Throw on any non-2xx status. Treat `undefined` and `isError: true` as failures in `report`.
**Verification:** Traced a 429 body through `readRpc`, `callTool` and `report`. The schema-rejection case is reasoned from the same code; I did not open the SDK file the reviewer cited.

### [CONFIRMED] `refusals.md` gives the wrong remedy for `components`
**Where:** `skills/machine-readable-only/references/refusals.md:20`; `warden/src/door/verify.mjs:128`
**What:** The skill says to sign four components and omits `signature-agent`. The door requires five.
**Fix:** List all five, and add a test against the door's `REQUIRED`.
**Verification:** Read both.

## Low

### [PARTLY CONFIRMED] Resting a lapsed token restores its full colour, and both seals drop the fallen-run colour [BLOCKS MAINNET]
**Where:** `contracts/src/render/Renderer.sol:117`, `:135`, `:145`; `tools/render-token.mjs:289`, `:304`, `:307`; `contracts/src/MachineReadableOnly.sol:805-810`
**What is true:** The code behaves exactly as described. A token at streak 400 that was silent for two years returns to the top colour and a white page when rested. Neither seal branch applies the fallen-run term. `rest()` stores no day.
**What changes the verdict:** Both branches match Plan 6's written rule word for word (`docs/plans/2026-09-05-mro-plan6-permanent-decisions.md:121-125`): "`resting` -- unchanged, `tierIndex(v.streak)`" and sunset as `lapsedIndex(streak, lastDay, sunsetDay)`. This is a recorded decision, not a drift from one.
**Why it still matters:** The main spec says the chain shows which heart was rested on an unbroken run and which merely stopped (`docs/specs/2026-08-27-machine-readable-only-design.md:804-806`). The image does not.
**Severity changed: Medium to Low.** It is a design question, not a defect. The tag stays for one reason: if the operator wants the rest day honoured, it has to be stored on chain, and the token contract cannot change after deploy. See Questions.
**Verification:** Read both renderers, the contract, the spec passage and the plan passage.

### [CONFIRMED] The byte budget is proven on one bitmap, and nothing checks a token's own bitmap when it is solved
**Where:** `contracts/test/WorstCase.sol:27-28`; `contracts/test/RealTokenGas.t.sol:238-259`; `tools/robust-solve.mjs:135-167`
**What:** The pin is exact for the `example.com` token-1 bitmap with 1,842 bytes of headroom. `gateSolve` checks that a code decodes, never how long its tokenURI is.
**Fix:** In `gateSolve`, compute the tokenURI length for the banded finished child and reject a mask over budget. Reword `WorstCase.sol` to say which bitmap it pins.
**Severity changed: Medium to Low.** 24,000 is the project's own limit; the external ceiling is 30,000, which leaves 7,842 bytes. The Renderer is swappable, so an over-budget token is not permanent.
**Verification:** Read all three. `.claude/rules/contracts.md` records a 554-byte difference between two bitmaps.

### [CONFIRMED] Healing a landed chunk takes two RPC calls per token and saves nothing until the chunk returns
**Where:** `warden/src/clock/batch.mjs:80-99`, `:323-339`; `warden/src/clock/run.mjs:573-589`
**What:** Each `DayNotAdvanced` names one token, so recovery is one simulate plus one `viewOf` per token, in sequence. Healed entries are marked only after the chunk returns, in separate commits.
**Fix:** Read `lastDay` for every token in the chunk in one step, persist heals as found, and wrap the marking in one `q.transact`.
**Severity changed: Medium to Low.** Check-ins have no lateness floor on chain (see Questions), so queued days stay writable. The outcome is delay and an operator intervention, not lost days.
**Verification:** Read both files. The timing figures in the report are estimates.

### [PARTLY CONFIRMED] The year checker cannot see a failure that happens before the door accepts something
**Where:** `warden/tools/year/checker.mjs:394-415`; `warden/tools/year/report.mjs:157`
**What is true:** Expected values come from `creditedDays`, which counts only check-ins the runner logged as accepted. The token list comes from the runner's `state.json`. Nothing compares the run against the scenario table.
**What is not:** A checker pass that crashes is counted as a FAIL (`report.mjs:116-117`, `:157`). Only runner-side failures go uncounted.
**Fix:** Build a second expectation from `scenario.mjs` and raise a finding when accepted days differ from scripted days.
**Severity changed: Medium to Low.** This is rehearsal tooling; the Refusals table and the fast-days count still show the symptom.
**Verification:** Read both files in full. I did not open `runner.mjs`.

### [CONFIRMED] Requested Marks, variants and the echo value are never checked per token
**Where:** `warden/tools/year/checker.mjs:50`, `:163-166`; `warden/tools/year/report.mjs:52-58`, `:168`
**What:** The checker compares mirror against chain only, never against what the runner ordered. `MARK_BITS` masks out the variant bits. `compare()` never reads `echo`. The report marks an id "proven live" if any token's passing row carries that bit.
**Fix:** Derive expected Mark bits per token from the runner's log, compare variant bits for ids 5 and 9, and compare `echo` for a child.
**Severity changed: Medium to Low.** Rehearsal tooling.
**Verification:** Read `compare()` and `markStatus()`.

### [CONFIRMED] `demand-only` is reported as a price check, but the live run checks nothing
**Where:** `warden/tools/year/agent.mjs:75`; `warden/tools/year/report.mjs:49-50`
**What:** The report says the price is "read and asserted". The agent returns the demand without comparing amount or `payTo`.
**Fix:** Assert against `markAmount(upgradeId)` and the treasury on that path.
**Severity changed: Medium to Low.** Rehearsal tooling.
**Verification:** Read both.

### [CONFIRMED] Comments, documents and small duplications that contradict the code
**Merged from:** q1, q2, q3, q4 (two findings) and q5. Two items were reported twice by different reviewers.
**Contracts:**
- `MachineReadableOnly.sol:388-389`: "a test pins the two together". No test does; `FINISH_LEVEL` appears in no test file.
- `MachineReadableOnly.sol:668`: "`sold` is owned by `applyMark`". `_finish` also writes it (`:473`).
- `MachineReadableOnly.sol:384-385`: a finished token gets "the same freeze `rest` gives". `applyMark` still works on it.
- `TokenView.sol:10` ("level / 365 is completed years"), `:25-36` (calls itself the authority, omits bits 11-15; **reported by q1 and q2**), `:38` ("minted it"; `rebind` overwrites it).
- `MroScript.sol:54-55` and `SetClockWarden.s.sol:12-13` name `setSunset`; the function is `sunset()`.
- `DeployPlan5.s.sol:10` and `deploy-mainnet.sh:3` say "ten Marks"; the loop writes fifteen.
- `anvil-size-check.sh:61-62` says 344 hex characters; `DeployPlan1.s.sol:13-14` says `WARDEN_ADDRESS` has never been set.
- `MROSpikeToken.sol:110` says sunset is read from `sunsetDay`.

**Contract tests:**
- `GasBudget.t.sol:41-43` ("20,000 stands") and `:102` ("UNTESTED") against the 24,000 limit and "TESTED AND CLOSED".
- `Renderer.t.sol:414` and `TokenUriGolden.t.sol:120` say "3M" beside `4_000_000`.
- `Renderer.t.sol:421-427`: the `_gasIsMeaningful` NatSpec sits on the Years test.
- `.claude/rules/contracts.md`: the paragraphs after the 4,000,000 note still say the byte limit did not move and the two worst cases are different tokens.

**Warden and Clock:**
- `warden/src/mcp/server.mjs:127-130` says `sigHash` hashes the `Signature` header; the door hashes the signature base (`verify.mjs:386`). **Reported by q3 and q5.**
- `warden/src/door/verify.mjs:130-194`: three doc blocks stacked above `timeReason` belong to `coveredComponents`, `signatureAgentUrl` and `signatureLabel`.
- `warden/src/pay/x402.mjs:397-401` says a reservation "has to expire on its own"; the same file releases and holds.
- `warden/src/server.mjs:17-18`, `:82-86` say the token view and MCP handler do not exist yet.
- `warden/src/chain/read.mjs:4-5` says a client library is avoided; `:47` imports viem. `:27-29` names a superseded address.
- `warden/src/clock/reconcile.mjs:49-51` says ids 11-15 are unwritten.
- `warden/src/mirror/db.mjs:48` says nothing is deployed yet.
- `warden/src/clock/write.mjs:109-113` omits `gas-estimate-failed` and `receipt-unknown` from the documented results.
- `warden/src/clock/main.mjs:13-14`: `readFileSync`, `writeFileSync`, `mkdirSync` and `dirname` are imported and unused.
- `warden/src/mirror/queries.mjs:306-308`: `staleCredits` is the same SQL as `pendingCredits`.
- `warden/src/mcp/server.mjs:96` types "1 USDC" literally, against the rule at `mint.mjs:14`.
- `warden/src/mcp/server.mjs:157-162`: the `internal` refusal skips `withNext`, though `NEXT` has an entry for it.
- Test titles that contradict their bodies: `clock-reconcile.test.mjs:260`, `clock-run.test.mjs:786`.

**One item here is more than a comment:** `warden/src/clock/unresolved.mjs:87` falls back to `err.message`, which `redact.mjs` says carries the RPC url. Use `safeErrorText`.

**Client and skill:**
- `client/src/challenge.mjs:33` names a `stale-challenge` reason that does not exist.
- `client/src/mcp.mjs:26` duplicates the version in `package.json`.
- `client/src/cli.mjs:265-277`: `report`'s doc block sits above `readWalletKeyFile`.
- `refusals.md:4-5` says three reasons carry a second field (at least six do) and files `internal` and `paid-but-unavailable` under routing.

**Also true across the tree:** dated history and review numbers in source, which `code-comments.md` forbids; `warden/src/door` is MIT and public.
**Fix:** Correct each in place; trim history when next touching these files.
**Verification:** Opened every item listed above. Not opened: `client/src/door.mjs:45`, `client/src/pay.mjs:48`, `DigitBandCost.t.sol:14` against `GasBudget.t.sol:69`, `tools/heart-mask.mjs:2`.

### [CONFIRMED] No mainnet source-verification step, and the verify scripts report success on failure
**Where:** `contracts/script/verify-plan7.sh:25`, `:36`, `:42`; `contracts/script/deploy-mainnet.sh:143-147`
**What:** `CHAIN=84532` is hard-coded and both `forge verify-contract` calls end in `|| true`. The "Next" list in `deploy-mainnet.sh` has no verification step.
**Fix:** Take the chain as an argument, drop `|| true`, and add the step.
**Verification:** Read both scripts. `warden/DEPLOY.md:687-690` does have a verify step, but it calls `verify-plan7.sh`, which cannot verify on 8453. I did not open `verify-plan6.sh`.

### [CONFIRMED] The owner can rewrite finisher records 11-15
**Where:** `contracts/src/MachineReadableOnly.sol:672-693` against `:446-460`
**What:** `setUpgrade` accepts ids 11-15 with any values. `RunHistory.t.sol:288-291` writes a blank record over Apex.
**Why:** Places are still assigned correctly; `upgradeOf(15)` can be made to state a false cap.
**Fix:** Refuse ids 11-15 in `setUpgrade`, or require the record to match the band.
**Verification:** Read both and the test.

### [CONFIRMED] Finishing place is decided entirely by call order; the voucher path would make it first-come
**Where:** `contracts/src/MachineReadableOnly.sol:468-475`, `:515-535`, `:581-610`
**What:** `_finish` hands out `++finishers` in arrival order. The settled `(day, tokenId)` rule is a property of the Clock only.
**Fix:** State this in NatSpec on `setVouchersEnabled` and `_finish`, and add the two tests.
**Verification:** Read the contract. Nothing is wrong while vouchers are off, which is the settled state.

### [CONFIRMED] `rest` on an already-sealed token emits a second `Rested` with a new day
**Where:** `contracts/src/MachineReadableOnly.sol:805-810`
**What:** There is no already-resting check. `Lifecycle.t.sol:155-157` calls the repeat "a harmless no-op".
**Fix:** `if (s.resting) revert Resting(id);` plus a test.
**Verification:** Read both.

### [CONFIRMED] Test gaps: owner, access-control and finisher paths
**Where and what, each checked by search:**
- **Ownable2Step:** only the happy path on the shipping contract (`MachineReadableOnly.t.sol:166-173`, `Bounds.t.sol:216-221`). The wrong-caller cases exist only in `MROSpikeToken.t.sol`.
- **Bare `vm.expectRevert()`:** `MachineReadableOnly.t.sol:57`, `:70`, `:136`; `Marks.t.sol:113`; `Vouchers.t.sol:129`; `Ladder.t.sol:362`.
- **`seed` day bounds:** every `t.seed(` call in the suite passes `_today()`.
- **Code length:** rejected inputs are 3 and 2 bytes only.
- **After sunset:** no test calls `rest`, `rebind` or a transfer after `sunset()`.
- **Events:** `Seeded` and `Rebound` are asserted nowhere in `contracts/test/`.
**Fix:** Add the tests.
**Verification:** Whole-directory searches for each. Not opened: `FinishLine.t.sol:44-78` and `CheckIn.t.sol:428-429` (the band-boundary claim).

### [CONFIRMED] `bestRun` gates earned Marks but cannot be read from the contract
**Where:** `contracts/src/MachineReadableOnly.sol:195-215`, `:487-490`
**What:** `_tokens` is internal, `viewOf` omits `bestRun`, and `_effectiveRun` is private.
**Fix:** Add `bestRunOf(uint256)` before the redeploy; it cannot be added afterwards.
**Verification:** Read the contract and `TokenView.sol`.

### [CONFIRMED] Deploy script does not require the Warden to differ from the owner
**Where:** `contracts/script/DeployPlan5.s.sol:16-30`
**What:** `SetClockWarden.s.sol:55` enforces the separation; the deploy does not.
**Fix:** `require(warden != vm.addr(key), ...)`.
**Verification:** Read both.

### [CONFIRMED] The anvil gates can pass against a node they did not start
**Where:** `contracts/script/anvil-size-check.sh:20-23`; `contracts/script/anvil-verify.sh:22-25`
**What:** Both start anvil in the background on the default port and `sleep 2`. If the port is taken, the script deploys to whatever is listening.
**Fix:** A dedicated port, a readiness poll, and a liveness check.
**Verification:** Read both. I did not open `chainguard-check.sh`.

### [CONFIRMED] `SwapRenderer` cannot run on a contract with no token 1
**Where:** `contracts/script/SwapRenderer.s.sol:48`
**What:** The post-swap check reads `tokenURI(1)`, which reverts through `_requireOwned`.
**Fix:** Skip the read when `totalMinted() == 0`.
**Verification:** Read both.

### [CONFIRMED] Literal 365 where `FINISH_LEVEL` is meant
**Where:** `contracts/src/MachineReadableOnly.sol:736`, `:847`
**Fix:** Use the constant in both. The `/ 365` at `:830` is the agent-year and should stay.
**Verification:** Read the lines.

### [CONFIRMED] `GasProfile.t.sol` breaks down a different token from the one whose total it quotes
**Where:** `contracts/test/GasProfile.t.sol:17-20`, `:90-108`, `:145`
**What:** The header cites `WorstCase` (the finished, banded child). `_dearest()` builds the day-364 unbanded child.
**Fix:** Profile level 365 with an echo, an ordinal and the sealed Mark set.
**Verification:** Read the file to line 150.

### [CONFIRMED] Gas assertions with no coverage-profile guard
**Where:** `contracts/test/RealTokenGas.t.sol:179`, `:258`, `:314`; `GasBudget.t.sol:681`; `TokenUriGolden.t.sol:124`; `RingCurve.t.sol:84`
**What:** `_gasIsMeaningful()` exists only in `Renderer.t.sol` and `GasBudget.t.sol`. These six assertions are unguarded, and `:258` is an exact-equality pin.
**Fix:** Move the guard into a shared base.
**Verification:** Searched the test directory for the guard and opened each line. The coverage failure itself was not run.

### [CONFIRMED] The luminance rule is asserted in a weighting the decoder does not use
**Where:** `contracts/test/PaletteNoise.t.sol:25-35`; `tools/test/render-token.test.mjs:41-46`
**What:** Both say BT.601 is what ZXing's `RGBLuminanceSource` uses. The installed source computes `(r + 2g + b) / 4`.
**Fix:** Correct both comments and assert the gap under both weightings.
**Verification:** `tools/node_modules/@zxing/library/esm/core/RGBLuminanceSource.js:52-62`. That branch runs only for an `Int32Array`, and `tools/test/helpers/decode.mjs:50-54` passes one, so it is the path the project's oracle takes.

### [CONFIRMED] Tests that no longer test what their names say
**Where and what:**
- `CodeRenderer.t.sol:394-407`: the "full row" sets 37 of 57 modules.
- `QrVersionCost.t.sol:107-112`: the "at 37" control passes `HeartMask.SIZE` and a 172-byte code.
- `RealTokenGas.t.sol:304-315`: named as a spike comparison; never measures the spike.
- `RealTokenGas.t.sol:209-213`: `v` is read before the Marks are applied, so the assertion holds with no Marks.
- `Renderer.t.sol:374-381`: sunset with `sunsetDay` 0, a state the chain cannot produce.
- `Renderer.t.sol:390-419`: "the worst case" with no digit band.
- `tools/test/render-token.test.mjs:173-180`: asserts the old 20,000 limit with a base64 estimate.
**Verification:** Opened each. Not opened: `tools/state-matrix.mjs:221`, `render-token.test.mjs:355-366`.

### [CONFIRMED] The spike never hands `sunsetDay` to the renderer
**Where:** `contracts/src/spike/MROSpikeToken.sol:113-130`
**What:** `viewOf` sets `v.sunset` and leaves `v.sunsetDay` at 0.
**Fix:** Set `v.sunsetDay = sunsetDay`.
**Verification:** Searched the file for `sunsetDay`: it appears at `:66`, `:110`, `:216-217` and nowhere in `viewOf`. I did not check the `setEcho` test claim.

### [PARTLY CONFIRMED] One fixture bitmap pasted into ten test files; superseded probes still in the suite
**Where:** `_bitmap()` / `_code()` in ten files under `contracts/test/`; `DigitBandCost.t.sol`; `EyeCost.t.sol`
**What is true:** The ten copies exist. No code imports either probe.
**What changes the verdict:** Both probes are test contracts that `forge test` runs, not dead files. `DigitBandCost.t.sol:17-21` says it is kept on purpose: "a superseded measurement with its successor named beside it is worth more than a deleted one". They are also named in `GasBudget.t.sol:65`, `:698`, `tools/finisher-combined-sheet.mjs:4` and `tools/test/eye-renderer.test.mjs:15`.
**Fix:** Generate one `TestBitmap.sol` and import it. Deleting the probes is the operator's decision, not a cleanup.
**Verification:** Searched for both function names and both file names across the tree.

### [CONFIRMED] Registering a key again erases its "used" mark
**Where:** `warden/src/mirror/queries.mjs:60-63`
**What:** `INSERT OR REPLACE` replaces the row, so `lastUsedAt` returns to NULL and the key becomes prunable.
**Fix:** `INSERT ... ON CONFLICT(keyId) DO UPDATE` that leaves `lastUsedAt` alone.
**Verification:** Read the statement and `schema.sql:23`. Only the key's own holder can do this, since registration needs a proof.

### [CONFIRMED] The refusal conversion fails open
**Where:** `warden/src/pay/x402.mjs:176`, `:475`
**What:** Only `ok === false` becomes a refusal. A handler returning `{}` is settled with nothing reserved.
**Fix:** Settle only when `result?.ok === true`.
**Verification:** Read both lines. No handler does this today.

### [CONFIRMED] Three IPv4 blocks refuse whole /16s where only a /24 is reserved
**Where:** `warden/src/door/directory.mjs:75`, `:78`, `:79`
**Fix:** Test the third octet.
**Verification:** Read `blockedV4`.

### [CONFIRMED] A stale challenge answers `expired` without the `serverTime` the document promises
**Where:** `warden/src/door/middleware.mjs:164`; `warden/src/door/challenge.mjs:61-63`
**Verification:** `docs/2026-09-01-mro-raw-protocol.md:116` and `refusals.md:21` both promise it.

### [CONFIRMED] A released reservation can stop the solver run
**Where:** `warden/src/mirror/queries.mjs:475`; `warden/src/solve/queue.mjs:80-82`
**What:** `bumpSolveTries` reads `.solveTries` off a row that may have been deleted. The TypeError is thrown inside the catch block, so draining stops until the next tick.
**Fix:** Return early in `failSolve` when no row comes back.
**Verification:** Read both. It needs a failed solve and a deleted row at once.

### [CONFIRMED] Duplicated limiter
**Where:** `warden/src/bootstrap.mjs:57-80`, `:114-139`
**What:** `makeAllowRegistration` re-implements `slidingWindow`, while the comment says both limiters use it.
**Verification:** Read the file.

### [CONFIRMED] A failed `lastDay` read turns a recoverable row into a terminal failure
**Where:** `warden/src/clock/batch.mjs:85-94`; `warden/src/clock/run.mjs:622`
**Fix:** Leave it queued, as `attempts-exhausted` is.
**Verification:** `queries.mjs:953-955` says `failCredit` is not for this case.

### [CONFIRMED] A gas stop returns before reconcile and the stale-row check, and exits 0
**Where:** `warden/src/clock/run.mjs:282-287`; `warden/src/clock/cursor.mjs:113-127`
**Fix:** Skip only the write passes.
**Verification:** Read both. The pause case was already fixed for this reason (`run.mjs:394-400`).

### [CONFIRMED] The reconcile cursor is not atomic, not floored, and not tied to a contract
**Where:** `warden/src/clock/cursor.mjs:39`, `:51-54`; `warden/src/clock/run.mjs:960`
**What:** `writeCursor` writes in place; an empty file reads as a first run; `from` is `cursor + 1` with no clamp; the file holds no address or chain id.
**Fix:** Write-and-rename, store `{chainId, contract, block}`, clamp to the floor.
**Verification:** Searched `contracts/script/adopt-deployment.sh` for "cursor": no match. `warden/tools/mirror-reset-chain.mjs:26` clears four tables and not the cursor.

### [CONFIRMED] A rebind to an unregistered key leaves the mirror's binding stale permanently
**Where:** `warden/src/clock/reconcile.mjs:194-204`
**Verification:** Searched the tree for `setKeyId`: the only caller is `reconcile.mjs:192`.

### [CONFIRMED] An unknown receipt on a mint, seed or Mark does not stop later sends
**Where:** `warden/src/clock/run.mjs:393`, `:933-935`; `warden/src/clock/batch.mjs:279-281`
**What:** `isRunLevel` lists three named errors only. Check-ins abort on `receipt-unknown`; the other three passes keep sending.
**Verification:** Read both. I did not open the viem timeout default the reviewer cited.

### [CONFIRMED] A leftover lock file blocks every later run
**Where:** `warden/src/clock/main.mjs:94-106`
**What:** The lock is an empty file. The signal handler releases it on SIGTERM and SIGINT; SIGKILL and power loss do not.
**Verification:** Read the file.

### [CONFIRMED] Three agent-facing refusals are undocumented, and the guard test cannot see them
**Where:** `tools/test/skill-doc.test.mjs:78`; `warden/src/mcp/tools/checkin.mjs:56`; `warden/src/mcp/gates.mjs:163`; `warden/src/bootstrap.mjs:161`
**What:** `not-yet-mirrored`, `recipient-cannot-receive` and `payment-not-configured` are absent from `refusals.md`. The test's pattern misses a ternary and a bare `return "x"`, and `bootstrap.mjs` is not scanned. `recipient-cannot-receive` is in neither `NEXT` nor `NO_NEXT`.
**Verification:** Read `refusals.md`, `nextSteps.mjs` and the test.

### [CONFIRMED] `status` with a token id answers without `ok` on success
**Where:** `warden/src/mcp/tools/status.mjs:23-24`; `warden/test/tool-convention.test.mjs:40`
**Verification:** `tokenView` returns no `ok` field; the test calls `status` with `{}` only.

### [CONFIRMED] Any command except `whoami` creates a new identity when the key file is missing
**Where:** `client/src/cli.mjs:132`; `client/src/keys.mjs:19`, `:89-92`
**What:** `beat`, `status`, `ladder`, `rebind` and `rest` all call `ensureIdentity`. With `HOME` unset the path becomes `./.mro/`. `loadIdentity` checks no file mode.
**Verification:** Read both. `cli.mjs:16-18` says a key must not be created as a side effect.

### [CONFIRMED] The publish workflow can stage a client that still believes it is unpublished
**Where:** `client/src/messages.mjs:35`; `.github/workflows/publish-client.yml:186`
**Verification:** Searched the workflow for `PUBLISHED`: no match.

### [CONFIRMED] `seed` checks the parent's level in the mirror, which runs a day ahead of the chain
**Where:** `warden/src/mcp/tools/seed.mjs:59`, `:176-179`; `contracts/src/MachineReadableOnly.sol:830`, `:847`
**What:** On the day the 365th check-in is accepted, the mirror says 365 and the chain says 364. The Clock sends seeds before check-ins, so that night's seed reverts `ParentNotWhole` and lands a night later. The note "the next one opens a year after your first mint" is wrong once a seed is spent.
**Verification:** `tokenBlock` checks existence and resting only, not level.

### [CONFIRMED] Report rows say "proven live" on weak evidence
**Where:** `warden/tools/year/report.mjs:72`, `:159-173`, `:202-205`; `warden/tools/year/checker.mjs:217-221`
**What:** A milestone counts when its line exists, whatever `decoded` says. "A check-in refused" counts any `ok === false`. Failed decodes are not in "Checker FAILs". The heartbeat is inferred by exclusion.
**Verification:** Read both.

### [CONFIRMED] Checker robustness: stale log on re-read, and memory lost on restart
**Where:** `warden/tools/year/checker.mjs:309-312`, `:333`, `:491`
**Verification:** Read the pass. Neither can produce a false pass.

### [CONFIRMED] `mro://token/{id}` lacks the strict id check the HTTP route has
**Where:** `warden/src/mcp/resources.mjs:59`; `warden/src/server.mjs:196-203`
**Verification:** Read both.

## Info

### [CONFIRMED] Ladder details
**Where:** `contracts/src/Ladder.sol:65-69`, `:74-80`; `contracts/src/MachineReadableOnly.sol:686-688`
**What:** `_earned` is a pure alias of `_mark`. The finisher records' `excludes`, `requiresWhole` and `active` are never read by the contract. `setUpgrade` does not refuse bit 0 in a mask, so `requiresAny = 1` would make a Mark unappliable until corrected.

### [PARTLY CONFIRMED] The two renderers differ on inputs the chain cannot produce
**Where:** `tools/render-token.mjs:846` against `MarkRenderer.sol:202`; `CodeRenderer.sol:57-97`
**Checked and true:** A Tint variant of 2 or more draws violet in JS and gold in Solidity. `CodeRenderer.paths` checks no lengths and reads past a short code.
**Not opened:** the ordinal and empty-path differences.

### [CONFIRMED] The wrapper cache grows per token
**Where:** `warden/src/pay/x402.mjs:372`; `warden/src/mcp/tools/upgrade.mjs:327-329`

### [CONFIRMED] `schema.sql` follows its own rule in this snapshot
**Where:** `warden/src/mirror/schema.sql:94`, `:137`
**What:** Both indexes name original columns. No defect. I did not open `db.mjs`'s `migrate()`.

### [CONFIRMED] Skill placeholders are guarded by a notice only [BLOCKS MAINNET]
**Where:** `skills/machine-readable-only/SKILL.md:8`; `tools/prepublish-check.mjs:314-320`
**What:** Eleven `PENDING-BEFORE-MAINNET` markers remain. The check prints a notice and does not fail. Known and deliberate; it belongs on the launch checklist.
**Verification:** Counted the eleven at `SKILL.md:8`, `:10`, `:11`, `:70`, `:72`, `:73`, `:85`, `:89`, `:111`, `:113`, `:155`.

### [CONFIRMED] The skill's `viewOf` tuple is correct today and pinned by nothing
**Where:** `skills/machine-readable-only/SKILL.md:86`
**Verification:** The 18 types match `TokenView.sol` field for field. `tools/test/skill-doc.test.mjs` contains no `viewOf`.

## Refuted and unverified

**Refuted:** none. No finding's central claim was contradicted by the source.

**Unverified:** none as a whole finding. The sub-claims I did not open are listed in each Verification line. The ones that carry weight:
- The schema-rejection half of the client exit-code finding (SDK file not opened).
- The band-boundary test gap (`FinishLine.t.sol`, `CheckIn.t.sol:428-429`).
- The cutover steps at `warden/DEPLOY.md:545-572`.
- `warden/tools/year/runner.mjs` and `chain.mjs`.

**On "dead code" claims specifically,** each was checked across the whole tree:
- `q.stuckCredits()`: genuinely uncalled.
- `q.setKeyId`: one caller, as claimed.
- `DigitBandCost.t.sol` and `EyeCost.t.sol`: **not dead**. They are live test contracts, and one is retained by an explicit note.
- `deploy-plan6.sh` and `verify-plan6.sh` (a Question): referenced only by each other, the plan-7 scripts and `docs/plans/2026-09-06-mro-plan7-lineage-echo.md`.

## Corrections made

| Finding | Change | Reason |
|---|---|---|
| Held payment released inside validity window | High to Medium | About a five-minute window per incident; same loss when it happens |
| Wallet-cap and supply-cap gates | High to Medium | $1 per mint, rows stay queued and alerted, both caps are owner dials |
| Sweep runs after `hasMinted` | Tag removed | No funds at risk; Warden-side fix |
| Resting restores colour | Medium to Low, PARTLY | Code matches Plan 6's written rule; it is a design question |
| Byte budget on one bitmap | Medium to Low | 24,000 is self-imposed; 30,000 is the external ceiling; Renderer is swappable |
| Heal takes two calls per token | Medium to Low | No lateness floor on chain, so days are delayed, not lost |
| Year checker, three findings | Medium to Low | Rehearsal tooling |
| Year checker blind spot | PARTLY | Checker pass crashes are counted as FAILs |
| 172-byte tooling | PARTLY | `absence-on-chain.mjs` does not mint; it still runs |
| Superseded probes | PARTLY | Live tests, one deliberately retained |

**Line numbers corrected:**
- `x402.mjs:343` is the condition; the assignment is `:344`.
- `unresolved.mjs` release log is `:113`.
- `tools/render-token.mjs:756` is inside the loop at `:752-757`.
- `tools/prepublish-check.mjs:314` opens the block; the message is `:316`.
- `RealTokenGas.t.sol:213` depends on the read at `:209`.
- `MintOnePlan1.s.sol` stale lines are `:17-18`, not `:16-18`.

**Contradictions resolved from source:**
- `.claude/rules/warden.md` calls the check-in window "one UTC day wide". The contract's window is `lastDay < day <= today()` with no floor (`MachineReadableOnly.sol:528-529`). The rule file is inaccurate; q1's reading is right.
- q3 and q5 propose opposite-looking changes to the sweep. They are compatible only in the order given under the second High finding.

## Questions still open

**Answered by the source:**
- **Would `@x402/core`'s hooks replace the `settlePayment` patch?** They exist (`chunk-H7ETXA5T.mjs:909`, `:920`) and `onSettleFailure` fires for both a `success: false` result and a throw (`:1505-1567`), carrying a `SettleError` with `transaction` and `errorReason` in the first case. They could replace the patch. The comment at `x402.mjs:397-401` is true of `@x402/mcp` only.
- **Is the `already-minted` gate mirror-only?** Yes. `_hasMinted` is internal with no getter. `hasMinted` counts every `mints` row by key, and `insertSeedMint` writes the caller's key, so a key that seeded but never minted is refused a mint the chain would accept.
- **Should a check-in be accepted for a token held as unresolved?** Today it is not: `checkin.mjs:174` admits only `queued`, the chain read finds no token, and the answer is `unknown-token`. Whether to change that is the operator's call.
- **Does `ecosystem.config.cjs` set `kill_timeout`?** No. Whether PM2's default outlasts the five-second shutdown race is not in this tree.

**Needing the operator:**
1. **Rest and sunset colour.** Should a rested token keep the colour of its stored run even after a long lapse, as Plan 6 says? If the rest day should count, it must be stored on chain before the mainnet deploy.
2. **Check-in lateness has no floor.** One Warden transaction can complete any token minted 364 or more days ago and award it a place. Is that intended on the permanent contract?
3. **`DeployPlan1.s.sol`** deploys without writing the ladder and will run on 8453 if told to. Should it refuse mainnet?
4. **`FundClock.s.sol:35`** declares a local `deployerKey` that shadows the function it calls. It should compile with a shadowing warning; nothing was compiled here.
5. **Can the plan-6 script pair be removed?** Nothing outside comments and one plan document references it.
6. **`FutureDay` in the Clock** fails every entry for that day permanently (`batch.mjs:38`, `run.mjs:622`), though it means "not yet". Should those stay queued?
7. **Permit2.** `payNonceOf` reads a Permit2 nonce, but the resolver only accepts a 32-byte nonce. Is Permit2 meant to stay unreachable?
8. **Per-transaction fee cap** for mainnet; gas is checked once per run.
9. **Clock boot checks.** `clock/main.mjs` runs none of the Warden's (`verifyChainId`, `verifyDecoder`).
10. **Empty `getLogs` from a lagging replica:** is twelve confirmations enough?
11. **Accelerated year length:** by the scenario the earliest heartbeat is day 458, against a stated 450 to 456. Did the first run reach it?
12. **Not measured:** has `fragile-sweep.mjs` run at version 10, and has `forge coverage` run since `WorstCase.sol` was pinned?
13. **Smaller items:** the 919px intrinsic size against a whole number of pixels per module; the 300-second public cache on `mro://token/{id}`; `onChainBy` for a mint paid in the last hour; `viem ^2.56.0` with no shrinkwrap; `x402-live-check.mjs` warming `paid_tool`.
