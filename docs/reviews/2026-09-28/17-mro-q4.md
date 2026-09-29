# Machine Readable Only -- quality -- The Clock, the mirror and chain reads

**Snapshot:** 8d2a0d27e3
**Read:** `warden/src/clock/{run,main,reconcile,batch,write,unresolved,heartbeat,cursor,redact,builder-code}.mjs`; `warden/src/mirror/{schema.sql,db.mjs,queries.mjs}`; `warden/src/chain/{read,preflight}.mjs`; `warden/src/pay/x402.mjs`; `warden/src/day.mjs`; `warden/src/mcp/tools/checkin.mjs` (lines 36-225); `warden/deploy/mro-clock.{service,timer}`; `warden/.env.example`; `warden/ecosystem.config.cjs`; `.claude/rules/warden.md`; `contracts/src/MachineReadableOnly.sol` (lines 125-205, 278-305, 395-544); `warden/tools/{run-clock-now.sh,which-contract.sh,gen-abi.mjs,check-deployed-abi.mjs,mirror-snapshot.mjs,mirror-contents.mjs,mirror-reset-chain.mjs,derive-address.mjs,chunk-rehearsal.mjs,chunk-rehearsal.sh,absence-on-chain.mjs,mainnet-fork-clock.mjs}`; parts of `warden/test/{clock-reconcile,clock-run,clock-unresolved,clock-heal,clock-resilience}.test.mjs`; installed `@x402/core`, `@x402/evm` and `viem` sources for three defaults.

## Findings

**Critical:** none found.

### [HIGH] [BLOCKS MAINNET] A held payment can be released while its authorisation is still spendable
**Where:** `warden/src/clock/unresolved.mjs:55-91` and `:111-113`; `warden/src/mirror/queries.mjs:192-195`, `:691-697`; `warden/tools/run-clock-now.sh:7-10`
**What:** The resolve pass asks `authorizationState` about every `payment-unresolved` row the moment a run starts, with no minimum age. `reservedAt` is selected at `queries.mjs:193` and used by nothing, and the authorisation's `validBefore` is never stored. A `false` answer deletes both rows, and it is reported through `log`, not `alert`.
**Why it matters:** `false` means "not spent yet", not "never will be". `x402.mjs:376-381` passes no timeout, so the installed default of 300 seconds applies (`@x402/core/dist/esm/chunk-H7ETXA5T.mjs:1062`, `@x402/evm/dist/esm/chunk-TTRSMFXP.mjs:34`). A settlement that goes unknown shortly before the 00:05 run, or before any manual `run-clock-now.sh` run, is asked inside that window. If the transfer then lands, the agent is debited up to $1,250.00, holds nothing, and the mirror has no row left. This is the loss the header at `unresolved.mjs:17-21` says the design prevents.
**Fix:** Store `validBefore` when the row is held. Release on `false` only once chain time is past `validBefore` plus a confirmation margin; until then count the row as still unresolved. Promote on `true` at any age. Report a release through `alert`. Add a test for a row younger than its window.

### [MEDIUM] Healing a landed chunk takes two RPC calls per token and saves nothing until the chunk returns
**Where:** `warden/src/clock/batch.mjs:80-99`, `:323-339`; `warden/src/clock/run.mjs:573-589`; `warden/deploy/mro-clock.service:31`
**What:** After a lost receipt, each `DayNotAdvanced` revert names one token, so recovery is one simulate plus one `viewOf` per token, in sequence. Healed entries are marked written only after `writeCheckInChunk` returns. The 1,400 `markCreditWritten` calls at `run.mjs:575-578` are also separate commits rather than one transaction.
**Why it matters:** A full chunk of 1,400 needs about 2,800 round trips against a 600-second unit timeout. If the unit is killed, none of the heal progress is saved and the next night starts from zero. Every token in that chunk then stops being credited until a human intervenes.
**Fix:** On the first `DayNotAdvanced`, read `lastDay` for every distinct token in the chunk (batched) and heal in one step. Persist heals as they are found. Wrap the per-chunk marking in one `q.transact`.

### [MEDIUM] The heartbeat is skipped while the contract is paused, and is never told about sunset
**Where:** `warden/src/clock/run.mjs:727-733`, `:753`; `warden/src/clock/heartbeat.mjs:41-53`; `contracts/src/MachineReadableOnly.sol:166-169`
**What:** The heartbeat block runs only when `!summary.aborted`. With any row queued during a pause, the first write reverts `EnforcedPause`, the run aborts, and no heartbeat is sent. `heartbeatDue` has a `sunset` parameter that `run.mjs:753` never passes. `wroteThisRun` counts `healed` entries, which this run did not write.
**Why it matters:** The contract leaves `heartbeat()` without `whenNotPaused` so a long pause cannot force the ending. The Clock defeats that whenever one check-in was queued before the pause. After sunset with an empty queue, the Clock pays for a heartbeat every 30 days forever, which `heartbeat.mjs:50-53` says must not happen.
**Fix:** Send the heartbeat when the abort reason is `EnforcedPause`. Read `isSunset` beside `lastWardenDay` and pass it in. Drop `healed` from `wroteThisRun`. Add tests for all three.

### [MEDIUM] A day that never landed can be recorded as "already on chain"
**Where:** `warden/src/clock/batch.mjs:96-98`, `:233-236`; `warden/src/clock/run.mjs:598-601`
**What:** The heal treats every queued entry with `day <= lastDay` as landed. That proves only that the day can no longer be written. When a chunk returns `attempts-exhausted`, `run.mjs` keeps going, so with a multi-day backlog a later chunk can land a later day for the same token.
**Why it matters:** The skipped earlier day is then permanently unwritable. The next night it is marked written, with an alert saying the mirror was behind, and the run exits 0. A day of the artwork is lost while the mirror reports it kept. `batch.mjs:72-75` names this as the outcome to avoid.
**Fix:** Stop sending further chunks after an `attempts-exhausted` result. In the heal, mark as healed only when the chain's `level` accounts for the entry; otherwise fail it with its own reason.

### [MEDIUM] Reconcile's `Minted` closes a paid mint without checking it is the same mint
**Where:** `warden/src/clock/reconcile.mjs:209-212`; `warden/src/clock/run.mjs:325-351`; `warden/src/mirror/queries.mjs:321`
**What:** The mint pass checks owner and key before marking a row written on `TokenExists`, and leaves a row held by a different token for a human. `applyEvents` marks the mint written for any `Minted` whose id the mirror holds. It ignores the event's `keyId`, and the update has no status guard.
**Why it matters:** If another token takes a reserved id, the mint pass alerts correctly and then reconcile closes the paid row as written. The alerts stop and the agent has paid for a token that does not exist.
**Fix:** Compare `event.args.keyId` with `keyIdToBytes32(token.keyId)`. On mismatch count it as skipped and alert. Restrict the update to `status = 'queued'`.

### [MEDIUM] Reconcile is all-or-nothing, so a long backlog can never be worked off
**Where:** `warden/src/clock/run.mjs:963-974`; `warden/src/clock/reconcile.mjs:66-91`; `warden/src/clock/cursor.mjs:79-82`; `warden/deploy/mro-clock.service:31`
**What:** `readEvents` reads every page into memory, events are applied only after the last page, and the cursor moves only on full completion. One failed page discards the night's reading. The span is fixed at 1,000 with no fallback if the provider lowers its cap again.
**Why it matters:** A day is about 44 pages. After months of downtime the backlog is thousands of sequential calls, which does not fit in 600 seconds, and every night restarts from the same cursor. `Rested`, `Transfer` and `Rebound` then never reach the mirror again.
**Fix:** Apply events and write the cursor per page or per small batch. Cap pages per run. Halve the span and retry on a range-limit error.

### [MEDIUM] Every Clock alert is a line in a log file; nothing notifies anyone
**Where:** `warden/src/clock/run.mjs:217`; `warden/deploy/mro-clock.service:77-78`
**What:** `alert` is `console.error`, appended to `mro-clock.log`. The unit has no `OnFailure=`, and a search of the repository for `OnFailure` found none. The only `mro-clock` lines in `DEPLOY.md` are the stop and start commands.
**Why it matters:** "Needs a human", unresolved payments and a refused heartbeat all depend on somebody opening a log. The 30-day heartbeat margin assumes a broken Clock gets noticed.
**Fix:** Add `OnFailure=` to the unit, pointing at a small notifier unit that sends the last log lines through the operator's existing alert channel.

### [MEDIUM] A condemned credit fails the run for one night only, and the mirror's level is never corrected
**Where:** `warden/src/clock/run.mjs:622-624`; `warden/src/mirror/queries.mjs:329`, `:961`; `warden/src/clock/cursor.mjs:118`; `warden/src/mcp/tools/checkin.mjs:193-215`
**What:** `failCredit` changes only the credit row. The Warden already advanced `tokens.level`, `streak`, `lastDay` and `bestRun` at check-in time, and nothing rolls that back or compares it with `viewOf`. `q.stuckCredits()` has no caller in `warden/` outside `queries.mjs`, so from the second night the failed credit is not reported and the run exits 0. Failed mark orders, by contrast, are re-read every run (`run.mjs:648`).
**Why it matters:** `status` and `/t/<id>` overstate the token permanently, and the only signal is a single night's log.
**Fix:** Collect `q.stuckCredits()` into the summary every run. Add a nightly comparison of `level` and `lastDay` against `viewOf` for tokens touched that day, alerting on disagreement.

### [MEDIUM] Three ops tools still build 172-byte artwork; the contract requires 407
**Where:** `warden/tools/chunk-rehearsal.mjs:73`; `warden/tools/mark-rehearsal.mjs:45`; `warden/tools/absence-on-chain.mjs:55`; `contracts/src/MachineReadableOnly.sol:105`; `warden/src/clock/run.mjs:24-37`
**What:** `chunk-rehearsal.sh` deploys the current contract, then the script mints with a 172-byte code. `CODE_BYTES` is 407, so the first mint should revert `BadCodeLength`. I did not run it.
**Why it matters:** `CHECKIN_CHUNK = 1,400` cites a 2026-09-11 measurement and says to re-run when `_credit` changes. `_credit` now carries the finish logic, and the tool that measures it cannot run. A chunk that is too large is halved, so the result would be extra transactions, not lost days.
**Fix:** Derive the code length from one shared constant, re-run the rehearsal, and update the figure. Correct `warden/test/clock-seed.test.mjs:34`, which still says 172 is `CODE_BYTES`.

### [LOW] A failed `lastDay` read turns a recoverable row into a terminal failure
**Where:** `warden/src/clock/batch.mjs:85-94`; `warden/src/clock/run.mjs:622`; `warden/src/mirror/queries.mjs:953-955`
**What:** When `viewOf` cannot be read, the named entry is dropped as `DayNotAdvanced` and `run.mjs` sends it to `failCredit`. `queries.mjs:953-955` says `failCredit` is not for a day the chain already holds, which is what that error usually means.
**Why it matters:** One RPC blip marks a landed day as failed, with no way back.
**Fix:** Leave it queued, as `attempts-exhausted` is, and retry the read next run.

### [LOW] A gas stop returns before reconcile and the stale-row check, and exits 0
**Where:** `warden/src/clock/run.mjs:282-287`; `warden/src/clock/cursor.mjs:113-127`
**What:** The gas guard returns early, skipping reconcile, stale rows and the heartbeat decision.
**Why it matters:** During a long stretch of high gas the mirror stops learning about `Rested`, `Transfer` and `Rebound`, with no failure signal. The pause case was already fixed for this reason (`run.mjs:394-400`).
**Fix:** Skip only the write passes, then fall through to the stale check and reconcile.

### [LOW] The reconcile cursor is not atomic, not floored, and not tied to a contract
**Where:** `warden/src/clock/cursor.mjs:39`, `:51-54`; `warden/src/clock/run.mjs:960`; `warden/tools/mirror-reset-chain.mjs:26`; `contracts/script/adopt-deployment.sh:255-261`
**What:** `writeCursor` writes in place, and an empty file reads as a first run. `from` is `cursor + 1` with no clamp to `DEPLOY_BLOCK`. The file holds no address or chain id, and the redeploy steps never reset it.
**Why it matters:** A stale cursor survives a redeploy or chain change unnoticed. An emptied file on mainnet means a re-read from the deploy block, which is the stall `cursor.mjs:31-36` describes.
**Fix:** Write to a temp file and rename. Store `{chainId, contract, block}` and refuse a mismatch. Use `max(floor, cursor + 1)`. Treat an empty file as corruption.

### [LOW] A rebind to an unregistered key leaves the mirror's binding stale permanently
**Where:** `warden/src/clock/reconcile.mjs:194-204`
**What:** The log says the binding is stale "until that key registers". `setKeyId` is called only at `reconcile.mjs:192`, so nothing re-applies the binding when the key later registers.
**Why it matters:** `status` lists tokens by the mirror's key (`warden/src/mcp/tools/status.mjs:34`), so the new holder never sees the token there. Each check-in also costs an extra chain read (`checkin.mjs:75-88`).
**Fix:** On key registration, or nightly for mismatched tokens, read `boundKeyOf` and update. Correct the log text.

### [LOW] An unknown receipt on a mint, seed or Mark does not stop later sends
**Where:** `warden/src/clock/run.mjs:393`, `:933-935`; `warden/src/clock/batch.mjs:279-281`
**What:** Check-ins abort the run on `receipt-unknown`. The other three passes treat it as an ordinary failure and keep sending on the next nonce.
**Why it matters:** If the first transaction is stuck, each later one waits out viem's 180-second receipt timeout (`viem/_esm/actions/public/waitForTransactionReceipt.js:53`) and the run hits the unit timeout.
**Fix:** Add `receipt-unknown` and `reverted-on-chain` to the conditions that stop the write passes.

### [LOW] A leftover lock file blocks every later run
**Where:** `warden/src/clock/main.mjs:94-106`
**What:** The lock is an empty file with no process id or timestamp. After a SIGKILL or power loss it stays, and each night refuses to start.
**Why it matters:** One bad night becomes every night until a human deletes the file, and the only signal is the log.
**Fix:** Write the process id and start time into the file, and take over a lock whose process is gone.

### [LOW] Dead code, duplication, and comments that contradict the code
**Where and what:**
- `warden/src/clock/main.mjs:13-14`: `readFileSync`, `writeFileSync`, `mkdirSync` and `dirname` are unused since the cursor moved out.
- `warden/src/clock/main.mjs:23`: `utcDay` is imported from the Warden's check-in tool; it lives in `src/day.mjs`.
- `warden/src/mirror/queries.mjs:306-308`: `staleCredits` is the same SQL as `pendingCredits` at `:296-298`.
- `warden/src/chain/preflight.mjs:22-43`, `warden/src/chain/read.mjs:153-182`, `:184-224`: three hand-written JSON-RPC fetchers.
- `warden/src/chain/read.mjs:4-5` says a client library is avoided; `:47` imports viem. `:27-29` names a superseded contract address.
- `warden/src/clock/reconcile.mjs:49-51` says ids 11-15 are unwritten; `:54-58` and the contract say otherwise.
- `warden/src/mirror/db.mjs:48-49` says nothing is deployed yet.
- `warden/src/clock/write.mjs:109-113`: the documented results omit `gas-estimate-failed` and `receipt-unknown`.
- Detached doc blocks: `warden/src/clock/run.mjs:48-61`, `warden/src/chain/read.mjs:128-135`, `warden/src/mirror/queries.mjs:701-714`.
- `warden/src/clock/unresolved.mjs:87` falls back to `err.message`, which `redact.mjs` says carries the RPC url. `safeErrorText` is the project's own fix.
- `warden/test/clock-reconcile.test.mjs:260`: the title says Rebound is never written, but `reconcile.mjs:190-193` writes it for a registered key.
- `warden/test/clock-run.test.mjs:786`: the title says the cursor is not dragged back, but the assertion at `:808-811` accepts a lower `to`, which `main.mjs:168-169` then writes.

### [INFO] `schema.sql` follows its own rule in this snapshot
**Where:** `warden/src/mirror/schema.sql:94`, `:137`; `warden/src/mirror/db.mjs:154-155`, `:169`, `:186`
**What:** The only two indexes in `schema.sql` name original columns. Every index on a migrated column is created in `migrate()`. No defect found.

### [INFO] Comment volume conflicts with the project's comment rule
**Where:** for example `warden/src/clock/run.mjs:10-11`, `:794-914`
**What:** The files carry dated history, review finding numbers and past-bug stories. The repository is public and the standing rule is no history in source. Several Low items above are stale comments of this kind.

## Questions

1. `warden/src/clock/main.mjs` runs none of the Warden's boot checks (`verifyChainId`, `verifyDecoder`). Is viem's chain assertion on send the intended guard, given that `today()` and reconcile are read before any send?
2. `warden/src/clock/run.mjs:42`: can a lagging replica return an empty `getLogs` for blocks it has not imported? If so, 12 blocks does not stop the cursor passing unseen events. Would checking that the node holds block `to` before trusting an empty page be acceptable?
3. `warden/src/pay/x402.mjs:56-59` accepts a Permit2 nonce, but `unresolved.mjs` can only ask the EIP-3009 question. Can a Permit2 payment reach `payment-unresolved` with the current scheme registration?
4. `warden/src/clock/write.mjs:96-99` checks gas price once per run and sends set no fee cap. Is a per-transaction cap wanted for mainnet?
5. `warden/src/clock/batch.mjs:38`: `FutureDay` fails every entry for that day permanently, though it means "not yet". Should it leave them queued?

## Out of scope

- `warden/src/mcp/tools/upgrade.mjs:34-35` and `warden/src/mcp/tools/seed.mjs:59` compare the mirror's `token.level`, which can run ahead of the chain; I did not read far enough to see whether a chain read follows.

## Coverage

Read in full: all of `warden/src/clock/` except the generated `abi.mjs`, all of `warden/src/mirror/` and `warden/src/chain/`, `pay/x402.mjs`, `day.mjs`, the Clock's service and timer units, and the tools listed at the top.

Partly read: the contract (heartbeat, absence, creation-day and check-in sections only) and `checkin.mjs`. For the tests I read every test title in the clock, mirror, chain-read, preflight, redact, abi, settlement and seed-mirror suites, and the bodies of sections in five files.

Grep only: `adopt-deployment.sh`, `DEPLOY.md`, `mark-rehearsal.mjs`.

Not read: `mainnet-fork-rehearsal.sh`, `warden/tools/year/`, `rehearse-*.sh`, the remaining test bodies, and the images, which do not bear on this subsystem.

Nothing was executed. Every finding comes from reading, including the claim that the chunk rehearsal fails against `CODE_BYTES = 407`. The timing figures in the heal and reconcile findings are estimates from call counts, not measurements.
