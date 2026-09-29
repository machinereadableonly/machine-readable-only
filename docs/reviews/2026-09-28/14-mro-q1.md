# Machine Readable Only -- quality -- token contract, Ladder and finisher places

**Snapshot:** 8d2a0d27e3
**Read:** `contracts/src/MachineReadableOnly.sol`, `contracts/src/Ladder.sol`, `contracts/src/render/TokenView.sol`, `contracts/src/spike/MROSpikeToken.sol` (lines 70-160), `contracts/foundry.toml`; tests `MroTestBase.sol`, `MachineReadableOnly.t.sol`, `FinishLine.t.sol`, `CheckIn.t.sol`, `Lifecycle.t.sol`, `Marks.t.sol`, `Ladder.t.sol`, `Bounds.t.sol`, `AccessControlGaps.t.sol`, `Vouchers.t.sol`, `Heartbeat.t.sol`, `SunsetByAbsence.t.sol`, `MintDay.t.sol`, `RunHistory.t.sol`, `Lineage.t.sol`, `DialEvents.t.sol`, `FastDays.t.sol`, `ContractSize.t.sol`, `TokenView.t.sol`, `WorstCase.sol`, `BuilderCodeSuffix.t.sol`, `RealTokenGas.t.sol` (first 120 lines); every file in `contracts/script/` except the bodies of the two generated bitmap libraries; `tools/spike-bitmaps.mjs`; `warden/DEPLOY.md` lines 520-720; `.claude/rules/*.md`.

Nothing was executed. There is no shell in this review, so every finding comes from reading, not from a `forge` run.

## Findings

**Critical: none found. High: none found.**

The contract has no upgrade path, so any finding in `contracts/src/` that is accepted has to land before the mainnet deploy or not at all. Only finding 2 carries the mainnet tag, because it is the only one where doing nothing risks an irreversible loss.

### [MEDIUM] 1. Four scripts mint with 172-byte bitmaps that both contracts now refuse
**Where:** `contracts/script/SpikeBitmaps.sol:11`, `contracts/script/MintOnePlan1.s.sol:31`, `contracts/script/DeploySpike.s.sol:51`, `contracts/script/SoakSepolia.s.sol:48`, `contracts/script/AbSepolia.s.sol:73`, `tools/spike-bitmaps.mjs:60-74`
**What:** `SpikeBitmaps.sol` is still the version-5 output (`BYTES = 172`). `MachineReadableOnly.sol:358` and `MROSpikeToken.sol:150` both revert `BadCodeLength` on anything but 407. It also holds 27 bitmaps while `SoakStates.sol:25` declares 52 states, so the soak scripts would hit `NoBitmapFor(28)` even after a same-size regeneration.
**Why it matters:** `DeploySpike`, `SoakSepolia`, `AbSepolia` and `MintOnePlan1` all revert on their first mint. `anvil-verify.sh:34` runs `DeploySpike`, so the documented read-back-and-decode check over RPC cannot pass.
**Fix:** Regenerate with `bash tools/spike-bitmaps.sh example.com 52`. In the generator, replace the hard-coded "37x37 grid, 172 bytes" comment (`tools/spike-bitmaps.mjs:73`) and the `slice(0, 172)` split with values derived from the row. Correct `MintOnePlan1.s.sol:16-18`, which still says `CODE_BYTES (172)` and that the domain is undecided.

### [MEDIUM] 2. `closeThePiece` can irreversibly sunset any contract, on any chain, with no guard [BLOCKS MAINNET]
**Where:** `contracts/script/SoakSepolia.s.sol:78-83`
**What:** It is the only broadcasting entry point in `contracts/script/` that does not call `guardChain()`. It sends `sunset()` to whatever address it is given, signed by `deployerKey()`. That selector is identical on `MachineReadableOnly` (`MachineReadableOnly.sol:273`), and on chain 8453 `deployerKey()` returns the owner key (`MroScript.sol:67-80`).
**Why it matters:** One wrong address or `--rpc-url` closes the real piece permanently. The same is true today for the live Sepolia pair, whose owner is the key this script reads.
**Fix:** Call `guardChain()` first, add `require(block.chainid == BASE_SEPOLIA)`, and refuse unless the target's `name()` is the spike's `"MRO Spike (throwaway)"`.

### [LOW] 3. No mainnet source-verification step, and the verify scripts report success on failure
**Where:** `contracts/script/verify-plan7.sh:25`, `:36`, `:42`; `contracts/script/verify-plan6.sh:20`, `:31`, `:37`; `contracts/script/deploy-mainnet.sh:143-147`
**What:** Both verify scripts hard-code `CHAIN=84532` and end each `forge verify-contract` with `|| true`. The "Next" list printed by `deploy-mainnet.sh` and the cutover steps in `warden/DEPLOY.md:545-572` contain no verification step.
**Why it matters:** A failed verification exits 0, and the mainnet checklist never asks for one. It can be done after deploy, so it does not block the deploy itself.
**Fix:** Take the chain as an argument (84532 or 8453), drop `|| true`, exit non-zero on failure, and add the step to `deploy-mainnet.sh` and DEPLOY.md section 10.

### [LOW] 4. The owner can rewrite finisher records 11-15, so `upgradeOf` can contradict the constant place table
**Where:** `contracts/src/MachineReadableOnly.sol:672-693` against `:446-460`
**What:** `finisherMark` is constant "because a table the owner could edit is a promise that can be broken". But `setUpgrade` accepts ids 11-15 with any `maxSupply`, `active` or `requiresWhole`. `RunHistory.t.sol:288-291` does exactly this, writing a blank record over Apex.
**Why it matters:** Places are still assigned correctly. What breaks is the reader-facing record: an agent reading `upgradeOf(15)` can be told a cap that is false, which `FinishLine.t.sol:99-100` names as the thing to prevent.
**Fix:** In `setUpgrade`, for `upgradeId >= FIRST_FINISHER_MARK`, require the record to match the band (cap 0/50/10/3/1, price 0). Alternatively write the five records in the constructor and refuse those ids in `setUpgrade`.

### [LOW] 5. Finishing place is decided entirely by call order; the voucher path would make it first-come
**Where:** `contracts/src/MachineReadableOnly.sol:468-475`, `:515-535`, `:581-610`
**What:** `_finish` hands out `++finishers` in the order credits arrive. `batchCheckIn` accepts entries in any day order, and `checkInWithVoucher` can be submitted by anyone at any time. The settled `(day, tokenId)` rule is therefore a property of the Clock only. The finisher spec does not mention vouchers (no match in `docs/specs/2026-09-20-mro-finisher-marks-design.md`).
**Why it matters:** Nothing is wrong while vouchers are off. If `setVouchersEnabled(true)` is ever called while any of the 64 scarce places remain, a place goes to whoever lands first.
**Fix:** State this on `setVouchersEnabled` and `_finish` in NatSpec. Add a test for a voucher credit that reaches 365 and one for finishers across separate batches (see finding 8).

### [LOW] 6. `rest` on an already-sealed token emits a second `Rested` with a new day
**Where:** `contracts/src/MachineReadableOnly.sol:805-810`
**What:** There is no already-resting check. `Lifecycle.t.sol:155-157` calls the repeat "a harmless no-op", but it emits `Rested(id, today(), ...)` and `MetadataUpdate` again.
**Why it matters:** The log then holds two sealing days for one token. The mirror is unaffected today because `warden/src/clock/reconcile.mjs:162-166` ignores the day.
**Fix:** `if (s.resting) revert Resting(id);` before the write, plus a test.

### [LOW] 7. NatSpec and comments that contradict enforced behaviour
**Where and what:**
- `MachineReadableOnly.sol:384-385`: a finished token gets "the same freeze `rest` gives". It does not: `applyMark` still works on it (`Ladder.t.sol:336-356` applies five Marks after `_makeWhole`), while `rest` blocks Marks.
- `MachineReadableOnly.sol:388-389`: "a test pins the two together" (`FINISH_LEVEL` and `FrameGeometry.DAY_CELLS`). No test compares them; `FINISH_LEVEL` appears in no test file.
- `MachineReadableOnly.sol:394-396`: says the creation floor stops a year of history being fabricated in one night. Check-ins have no floor, so that holds only for new tokens (see Questions).
- `MachineReadableOnly.sol:668`: "`sold` is owned by `applyMark`". `_finish` also writes it (`:473`).
- `TokenView.sol:10`: "level / 365 is completed years". Level stops at 365. `TokenView.t.sol:79-86` still asserts on level 1095.
- `TokenView.sol:25-36`: declares itself "THE AUTHORITY on the packing" but lists only bits 1-10; bits 11-15 are missing.
- `TokenView.sol:38`: "which agent key minted it". `rebind` overwrites it (`MachineReadableOnly.sol:797`).
- `MroScript.sol:54-55` and `SetClockWarden.s.sol:12-13`: list `setSunset` as an owner power. No such function exists; it is `sunset()`.
- `DeployPlan5.s.sol:10`, `deploy-mainnet.sh:3`, `deploy-plan7.sh:3`, `fast/DeployFast.s.sol:12`, `fast/deploy-fast.sh:3`: "ten Marks". The loop writes fifteen (`DeployPlan5.s.sol:32`).
- `anvil-size-check.sh:61-62`: "344 hex characters". `tools/token-bitmap.mjs:12` says 814.
- `DeployPlan1.s.sol:13-14`: "WARDEN_ADDRESS ... has never been set".

**Why it matters:** The token contract's comments are public, verified source, and the project treats a contradicting comment as a finding.
**Fix:** Correct each line. For the `FINISH_LEVEL` pin, add a test that asserts finishing happens at exactly `FrameGeometry.DAY_CELLS`.

### [LOW] 8. Test gaps: owner, access-control and finisher paths
**Where and what:**
- **Ownable2Step on the shipping contract.** Only the happy path is tested (`MachineReadableOnly.t.sol:166-173`, `Bounds.t.sol:216-221`). `transferOwnership` by a non-owner and `acceptOwnership` by the wrong account are tested on the spike (`MROSpikeToken.t.sol:306-329`) but not on the real contract.
- **Bare `vm.expectRevert()`** still guards non-owner `setRenderer`, `setWarden`, `unpause`, `setUpgrade` and `setVouchersEnabled` (`MachineReadableOnly.t.sol:57`, `:70`, `:136`; `Marks.t.sol:113`; `Vouchers.t.sol:129`). `AccessControlGaps.t.sol:144-157` names the selector for only three dials. `Ladder.t.sol:362` is also bare.
- **`seed` day bounds.** `FutureDay` and `StaleDay` are tested on `mint` only (`MintDay.t.sol:47-59`); every `t.seed(` call in the suite passes `_today()`.
- **Code length.** Rejected inputs are 3 and 2 bytes (`MachineReadableOnly.t.sol:241-245`, `AccessControlGaps.t.sol:107-114`). Nothing tests 406, 408 or the old 172. `FastDays.t.sol:48` has only the accepting case.
- **Finisher bands through real finishes.** Mark bits are asserted for places 1 and 2 only (`FinishLine.t.sol:44-78`). The 175-finisher test checks the last ordinal (`CheckIn.t.sol:428-429`) but no Mark bit and no `sold` count at the 4/5, 14/15 or 64/65 boundaries.
- **No test** for a finish reached through a voucher, for places across separate batches, or that `setUpgrade` on 11-15 preserves `sold`.
- **After sunset and under pause.** `MachineReadableOnly.sol:262-264` promises transfers and `rebind` survive sunset; no test calls `rest`, `rebind` or a transfer after `sunset()`, and none calls `rest` or `rebind` while paused.
- **Events.** `Seeded` and `Rebound` are never asserted anywhere in `contracts/test/`.

**Why it matters:** These are the highest-consequence functions in a contract that cannot be patched.
**Fix:** Add the tests above. The 175-finisher test can carry the band and `sold` assertions at no extra setup cost.

### [LOW] 9. `bestRun` gates earned Marks but cannot be read from the contract
**Where:** `contracts/src/MachineReadableOnly.sol:195-215`, `:487-490`
**What:** `_tokens` is internal, `viewOf` omits `bestRun`, and `_effectiveRun` is private. `RunHistory.t.sol:56-57` notes it can only be proven through the gate.
**Why it matters:** No one can read the value that decides Ache, Beat, the earned Iris and Break except by raw storage slot. No funds are at risk, since earned Marks are free.
**Fix:** Add `bestRunOf(uint256)` returning `_effectiveRun`, before the redeploy.

### [LOW] 10. Deploy script does not require the Warden to differ from the owner
**Where:** `contracts/script/DeployPlan5.s.sol:16-30`
**What:** `SetClockWarden.s.sol:55` enforces "warden and owner must be separate". The deploy that `deploy-mainnet.sh` runs does not; `--warden` is only checked for EIP-55 form.
**Why it matters:** Passing the deployer's own address would give the nightly cron key the owner's powers, which is what the separation exists to prevent. It is recoverable with `setWarden`.
**Fix:** `require(warden != vm.addr(key), ...)` before `startBroadcast`.

### [LOW] 11. The anvil gates can pass against a node they did not start
**Where:** `contracts/script/anvil-size-check.sh:20-23`, `contracts/script/anvil-verify.sh:22-25`
**What:** Both start `anvil --silent` in the background on the default port and `sleep 2`. If 8545 is already taken, the new anvil dies silently and the script deploys to whatever is listening.
**Why it matters:** If that node runs with the size limit disabled, the deployability gate passes falsely.
**Fix:** Use the pattern already in `chainguard-check.sh:9-16`: a dedicated port, a readiness poll, and a check that the started process is still alive.

### [LOW] 12. `SwapRenderer` cannot run on a contract with no token 1
**Where:** `contracts/script/SwapRenderer.s.sol:48`
**What:** The post-swap check reads `tokenURI(1)`, which reverts if token 1 does not exist, failing the whole simulation.
**Why it matters:** A renderer swap between the mainnet deploy and the mint of token #1 is impossible with this script.
**Fix:** Skip the read when `totalMinted() == 0`, or take the id as an argument.

### [LOW] 13. Literal 365 where `FINISH_LEVEL` is meant
**Where:** `contracts/src/MachineReadableOnly.sol:736`, `:847`
**What:** `requiresWhole` and `ParentNotWhole` compare against `365`; `_credit` uses the constant.
**Fix:** Use `FINISH_LEVEL` in both. The `/ 365` at `:830` is the agent-year, a different quantity, and should stay.

### [INFO] 14. Ladder details
**Where:** `contracts/src/Ladder.sol:65-69`, `:74-80`; `contracts/src/MachineReadableOnly.sol:686-688`
**What:** `_earned` is a pure alias of `_mark`. The finisher records' `excludes`, `requiresWhole` and `active` are never read by the contract, because `applyMark` refuses the range at `:712`. `setUpgrade` does not refuse bit 0 in a mask, so `requiresAny = 1` would make a Mark unappliable until the owner corrects it.

### What was checked and holds
- **Ids 11-15** are written by `_finish` only, reached only from `_credit` at `level == 365` (`:442`). `applyMark` refuses them before any state is read, and both check-in paths refuse a finished token.
- **Code length.** `mint` (`:358`) and `seed` (`:853`) both check `CODE_BYTES`; the fast variant overrides only `today()` and inherits both checks.
- **Pair-exclusion packing.** Masks are 16-bit, so the variant bits at 16 and above cannot alias an exclusion; the literal-number test (`Ladder.t.sol:74-109`) pins all fifteen masks.
- **Rest and Sunset.** Neither flag has a clearing write anywhere in the contract.

## Questions

1. **Check-in lateness has no floor.** The window is `lastDay < day <= today()`, and `CheckIn.t.sol:463-465` and `:513-520` pin that as deliberate. Creation is bounded to 30 days for the stated reason that a year must not be fabricated in one night. Is unbounded lateness for check-ins intended on the permanent contract, given that one Warden transaction can complete any token minted 364 or more days ago and award it a place?
2. **`deploy-plan6.sh` and `verify-plan6.sh`** are referenced only by comments in the plan-7 scripts and by `docs/plans/`. `deploy-plan6.sh` lacks the build and ABI pin that `deploy-plan7.sh:68-80` added. Can the pair be removed?
3. **`DeployPlan1.s.sol`** deploys without writing the ladder and is used only by `chainguard-check.sh:26`. It will run against mainnet if pointed there. Should it refuse chain 8453?
4. **`FundClock.s.sol:35`** declares a local `deployerKey` that shadows the inherited function it calls on the same line. Does this compile without a warning on solc 0.8.35?

## Out of scope

- `warden/src/clock/run.mjs:358`: a paid mint delayed past 30 days is refused `StaleDay` by the contract and needs manual recovery.
- `.claude/rules/warden.md` describes the check-in window as "one UTC day wide", which does not match the late-write behaviour the contract tests pin.

## Coverage

**Read in full:** the three subsystem source files, the 21 test files listed above, and every script in `contracts/script/` apart from generated bitmap data.

**Not read:**
- `GasBudget.t.sol`, `GasProfile.t.sol`, `MROSpikeToken.t.sol`, `TokenUriGolden.t.sol`, `CombinationMatrix.t.sol` and the render tests.
- `RealTokenGas.t.sol` past line 120.
- The hex bodies of `SpikeBitmaps.sol` and `ByteGateBitmap.sol`.
- `tools/spike-bitmaps.sh`.
- The finisher and ladder specs, beyond searching them.

**Not verified:** the ladder mirror hash, any gas or size figure, and the runtime failure in finding 1, which is inferred from the two length checks and the 172-byte constant.
