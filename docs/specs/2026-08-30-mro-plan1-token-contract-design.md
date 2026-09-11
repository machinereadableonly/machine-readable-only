# Plan 1 design: the MRO token contract

Status: APPROVED by the operator on 2026-08-30, in the brainstorm that produced it.
Implements section 7 of
`docs/specs/2026-08-27-machine-readable-only-design.md`, with the amendments
listed in step 0 below.

---

## 1. Why this, and why now

Phase 0 was signed off on 2026-08-30. It proved the ARTWORK: that a token's
image renders inside the gas and byte budget, decodes through a rasteriser we
do not own, and survives every state in the 26-state soak. It proved nothing
about the thing that HOLDS the state the artwork draws from, because that
contract does not exist yet. The spike token is a throwaway whose `setState`
overwrites the whole struct wholesale, has no Warden, and enforces no gate.

Plan 1 builds the real one. Two properties make it different in kind from
everything built so far:

- **It is permanent.** Base mainnet, no proxy, no upgrade path. The Renderer is
  swappable; the token contract is not. Every decision recorded here is final
  unless the answer is "start a new collection", which the permanence rule
  forbids.
- **It is the gate on everything else.** Plans 2 to 5 -- Warden, reference
  client, Clock, launch -- all need a deployed contract to talk to. Nothing
  downstream can start until this exists.

## 2. Scope

IN:

- `MachineReadableOnly.sol` implementing spec section 7 as amended.
- Wiring to the Phase 0 Renderer through the existing `IRenderer` interface.
- The full Foundry suite from spec section 13.
- The deployability proof required by CLAUDE.md hard rule 7.
- Deploy and Basescan-verify on **Base Sepolia**.

OUT:

- Base mainnet, and any transaction with real value. There is no standing
  approval and Plan 1 does not create one.
- The Warden, the reference client and the Clock. Plan 1 uses a plain EOA as
  the Warden address for testing.
- Lineage visuals. See section 7.

## 3. Step 0: amend the spec before writing any Solidity

Plan 1 reads its requirements from the approved spec, so the spec must stop
contradicting itself first. This is the outstanding half of Task 12: the
go/no-go half closed with the Phase 0 sign-off, the amendment half never ran.

Writing the contract against contradictory text would codify the contradiction
in a contract that cannot be changed afterwards.

| # | Where | The contradiction | Resolution |
|---|---|---|---|
| 1 | lines 392 vs 450 | Effective streak says one missed day drops colour to zero; the colour section says it pales in steps at 3 / 7 / 30 | Graded steps. Already built in commit `be86fee`; the refresh-cost argument is the stronger one and the two rules agree at the far end |
| 3 | line 342 | `uint32 sunsetDay` uses 0 for "not sunset", which cannot express a genuine day zero | Explicit `bool isSunset` beside it. Already built in `2ab5373`; a uint32 and a bool share one slot, so it costs nothing |
| 7 | lines 405 and 481, against line 373 | The spec contradicts ITSELF on the catch-all within two pages. Line 373 says the check-in event must be "never the `(1, max)` catch-all, which indexers treat as hostile"; lines 405 and 481 then specify `sunset` emitting exactly `BatchMetadataUpdate(1, type(uint256).max)` | Removed at both 405 and 481. Line 373's reasoning wins, and it is what the code already does: the spike's `sunset()` deliberately emits nothing and `touchRange` refuses that exact range. See section 6 |
| 8 | line 417 | "the build plan decides whether to include the [voucher] stub" | Stale. The durability commitments (line 752) and CLAUDE.md's locked decisions both require it on chain from day one, paused. Not an open choice |
| 9 | line 373 | `BatchMetadataUpdate(minId, maxId)` "over the exact range written" | Impossible: a day's check-ins are a scattered subset, so min..max is never the exact set. The same line's own hostility argument extends to it. Replaced by per-token emits. See section 6 |
| 10 | section 10 vs the built Renderer | Child visuals were deferred to "a follow-up brainstorm before the Renderer is built"; the Renderer was built in Phase 0 without them | Recorded as a known, accepted deferral rather than a defect. See section 7 |

Conflicts 1 and 3 were already recorded in project memory and marked "amend in
Task 12". Conflicts 7 to 10 were found on 2026-08-30 during this brainstorm and
are new.

## 4. Structure

**One contract**, following spec section 7, not a pre-emptively split one.

Measured baseline on 2026-08-30: `MROSpikeToken` is 6,863 runtime bytes with
17,713 of margin, and it already carries ERC-721, `Ownable2Step`, the renderer
wiring and sunset. The real contract adds mint caps and key binding, packed
batch decoding, mark gates, seed arithmetic and EIP-712 vouchers. Two to three
times the spike still fits under 24,576, but not by enough to assume.

So: build it whole, and **measure at the first milestone** rather than
predicting. The named fallback, decided now so it is not invented under
pressure, is extracting pure logic into `library` code (check-in decoding, mark
gating, seed arithmetic) which the compiler inlines as internal calls without a
separate deployment. Pre-emptive splitting is rejected because it adds
indirection that may never be needed.

Growing the spike into the real contract is rejected outright: it models
nothing real, so it would mean reverse-engineering a throwaway.

## 5. The contract

State and functions follow spec section 7 as amended. The load-bearing
invariants, restated because they are what the tests must pin:

- **One `Token` slot per token, overwritten daily.** Nothing is ever keyed by
  day. This single decision is what makes a check-in about 5,000 gas instead of
  a new storage slot per token per day.
- **One mint per key, ever** (`hasMinted`), while binding is unlimited. So
  `rebind` can move a token to a new key but can never resurrect a mint.
- **The seed budget is keyed by AGENT KEY, not by token**:
  `seedsSpent[key] < (today - firstMintDay[key]) / 365`. This is the locked
  "tenure, not depth" decision -- a lineage cannot accelerate by seeding
  children who immediately seed further children.
- **`rest` and `sunset` are irreversible.** Both block check-in, marks and
  seeding; neither blocks transfer or `rebind`. A sealed token can still be
  owned and traded, which is the point.
- **`tokenURI` delegates entirely.** The contract assembles a `TokenView` and
  hands it to `IRenderer`. It holds no drawing logic, so a renderer swap needs
  no contract change.

Custom errors as listed in the spec: `NotWarden`, `AlreadyMinted`,
`TokenExists`, `SupplyCap`, `DayNotAdvanced`, `MarkInactive`,
`MarkAlreadyApplied`, `MarkSoldOut`, `MarkGate`, `NotTokenOwner`,
`EnforcedPause`, `Resting`, `Sunset`, `ParentNotWhole`, `NoSeedAvailable`,
`WalletCap`, `VouchersDisabled`.

## 6. ERC-4906: per-token emits, no ranges

DECIDED 2026-08-30 after measuring the alternative.

`batchCheckIn` emits one `MetadataUpdate(id)` per token written, AFTER the
storage writes. No `BatchMetadataUpdate`, and never the collection-wide
catch-all.

### Why not the range event

A range covers three groups of token:

1. Tokens written that day. Genuinely changed.
2. Tokens that did NOT check in but crossed a paling step that day. Their image
   genuinely changed with no write at all, because the artwork is a function of
   `today` and `today - lastDay` crossing 3, 7 or 30 repaints them.
3. Everything else in the range. Genuinely unchanged.

Group 3 is the bulk of any range, so a range event over-claims. Group 2 is what
decides it: the spec ALREADY requires the Clock to emit `MetadataUpdate(id)`
for every paling-step crosser, so per-token machinery has to exist regardless.
Per-token emission is therefore not a 14 percent tax for honesty, it is reuse of
something already required. The emit set is one union: tokens written, plus
tokens paling.

### The cost, measured

`MetadataUpdate` is a one-topic log with 32 bytes of data: `375 + 375 + 8 * 32`
= **1,006 gas**. `BatchMetadataUpdate` carries 64 bytes: **1,262 gas**.
Confirmed against this project's own contract -- `touchRange`, which validates
and emits and does nothing else, measures 23,899 gas, of which 21,000 is the
base any transaction pays.

At Base's fee (0.006 gwei, read live from our RPC on 2026-08-30; Basescan showed
mainnet at 0.005 to 0.006) and ETH around 2,500 USD, 1M gas is about 1.5 US
cents:

| Agents checking in per day | Per-token | One range event | Difference |
|---|---|---|---|
| 100 | 100,600 gas | 1,262 gas | ~0.15 cents/day |
| 1,000 | 1,006,000 gas | 1,262 gas | ~1.5 cents/day |
| 1,500 (one full chunk) | 1,509,000 gas | 1,262 gas | ~2.3 cents/day |
| 10,000 (the whole supply cap, daily) | 10,060,000 gas | 8,834 gas | ~15 cents/day |

At the absolute theoretical maximum the honest option costs about 55 USD per
year more; at a realistic 1,000 active agents, about 5.50 USD per year. Money is
not the deciding factor. The only real constraint is the per-transaction gas
budget, and 1,500 per chunk still fits the spec's own `estimateGas < 15M` guard
with per-token emits included -- which a test must assert, not just the Clock.
Amended 2026-09-11: measured against a real node, 1,500 fits the Clock's
padded guard by only 177,808 gas, so the Clock now uses chunks of 1,400. The
emit comparison above is unaffected.

`sunset()` emits no metadata event at all, matching the spike and resolving
conflict 7. The spec asserts the catch-all in two places (lines 405 and 481)
while forbidding it in a third (line 373); both assertions go.

A sunset genuinely does change every token, so emitting nothing is a real
choice and not an oversight. It is the right one here: the collection-wide
range is the single event indexers treat as hostile, the piece must never
depend on an indexer refreshing anyway, and a sunset is a one-time terminal
event whose staleness costs nothing that matters. The real contract knows its
own minted range, so if a future operator wants to announce a sunset it can
emit over the ids it actually minted -- which is what the spike's own comment
says the real contract should do.

Standing caveat: measured on 2026-08-29 to 30, Alchemy's warm-entry
invalidation does nothing on Base Sepolia, so the PRACTICAL harm of
over-claiming is currently low. The argument above is structural, not urgent,
and is recorded that way deliberately.

## 7. Lineage: data now, visuals later

`generation`, `parentOf` and `seedsGiven` are stored and exposed in `TokenView`
from day one. The Phase 0 Renderer surfaces them as text attributes only
(`Renderer.sol:235-237`), so a seeded child and a founding token at the same
level, streak and marks render as identical images.

That is ACCEPTED for Plan 1, not overlooked. The reasoning:

- The Renderer is swappable through `setRenderer`, so this is the one decision
  in Plan 1 that is reversible. Adding child visuals later needs no contract
  change and no migration.
- Because the data is recorded from the first mint, a later renderer can draw
  lineage RETROACTIVELY for tokens that already exist.
- All seven drawing surfaces are currently claimed by the Marks ladder, so a
  lineage visual has no free surface waiting. Deciding it properly needs its own
  brainstorm, and rushing it into Plan 1 would either crowd a Mark or produce a
  weak eighth surface.

Accepted cost, stated plainly: any child minted before the renderer swap looks
like a founder until the swap lands.

## 8. Vouchers: present and paused

`checkInWithVoucher(uint256 id, uint32 day, bytes wardenSig)` ships in the
contract, guarded by a `whenVouchersEnabled` flag that is OFF at launch, with
full EIP-712 machinery and the `VouchersDisabled` error.

This is not optional and is not a build-plan choice (conflict 8). The spec's
durability commitments require "the voucher check-in path exists on-chain from
day one so tokens can be kept alive without the Warden", and CLAUDE.md's locked
decisions say it ships paused.

The reason is the project's own strongest evidence: five of six early-2026
agent mints had dead infrastructure within six months. Because the contract has
no upgrade path, a voucher path left out now can NEVER be added -- the piece
would simply die with the Warden, and a record of return visits that cannot
record a return visit is a dead artwork. Including an unused paused function is
a small permanent cost against an unrecoverable failure.

## 9. Testing

Spec section 13's contract list in full. Specifically:

- Every function, every revert, every owner and Warden path.
- One mint per key; explicit-id mint and `TokenExists`; supply cap; wallet cap.
- `day > lastDay`; streak continuation vs reset; out-of-order and multi-day late
  writes.
- Marks: bitmask, gates, supply, `MarkSoldOut`.
- `rebind` by a non-owner reverts; binding one key to several tokens succeeds.
- Pause blocks mint, check-in and marks but never transfer or `rebind`.
- `Ownable2Step` handover, and every dial setter.
- `rest`: non-owner reverts; resting blocks check-in, marks and seed but not
  transfer or rebind.
- `seed`: every gate, and the one-per-year arithmetic across several years using
  `vm.warp`.
- `sunset`: freezes everything, cannot be undone, and registers correctly on day
  zero (the regression conflict 3 came from).
- Effective-streak paling for lapsed tokens and colour lock for resting ones.
- A `tokenURI` golden test that decodes the base64 and asserts cell count,
  colour, rings and mark elements against the REAL Renderer, not a stub.
- A gas test asserting a full 1,500-token chunk (1,400 since 2026-09-11) including per-token emits stays
  under the 15M guard.
- CLAUDE.md hard rule 7: `forge build --sizes` showing positive runtime margin,
  AND a strict-limit anvil deploy returning non-empty `cast code`.

Per the global smart-contract rules, every owner, emergency and admin function
gets an explicit test, and every access-control revert gets a test.

## 10. Risks

- **Contract size.** The live risk. Mitigated by the milestone checkpoint in
  section 4 and the named library fallback. `test/ContractSize.t.sol` already
  fails the suite on a violation.
- **Gas per chunk.** Per-token emits add about 1.5M gas to a full chunk. A test
  must assert the 15M guard holds; leaving it to the Clock would move a
  contract-level constraint into a component that does not exist yet.
- **Renderer integration.** Where contract and renderer disagree about field
  names or semantics. The golden `tokenURI` test against the real Renderer is
  the thing that catches it; a stubbed renderer would hide exactly this class of
  bug.
- **Permanence.** There is no upgrade path, so a design error here is not
  fixable later. This is why step 0 exists.

## 11. Sequence

1. Amend the spec, six conflicts. Commit.
2. Core: ERC-721, state layout, `mint`, dials, pause, `Ownable2Step`.
   **SIZE CHECKPOINT.**
3. `batchCheckIn`: packed id decoding, per-token emits, plus the chunk gas test.
4. `applyMark`, `rebind`, `rest`.
5. `seed` and the per-year budget arithmetic.
6. `checkInWithVoucher`, paused, with EIP-712.
7. Wire `IRenderer`; golden `tokenURI` test against the real Renderer.
8. Deployability proof, then Base Sepolia deploy and Basescan verify.

Phase boundaries for check-in, per the operator's working style: after step 1, after step
2 (the size number changes what follows), and after step 8.

## 12. What this design does NOT decide

- Child token visuals. Deferred to its own brainstorm before any renderer swap.
- Anything about Base mainnet. Plan 1 spends nothing.
- The Clock's chunking and sorting behaviour, beyond requiring that the contract
  stay under the gas guard at 1,500 per chunk (1,400 since 2026-09-11).
- Whether the spike contract and its tests are deleted afterwards. That needs
  the operator's explicit approval and is not assumed here.
