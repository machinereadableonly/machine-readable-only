# Plan: attach a Base Builder Code to every transaction the Clock sends

2026-09-12. Status: APPROVED by the operator 2026-09-12 WITHOUT step 3 (no
mainnet guard) -- "flag this in the mainnet plan" instead: DEPLOY.md section 10
carries a `BUILDER_CODE` row, and the Clock logs `builder code none yet` every
run until it is set.

## Why this matters

Base credits an app's on-chain activity -- App Leaderboards, the Base App store,
future rewards -- only when each transaction carries the app's Builder Code as
an ERC-8021 suffix on the end of its calldata. It has to be in place before the
first mainnet write, or that history is credited to nobody. base-200 did this
on 2026-09-12; the operator asked for the same here and for every Base project.

We cannot get MRO's code yet: registering a second app on the operator's Base
account is broken (open Base bug base/docs#1950), and the operator chose to wait
for the fix. So this plan builds and proves the plumbing NOW, so that the day the
code is issued it is a one-line change.

## What was checked

- **One place sends every transaction**: `send()` in
  `warden/src/clock/write.mjs` -- simulate, estimate gas, send. The Clock is the
  only on-chain writer in the project (the agents' USDC payments are settled by
  Coinbase's facilitator, which is not ours to tag).
- **No contract reads raw calldata** (`msg.data`, `calldatasize`,
  `calldataload`: zero hits in `contracts/src`), so normal argument decoding
  ignores the extra bytes. Proved per function in step 4, not assumed.
- **viem 2.56.0 accepts `dataSuffix`** on `simulateContract`,
  `estimateContractGas` and `writeContract` (installed type definitions), and
  Base's official viem guide requires >= 2.45.0.
- **`ox/erc8021` already works in the Warden** (ox 0.14.34, via viem):
  `Attribution.toDataSuffix` produces the same 29-byte schema-0 layout base-200
  ships. The bytes are not hand-rolled.
- Cost: 29 bytes of calldata, about 464 gas a transaction -- noise against the
  Clock's 500,000-gas chunk margin.

## Steps

1. **`warden/src/clock/builder-code.mjs`**: `BUILDER_CODE`, set to `null` until
   Base issues one, and the suffix derived from it with
   `Attribution.toDataSuffix`. A comment says it is public, not a secret (it is
   written into public calldata by design).
2. **`write.mjs`**: pass `dataSuffix` to all three calls in `send()` --
   simulate, estimate and send -- so the gas estimate includes the extra bytes.
   `makeWriter` takes the code as an injectable setting defaulting to the
   constant, so tests can exercise the "code set" path while it is `null`.
3. **A mainnet guard**: the Clock refuses to start on Base mainnet (8453) while
   `BUILDER_CODE` is `null`, with a message saying why. Same pattern as the
   placeholder-treasury refusal: a mainnet-only omission that no testnet run can
   surface. Base Sepolia runs as today.
4. **Tests**:
   - the suffix matches the ERC-8021 schema-0 layout rebuilt by hand from a test
     code (base-200's test, ported);
   - through the REAL `send()`: the calldata sent ends in the suffix when a code
     is set and is byte-identical to today when it is `null`; simulate and
     estimate receive it too. Proved by breaking the wiring, not the helper;
   - the mainnet guard refuses with no code and allows Sepolia;
   - **a Foundry test that calls each function the Clock sends -- `mint`,
     `batchCheckIn`, `applyMark`, `seed` -- with and without a suffix and
     asserts identical state**, so "contracts ignore trailing bytes" is pinned
     in the contracts suite for good.
5. `DEPLOY.md` section 10 gains a Builder Code row; `.claude/rules/warden.md`
   gains one line.
6. All four suites green, `prepublish-check` clean, commit.

Nothing live changes: with the code `null`, the Clock's transactions are
byte-identical to today's, so no restart is needed. Pushing needs the operator's
approval as always.

## The day the code is issued

Set `BUILDER_CODE`, update the test's expected code, run the suites, commit,
push. The next Clock run carries it. Verify on the first real transaction: its
input data must end in `8021` repeated eight times, and Base's Builder Code
Validation tool should credit it.

## Trade-off

The mainnet guard (step 3) makes the mainnet launch depend on having a code --
from the dashboard once #1950 is fixed, or from Base's agent route
(`POST api.base.dev/v1/agents/builder-codes` with the mainnet writer wallet) as a
fallback. That is the point of the guard, but it is a real dependency. Drop
step 3 if a launch without attribution should stay possible.

## Also noted

The `base:app_id` tag stays PARKED (uncommitted in `warden/public/door.html`
and `warden/test/door-page.test.mjs`) until a registration succeeds -- see the
publish-readiness memory.
