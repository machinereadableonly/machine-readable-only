# Pre-mainnet follow-ups

**Why:** these are the leftovers from the Plan C, Plan A and accelerated-year
reviews that touch the mainnet deploy or the nightly Clock. Clearing them now,
while Night 2 waits, means Plan E (key custody) is the last thing between the
code and the mainnet mint.

**Scope:** four items. Two of the six first listed are closed by inspection,
with no code change:

- `DeployPlan5.s.sol` "re-run reverts FinisherRecordSet(11)": stale. Since A3
  the script deploys a NEW pair every run, so it never writes the ladder into a
  contract that already holds it. `forge script --resume` only sends the
  transactions that never landed.
- "`rendererFrozen` costs its own slot": wrong. `forge inspect ... storageLayout`
  puts it in slot 27 at offset 30, packed beside `vouchersEnabled`. Solidity
  packs by declaration order, not by where in the file a variable sits.

**Where the work happens:** a worktree on a branch `followups`, NOT the main
checkout. The Clock runs from the main checkout at 00:05 UTC, and Night 2 must
prove the code A3 deployed, unchanged. The branch merges to `main` only after
Night 2's `verify-border` passes. Cost: the merge waits until tomorrow.

**Nothing here is irreversible.** No contract source changes, so no bytecode
moves and no redeploy. The fork rehearsal writes only to a local anvil copy
that dies with the script. The push stops for the operator's approval.

## Tasks

1. **Clock: a housekeeping failure cannot end or hide the night.**
   - `run.mjs`: wrap `resolveUnresolvedPayments` the way `sweep` already is.
     On a throw, record `summary.resolveFailed`, alert, and carry on to the
     gas guard and the writes.
   - `sweepFailed` (and the new `resolveFailed`) becomes a fixed sentence when
     the error text is empty, so `exitCodeFor` still returns 1.
   - `exitCodeFor` returns 1 on `resolveFailed`.
   - `main.mjs`: the run-finished line names a sweep or resolve failure.
   - Tests first: a database whose `unresolvedPayments()` throws still runs the
     gas guard and the writes, and exits 1; an error with an empty message
     exits 1; the finished line carries the failure.

2. **Verification script covers both explorers and both chains.**
   - `verify-plan7.sh` takes the chain id (84532 or 8453, anything else
     refused) instead of hard-coding 84532, and after Basescan also verifies
     on Blockscout (`base-sepolia.blockscout.com` / `base.blockscout.com`,
     each URL confirmed live before use).
   - Prove it by re-running it against the live Sepolia pair: both contracts
     already verified, so each explorer must answer "already verified".
   - `deploy-mainnet.sh`'s printed next steps name the new invocation.

3. **Run the mainnet fork rehearsal end to end.**
   `~/scripts/safe-build.sh bash warden/tools/mainnet-fork-rehearsal.sh`,
   from the worktree once Tasks 1-2 are in. Every step must report ok. A FAIL
   is diagnosed and fixed in this plan, or reported if the fix is the
   operator's. Check `~/.foundry/anvil/tmp` is near zero afterwards.

4. **Year checker: a gas stop is a HOLD, not a FAIL.**
   - `warden/tools/year/checker.mjs`: when the Clock's latest run reported
     "above the cap -- nothing written", a token whose chain state trails the
     mirror by unwritten queued credits is reported with severity `HOLD`, not
     `FAIL`. Any other mismatch still FAILs.
   - Tests first in `year-checker.test.mjs`: gas-stopped lag is HOLD; the same
     lag with no gas stop is FAIL; a real mismatch during a gas stop is FAIL.

5. **Gates, review, commit.** All four suites green, the prepublish guard
   clean, one fresh-context reviewer over the branch, findings fixed, then
   commits on `followups` (auto-commit rule).

6. **After Night 2 passes (tomorrow):** fast-forward `main` to `followups`,
   then ask the operator to push. Update `deferred-review-items` memory.
