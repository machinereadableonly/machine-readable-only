# Machine Readable Only -- quality -- MCP tool surface, reference client, skill, accelerated year

**Snapshot:** 8d2a0d27e3
**Read:** `warden/src/mcp/**` (all 16 files), `warden/src/pay/x402.mjs`, `client/src/**` (all 9), `client/README.md`, `client/package.json`, `.github/workflows/publish-client.yml`, `skills/machine-readable-only/SKILL.md`, `skills/.../references/refusals.md`, `warden/tools/year/` (`checker`, `runner`, `report`, `chain`, `agent`, `decide`, `tally`, `scenario`, `wallets`, `year.config.cjs`, `start.sh`, `stop.sh`, `setup.sh`, `clock-loop.sh`), `.claude/rules/warden.md`. For verification only: `warden/src/chain/read.mjs`, `warden/src/clock/run.mjs`, `warden/src/clock/heartbeat.mjs`, `warden/src/server.mjs`, parts of `warden/src/mirror/queries.mjs`, parts of `contracts/src/MachineReadableOnly.sol`, and the installed `@x402/mcp`, `@modelcontextprotocol/server`, `viem` and `@noble/curves` sources.

Nothing was executed. Every finding is from reading the code and tracing it by hand.

## Findings

### [HIGH] The wallet-cap and supply-cap gates ignore mints already paid for but not yet written [BLOCKS MAINNET]
**Where:** `warden/src/mcp/gates.mjs:89`, `warden/src/mcp/gates.mjs:106`, `warden/src/chain/read.mjs:414`, `warden/src/chain/read.mjs:443`, `warden/src/mcp/tools/mint.mjs:34`, `warden/src/mcp/tools/mint.mjs:81`
**What:** Both gates compare the cap against what the chain has minted, and the chain learns of a mint only at the next 00:05 run. Mints paid during the day are not subtracted, so every mint to one address passes the gate until the Clock runs. The seed budget already handles this same problem by subtracting `q.unwrittenSeeds` (`gates.mjs:136`); the two caps do not.
**Why it matters:** `walletCap` is 20 and one key mints one token, so an operator with 25 agents minting to one wallet in a day pays 25 times and 5 mints revert `WalletCap`. The Clock has no branch for that error (`warden/src/clock/run.mjs:367`), so the paid rows retry nightly until they go stale and need a manual refund. The same happens to every surplus mint on the day the collection sells out.
**Fix:** Subtract the mirror's unwritten creations in both gates, as `seedBudgetBlock` does: mints and seeds with `status != 'written'` for that `toAddress` (wallet cap) and in total (supply cap). Apply it to the pre-payment check and the post-payment re-check.

### [MEDIUM] The expired-reservation sweep runs after the check it is meant to protect [BLOCKS MAINNET]
**Where:** `warden/src/mcp/tools/mint.mjs:27`, `warden/src/mcp/tools/mint.mjs:50`, `warden/src/mirror/queries.mjs:259`
**What:** `hasMinted` counts every `mints` row for the key, including a dead `awaiting-payment` one, and it runs at line 27. The sweep that removes dead rows runs at line 50, so a key with a dead reservation is refused `already-minted` before the sweep is reached. The comment at `mint.mjs:45` says the sweep prevents exactly this.
**Why it matters:** A key whose reservation was orphaned (process died between reserving and settling) stays locked out until some other key's mint or a paid upgrade triggers the sweep. On a quiet site that could be a long time.
**Fix:** Move `q.dropExpiredReservations()` above the `q.hasMinted` check, and add a test where the same key retries after the expiry time.

### [MEDIUM] A settlement with an unknown outcome looks like a plain payment failure to the agent [BLOCKS MAINNET]
**Where:** `warden/src/pay/x402.mjs:508`, `warden/node_modules/@x402/mcp/dist/esm/index.mjs:1077`, `client/src/messages.mjs:88`, `client/src/messages.mjs:107`, `skills/machine-readable-only/SKILL.md:124`
**What:** When settlement throws or times out, the Warden correctly holds the reservation, but returns the library's result unchanged: a fresh payment demand reading "Payment settlement failed". The client then prints "NOTHING WAS MINTED, and the site released its reservation. A failed settlement moves no money", and the skill says "run it again". In this case all three statements can be false.
**Why it matters:** A second payment from the same key is blocked (`already-minted`, `mark-already-applied`), so this is wrong information rather than a double charge. But the operator is told nothing happened while money may have moved and a token may appear the next night. The related "if a token is listed, the mint succeeded" advice is also unsafe, because `status` lists unpaid reservations (`warden/src/mcp/tools/status.mjs:34`, `queries.mjs:58`).
**Fix:** In the unresolved branch, replace the result with the Warden's own refusal, for example `{ ok: false, reason: "payment-unresolved" }` with a `next` saying not to pay again and that `status` will show the outcome after the next run. Add a payment-state field to `tokenView` and correct the two client messages and the skill sentence.

### [MEDIUM] The client exits 0 on HTTP refusals other than 401
**Where:** `client/src/mcp.mjs:141`, `client/src/mcp.mjs:163`, `client/src/cli.mjs:329`
**What:** `rpc` handles only status 401 specially. The Warden answers 429, 403 and 500 with a JSON body that has no `result` (`warden/src/server.mjs:457`, `:474`), so `callTool` returns `undefined`, the CLI prints `checkin: undefined`, and the exit code stays 0. A schema rejection has the same effect: the SDK returns plain text with `isError: true` and no `structuredContent` (`mcp-D7GmuPnv.cjs:1408`), and `report` checks only `ok === false`.
**Why it matters:** The documented deployment is a cron job that reports failure by exit status. A rate-limited or failing `beat` looks healthy while the streak breaks, which is the defect `cli.mjs:268` says was fixed. No client test covers a non-401 error status.
**Fix:** In `rpc`, throw on any non-2xx status using the body's `reason`. In `report`, treat `result === undefined` and `result.isError === true` as failures. Add tests for 429, 500 and a schema rejection.

### [MEDIUM] The checker cannot see a failure that happens before the door accepts something
**Where:** `warden/tools/year/checker.mjs:394`, `warden/tools/year/runner.mjs:216`, `warden/tools/year/report.mjs:157`
**What:** The checker's chain reads are independent, but its expected values come from `creditedDays`, which counts only check-ins the runner logged as accepted. Its token list comes from the runner's `state.json`. Nothing compares the run against the scenario table.
**Why it matters:** If the Warden wrongly refuses check-ins, or the run pauses on day 5, or passes crash, expected and actual fall together and the report reads "Checker FAILs: 0". The only trace is the Refusals table and low heart counts.
**Fix:** Build a second expectation from `scenario.mjs` and `state.startDay`, and raise a separate finding when accepted days differ from scripted days. Add `run-paused`, `pass-failed` and `missed-deadline` counts to the report's summary row.

### [MEDIUM] Requested Marks, variants and the echo value are never checked per token
**Where:** `warden/tools/year/checker.mjs:50`, `warden/tools/year/checker.mjs:163`, `warden/tools/year/report.mjs:52`, `warden/tools/year/report.mjs:168`, `warden/tools/year/chain.mjs:39`
**What:** For Marks 1-10 the checker compares mirror against chain only, never against what the runner ordered. The report marks an id "proven live" if any token's passing row carries that bit. `MARK_BITS` masks out the variant bits, and `echo` is decoded but never compared.
**Why it matters:** A Mark ordered for A2 that never lands is hidden if A1's landed. A5's Iris variant 2 and the child's echo of 365 could be wrong on chain with no FAIL. `report.mjs:44` names an unwritten ordered Mark as the failure this run exists to catch.
**Fix:** In `compare`, derive expected Mark bits per token from the runner's `applied-queued` lines with one Clock run of allowance, compare the variant bits for ids 5 and 9, and compare `echo` for a child.

### [MEDIUM] `demand-only` is reported as a price check, but the live run checks nothing
**Where:** `warden/tools/year/agent.mjs:75`, `warden/tools/year/runner.mjs:581`, `warden/tools/year/report.mjs:49`
**What:** The report says `demand-only` is "the price read and asserted with nothing paid". On that path the agent returns the demand without comparing amount or `payTo`, and the runner logs `ok: true`. The only assertion is in a unit test against a stub (`warden/test/year-agent.test.mjs:113`).
**Why it matters:** The Marks left `demand-only` are the dearest ones. A Vessel quoted at $1.00 would pass the year unnoticed.
**Fix:** On the `demand-only` path, run `chooseAccepted` and `assertExpected` against `markAmount(upgradeId)` and the treasury, and log a refusal on mismatch.

### [MEDIUM] `refusals.md` gives the wrong remedy for `components`
**Where:** `skills/machine-readable-only/references/refusals.md:20`, `warden/src/door/verify.mjs:128`, `client/src/signing.mjs:26`
**What:** The skill says to sign four components and omits `signature-agent`. The door requires five, and the raw-protocol document in the same bundle lists five.
**Why it matters:** Hand-signing is currently the only way in. An agent refused `components` that follows this remedy stays refused.
**Fix:** List all five in `refusals.md`, and add a test that checks the list against the door's `REQUIRED`.

### [LOW] Three agent-facing refusals are undocumented, and the guard test cannot see them
**Where:** `tools/test/skill-doc.test.mjs:78`, `warden/src/mcp/tools/checkin.mjs:56`, `warden/src/mcp/gates.mjs:163`, `warden/src/bootstrap.mjs:161`
**What:** `not-yet-mirrored`, `recipient-cannot-receive` and `payment-not-configured` are absent from `refusals.md`. The test's pattern matches only `reason: "x"` written literally, so reasons from a ternary or a bare `return "x"` are invisible, and `bootstrap.mjs` is not scanned. `recipient-cannot-receive` is also in neither `NEXT` nor `NO_NEXT`.
**Why it matters:** The test passes while the surface it guards has gaps.
**Fix:** Document the three, and have the test collect every string literal from `gates.mjs`, the tool files and `bootstrap.mjs`.

### [LOW] `status` with a token id answers without `ok` on success
**Where:** `warden/src/mcp/tools/status.mjs:23`, `warden/src/mcp/tokenView.mjs:38`, `warden/test/tool-convention.test.mjs:40`
**What:** The view carries no `ok` field. The convention test calls `status` with `{}` only, so this path is unchecked.
**Why it matters:** A client branching on `result.ok` reads a successful lookup as a failure.
**Fix:** Return `{ ok: true, ...view }` from the tool only, leaving `/t/<id>` unchanged, and add the case to the test.

### [LOW] Any command except `whoami` creates a new identity when the key file is missing
**Where:** `client/src/cli.mjs:132`, `client/src/keys.mjs:19`, `client/src/keys.mjs:89`
**What:** `beat`, `status`, `ladder`, `rebind` and `rest` all call `ensureIdentity`, so a mistyped `--key` or a different `HOME` silently makes a fresh key. With `HOME` unset the default path becomes `./.mro/` in the current directory. `loadIdentity` also accepts a world-readable file, unlike the wallet key file.
**Why it matters:** A cron `beat` under the wrong `HOME` generates a stray private key and fails `unknown-key`. The file's own comment at `cli.mjs:16` says a key must not be created as a side effect.
**Fix:** Create an identity only in `join`. Use `os.homedir()`. Refuse or tighten an identity file with group or other permissions.

### [LOW] The publish workflow can stage a client that still believes it is unpublished
**Where:** `client/src/messages.mjs:35`, `client/src/messages.mjs:45`, `.github/workflows/publish-client.yml:186`
**What:** Nothing requires `PUBLISHED` to be `true` before staging. With it `false`, a client run through `npx` prints a cron line naming its own path inside the npx cache.
**Why it matters:** That path disappears when the cache is cleared, and the failure goes only to `~/.mro/beat.log`.
**Fix:** Add a workflow step before "Stage for approval" that fails unless `PUBLISHED === true`.

### [LOW] `seed` checks the parent's level in the mirror, which runs a day ahead of the chain
**Where:** `warden/src/mcp/tools/seed.mjs:59`, `warden/src/clock/run.mjs:439`, `contracts/src/MachineReadableOnly.sol:847`, `warden/src/mcp/tools/seed.mjs:176`
**What:** On the day the 365th check-in is accepted, the mirror says 365 and the chain says 364. The Clock sends seeds before check-ins, so that night's seed reverts `ParentNotWhole` and lands a night later. This affects an agent that missed days, whose key is already a year old. Separately, the note "the next one opens a year after your first mint" is wrong once a seed is spent; the contract opens one per anniversary (`:830`).
**Why it matters:** The agent is promised an `onChainBy` that is missed by a day, and an operator alert fires for a normal event.
**Fix:** Add a chain-level gate using the `lifecycleOf` record `tokenBlock` already fetches, or report the later date. Reword the note to "on the next anniversary of your first mint".

### [LOW] Report rows say "proven live" on weak evidence
**Where:** `warden/tools/year/report.mjs:202`, `warden/tools/year/report.mjs:72`, `warden/tools/year/checker.mjs:217`, `warden/tools/year/checker.mjs:378`
**What:** A milestone path is "proven live" if the line exists, even when `decoded` is `false` or the decode never ran. "A check-in refused" counts transport errors and `missed-deadline`. The heartbeat is inferred by exclusion, so a mint or Mark written more than a day after it was ordered reads as a heartbeat.
**Why it matters:** These are the narrow places where a failure can appear as a pass on the page. Decode failures do show in the summary, but are not in "Checker FAILs".
**Fix:** Require `decoded === true` for art-bearing milestones, count only door-issued reasons as refusals, include failed decodes in the FAIL total, and widen the heartbeat's window using the Clock log.

### [LOW] Checker robustness: stale log on re-read, and memory lost on restart
**Where:** `warden/tools/year/checker.mjs:311`, `warden/tools/year/checker.mjs:333`, `warden/tools/year/checker.mjs:491`
**What:** The re-read after the 20-second pause reuses the runner log and `today` captured at the start of the pass. Milestone memory lives only in the process, so a PM2 restart drops any crossing that happened across it.
**Why it matters:** The first produces a false FAIL if a runner retry lands in between; the second produces a false "not reached". Neither can produce a false pass.
**Fix:** Re-read the log and `today` for the second judgement, and rebuild memory from `checker.jsonl` on start.

### [LOW] `mro://token/{id}` lacks the strict id check the HTTP route has
**Where:** `warden/src/mcp/resources.mjs:59`, `warden/src/server.mjs:196`
**What:** The resource uses `Number(id)`, so `0x1` reads token 1 and an empty id reads token 0. The `/t/` route refuses both. Its refusal also skips `withNext` and the chain fallback.
**Why it matters:** Two routes to the same view disagree on what an id is.
**Fix:** Apply the same `/^[0-9]+$/` test.

### [LOW] Comments and documents that contradict the code
**Where:** `warden/src/mcp/server.mjs:127`, `client/src/challenge.mjs:33`, `warden/src/mcp/server.mjs:96`, `warden/src/mcp/server.mjs:157`, `skills/machine-readable-only/references/refusals.md:4`, `client/src/mcp.mjs:26`
**What:**
- `server.mjs:127` says `sigHash` is a hash of the Signature header; `checkin.mjs:202` and `door/middleware.mjs:185` say that was replaced by the signature base.
- `challenge.mjs:33` names a `stale-challenge` reason that does not exist; the code retries on `expired` and `challenge`.
- `server.mjs:96` types "1 USDC" literally, against the rule at `mint.mjs:14`.
- The `internal` refusal from a thrown handler skips `withNext`, though `NEXT` has an entry for it.
- `refusals.md` says three reasons carry a second field (at least six do) and files `internal` and `paid-but-unavailable` under routing.
- `CLIENT_INFO.version` duplicates `package.json`.
- Doc blocks sit above the wrong function at `cli.mjs:265`, `door.mjs:45` and `pay.mjs:48`.

**Why it matters:** The project's own rule treats a contradicting comment as a bug.
**Fix:** Correct each in place.

### [INFO] Skill placeholders are guarded by a notice only [BLOCKS MAINNET]
**Where:** `skills/machine-readable-only/SKILL.md:8`, `tools/prepublish-check.mjs:314`
**What:** Eleven `PENDING-BEFORE-MAINNET` markers remain, and the skill already states chain id 8453. The check prints a notice and does not fail. This is known and deliberate; it is recorded so the launch checklist carries it.

### [INFO] The skill's `viewOf` tuple is correct today and pinned by nothing
**Where:** `skills/machine-readable-only/SKILL.md:86`, `warden/src/clock/abi.mjs:1008`
**What:** The 18 types match the ABI. `tools/test/skill-doc.test.mjs` has no check for it, and `read.mjs:31` records that this struct has changed before.

No Critical findings.

## Questions

1. **Can the year reach its heartbeat in the stated run length?** By the scenario, A9 finishes on run day 427, the last write lands on day 428, and `HEARTBEAT_AFTER_DAYS` is 30, so the earliest heartbeat is day 458. `runner.mjs:151` says 450 days and `start.sh:7` says 38 hours (456 days). Did the first run reach it?
2. **Is the `already-minted` gate meant to be mirror-only?** It mirrors `revert AlreadyMinted` but I found no public getter for it in the ABI. It also counts seed rows (`queries.mjs:131`), so a rebound-in key that seeded but never minted is refused a mint the chain would accept.
3. **Does pinning `mro-agent@<version>` pin what runs?** `client/package.json:30` has `viem ^2.56.0` and there is no shrinkwrap, so the dependency tree floats on each install.
4. **Is a 300-second public cache right for `mro://token/{id}`?** The hint at `server.mjs:115` covers every resource read, and a token's view changes when a check-in is accepted.
5. **What does `onChainBy` mean for a mint paid in the last hour before 00:05?** The description says solving takes up to an hour and the Clock writes only solved mints.
6. **Should a check-in be accepted for a token whose payment is held as unresolved?** `checkin.mjs:174` admits only `queued`, so it answers `unknown-token` and the day is lost even if the payment resolves as paid that night.

## Out of scope

- `warden/src/clock/run.mjs:367` -- a paid mint refused `WalletCap` or `SupplyCap` has no named handling and retries nightly until `StaleDay`.

## Coverage

Read in full: everything listed under **Read**.

Read in part or by search only: `warden/src/mirror/queries.mjs` (two ranges), the contract (three ranges plus a search of reverts and events), `door/verify.mjs` and `door/middleware.mjs`, the client tests and `warden/test/year-*.test.mjs` (one excerpt of the checker test), and `references/raw-protocol.md` (a test pins it as a byte-identical copy of the docs file).

Not reached: `warden/tools/year/fund.mjs`, the client and year tests line by line, `warden/public/llms.txt`, `server.json`, and the images, which do not bear on this subsystem.

I checked one suspicion and dropped it: a malformed wallet key does not reach the client's error output, because the installed `@noble/curves` reports only the type, the length or one character.
