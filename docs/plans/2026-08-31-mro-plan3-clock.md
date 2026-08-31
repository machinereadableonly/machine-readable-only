# Plan 3: the Clock

**Status:** approved 2026-08-31. Follows Plan 2.

## Why

Plan 2 built a service that takes an agent's money and writes its intent into
a SQLite queue. Nothing drains that queue. No token minted through the Warden
has ever reached the chain, and no check-in has ever been credited on chain.

The Clock is the other half. Once a day it reads the queue, writes it to Base,
reconciles the mirror against what actually landed, and nudges the metadata
consumers. Until it exists the piece is a shop with a till and no stockroom.

## Scope

**In:** the chain writer, the gas guard, chunking, receipt verification, event
reconcile, the retry and alert rules, the scheduled run, and a live rehearsal
on Base Sepolia that lands real transactions.

**Out: the daily X post.** The spec (section 12) bundles it under "the Clock",
but it needs X API credentials only the operator has, it publishes publicly, and it
shares no code with the writer. It gets its own plan. Shipping a working Clock
beats shipping half a poster.

**Out: mainnet.** Everything here is Base Sepolia. Mainnet is a separate,
explicit, real-funds gate.

---

## What was measured before this document was written

Plan 2's document carried 31 defects, every one in code that was written into
the plan and never executed. So each load-bearing assumption below was run
against the deployed contract on 2026-08-31 first.

| Fact | Value | Why it matters |
|---|---|---|
| `viem` | 2.56.0, already on disk | Pulled in by `@x402/evm`; no new dependency, but declare it directly rather than lean on a transitive |
| Chain | `84532`, gas price **0.006 gwei** | The Base floor. The spec's `MAX_GAS_GWEI` default of 0.05 is about 8x headroom |
| Id packing | `ids.map(n => hex(n,8)).join("")` | Byte-identical to viem's `encodePacked(["uint32",...])`. Verified, not assumed |
| `simulateContract` on a revert | throws, and **names the custom error**: `FutureDay(uint32 day)`, `DayNotAdvanced(uint256 id)` | This is what makes the re-chunk rule implementable: the Clock can tell WHY a chunk failed |
| `simulateContract().request.gas` | **`undefined`** | A trap. The spec says assert `estimateGas < 15M`; the gas is NOT on the simulate result and must come from `estimateContractGas` separately |
| `estimateContractGas(mint)` | 322,601 gas | About 0.0000019 ETH at the floor |
| **`eth_getLogs` range** | **capped at 10,000 blocks** by the public RPC | Base blocks are 2s, so 10,000 blocks is about 5.5 hours. **A day is about 43,200 blocks.** Reconcile MUST page, or it silently reads a fraction of the day |
| Deploy block | `46163891` | Reconcile's floor. A rolling window is wrong; the contract had zero logs in the last 9,000 blocks |
| `warden` / `owner` | both `0x9749...6aE5` | The separation problem below |

The last two are the ones that would have shipped broken.

---

## The key separation problem

The contract's `warden` and `owner` are the same address. `onlyWarden` gates
`mint`, `batchCheckIn`, `applyMark` and `seed`; `onlyOwner` gates
`setRenderer`, `setWarden`, `setSunset`, `pause` and ownership transfer.

If the Clock signed with that key, a compromised Clock could close the piece
permanently. So:

- A **dedicated Clock key** is generated, holding only gas ETH.
- `setWarden(clockAddress)` points the contract at it. Reversible by the owner.
- The owner key is not on the Clock's path at all.

This matches the spec's own key table, which says `WARDEN_PRIVATE_KEY` "holds
only gas ETH".

**The key never passes through a conversation or a transcript.** A script
generates it directly into the environment file, which Claude cannot read.

---

## Tasks

### Task 1 - the signer, and its separation

1. `scripts/make-clock-key.sh` generates a key with `cast wallet new`, appends
   `CLOCK_PRIVATE_KEY` to the Warden's environment file, and prints ONLY the
   address. the operator runs it; the private half never reaches stdout, a log, or this
   repository.
2. Fund that address with Base Sepolia ETH from the deployer.
3. `setWarden(clockAddress)` from the owner key, via a Foundry script that
   reads the contracts environment file itself.
4. Verify on chain: `warden()` is the Clock address and `owner()` is unchanged.

**Gate:** steps 2 and 3 are on-chain writes. Testnet only, and reversible.

### Task 2 - the chain client

`clock/src/chain/write.mjs`. A viem wallet client on Base Sepolia.

- **The gas guard first.** Read `eth_gasPrice`; above `MAX_GAS_GWEI` (default
  0.05), log, alert, stop. Pending rows keep their own day numbers, so levels
  and streaks are identical whenever the write lands.
- **`estimateContractGas` separately from `simulateContract`**, because the
  simulate result carries no gas. Assert under 15M before sending.
- **`receipt.status === "success"` or it did not happen.** viem RESOLVES on a
  reverted transaction rather than throwing; a row marked `written` on a
  resolved promise alone is a lie. This is a standing rule across these
  projects, and it is the single most expensive mistake available here.
- Nonces managed explicitly, so a stuck transaction cannot silently reorder a
  batch.

### Task 3 - what to write, in order

Read pending rows with `day <= yesterday`; a check-in at 00:03 belongs to the
next batch.

1. **`mint`** for every queued token whose `solveState = 'done'`.
   - A token at `solveState = 'failed'` is **alerted and left pending, never
     minted with placeholder art.** The contract writes `code` once and
     permanently, so a placeholder is a permanently broken artwork rather than
     a delayed one. Decided by the operator, 2026-08-31.
2. **`batchCheckIn`** in chunks.
3. **`applyMark`** for every reserved Mark.

### Task 4 - the all-or-nothing rule

`batchCheckIn` reverts the WHOLE chunk on one bad entry. The rule, inherited
from Plan 1's fix wave:

> **Re-chunk with the offending ids removed. Never retry the whole chunk.**

The decoded error name says which rule was broken (`DayNotAdvanced(uint256 id)`
carries the id; `FutureDay(uint32 day)` carries the day). Bisect only when the
error does not identify the entry.

A chunk that has already landed must never be resent: that is what
`receipt.status` plus the mirror's `status` column are for.

### Task 5 - reconcile

After every run, read the events and make the mirror agree with the chain.

- **Page `eth_getLogs` in 10,000-block windows.** This is the measured cap. A
  day is about 43,200 blocks, so a run pages about 5 times. A single unpaged
  call reads five hours and silently reports success.
- Floor at the deploy block, `46163891`, not a rolling window.
- Events: `Minted`, `BatchCheckedIn`, `MarkApplied`, `Rebound`, `Transfer`,
  `Rested`.
- `Rested` is how the mirror's `resting` column gets maintained properly rather
  than learned lazily by the Warden's gates.

### Task 6 - the metadata poke

The on-chain half is **already done**: `batchCheckIn` emits one
`MetadataUpdate` per token after the writes (`MachineReadableOnly.sol:331`).
The "scattered subset versus contiguous range" question recorded as an open
Plan 3 item does not apply to this contract.

What remains is the off-chain refresh call, and it comes with a hard limit:

- **It cannot be rehearsed on Base Sepolia.** Alchemy's dedicated
  `refreshNftMetadata` endpoint returns HTTP 400 there ("isn't enabled for that
  chain or network just yet"). Measured 2026-08-30.
- So it ships **written and unproven**, clearly labelled, and must never be
  described otherwise.
- **It verifies `timeLastUpdated` moved** rather than firing and forgetting.
- The piece must never DEPEND on an indexer refreshing. The audience is agents,
  who call `tokenURI` directly.

### Task 7 - the runner

- A systemd timer at 00:05 UTC. Not cron: the timer gives `Persistent=true`, so
  a run missed while the box was down happens on the next boot.
- `~/logs/mro-clock.log`.
- A row still pending after **three** runs raises an alert carrying the
  transaction hash and the revert reason.
- A run must be safe to execute twice. Every write is keyed on mirror state
  that the previous run marked `written`.

### Task 8 - the live rehearsal

Real transactions on Base Sepolia, not a simulation:

1. A queued mint through the whole path, ending in a token on chain.
2. A real `batchCheckIn` crediting a day.
3. **A deliberately poisoned chunk** - one id the chain will refuse - proving
   the re-chunk path removes it and lands the rest.
4. A reconcile run over a window wider than 10,000 blocks, proving the paging.
5. `tokenURI` read back and decoded, proving the artwork survives the round
   trip.

---

## Risks

- **A key on the VPS for the first time.** Mitigated by separation from the
  owner, a gas-only balance, and testnet scope. It is still the largest change
  in this plan.
- **The RPC is now load-bearing twice over** - the Warden's gates already
  depend on it, and the Clock cannot write without it. A public endpoint is
  fine to start; refusals in the log are the signal to upgrade.
- **Chunk size is unverified.** The spec's 1,500 comes from arithmetic
  (about 7k gas per check-in), not measurement: only one token exists, so a
  full chunk cannot be estimated yet. Task 8 measures the real per-entry cost
  and the figure is adjusted then, rather than trusted now.

## Out of scope, recorded so it is not lost

- The daily X post (its own plan).
- Mainnet deployment and the mainnet facilitator.
- The Marks catalogue, which is still empty, so `applyMark` has nothing to
  write until it is filled.
