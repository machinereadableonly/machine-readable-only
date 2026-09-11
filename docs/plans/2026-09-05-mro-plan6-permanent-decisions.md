# Plan 6 -- the four decisions that a deploy makes permanent

Decided by the operator on 2026-09-05, from the three reviews of 2026-09-04 and the
rendered evidence in `tools/out/slip.png`.

## Why this plan exists, and why it comes before everything else

`MachineReadableOnly` has no upgrade path. Of the 158 findings across the three
reviews, **four** cannot be fixed after the mainnet deploy, because each of
them is either a field in a storage slot or a constant that is read at
construction. Everything else -- both payment Criticals, the door, the Clock,
the client -- can be fixed on a running piece.

So this plan is not the most urgent work by severity. It is the work that has a
deadline, and the deadline is the deploy. Doing the payment fixes first and
this second would mean either deploying a contract we already know is wrong, or
throwing that work away and redeploying.

Two of the four also close the same defect, found independently by two reviews
from opposite directions: **the built piece rewards an agent that stops over an
agent that comes back.** The colour does it, and the Mark gate does it. The
piece's entire subject is coming back. That is the thing this plan fixes.

## What was decided

| # | Decision | Chosen |
|---|---|---|
| 1 | What a missed day looks like | Drop one shade at once, then fade the lost run on the usual 3/7/30 ladder |
| 2 | What the earned-Mark run gate reads | TRUE "ever reached" -- if the run was ever completed, the Mark is available |
| 3 | The unplanned ending | `sunsetByAbsence()` after 365 days of Warden silence, plus `sunsetDay` in the view |
| 4 | The ladder ceiling | `MAX_MARK_ID = 15`, ids 11-15 never written, and NO permanence sentence served |

Decisions 1 and 2 were re-asked in plain English after the first framing failed;
2 was re-asked a second time because the option label ("a run you once achieved
is yours forever") described something the contract does not do. What the operator chose
is the principle, not the status quo, and it needs a stored field.

## The storage, which is the whole constraint

`struct Token` is exactly one 256-bit slot, and keeping it that way is what
makes a check-in cost about 5,000 gas. Six `uint32`s and a `bool` leave
**56 bits** (`uint56 reserved`, `MachineReadableOnly.sol:35`).

Three numbers have to fit in those 56 bits:

| field | width | holds | ceiling |
|---|---|---|---|
| `fellRun` | `uint16` | the run that most recently fell | 65,535 days = 179 years |
| `bestRun` | `uint16` | the longest run ever completed | 179 years |
| `fellDay` | `uint24` | the day that run fell | 45,000 years |

16 + 16 + 24 = 56. Exact fit, same slot, no extra `SSTORE`, and a check-in
costs what it costs today.

**Why two run fields and not one.** `fellRun` must be the run that *most
recently* fell, because the colour fades from the day it fell -- an old long run
colouring a recent small slip would be wrong. `bestRun` must be the largest ever,
because the Mark gate asks "was this run ever completed". They answer different
questions and cannot share a field.

**Why `uint24` for a day is safe.** `lastDay` and `mintDay` are `uint32` and stay
that way; only the fall day is narrowed. `today()` is a UTC day index, so
`uint24` runs to about the year 47,000.

## Steps

Ordered so the suite is green at every step. Every Solidity step ends with
`forge test`; every JS step ends with the relevant `npm test`. The final step
proves deployability, which this project requires before anything is called done.

### Phase 1 -- the contract

1. **Widen the token struct.** Replace `uint56 reserved` with `uint16 fellRun;
   uint16 bestRun; uint24 fellDay;` and update the slot comment at `:25` to show
   the new arithmetic. Fix the two test initialisers that set `reserved: 0`
   (`GasBudget.t.sol:83`, and NOT `MROSpikeToken.t.sol:134`, which is the Phase 0
   spike's own separate struct and does not change).

2. **Maintain the three fields on both check-in paths** (`batchCheckIn:330`,
   `checkInWithVoucher:406`), which today are the single line
   `s.streak = (day == s.lastDay + 1) ? s.streak + 1 : 1;`. Becomes:
   - on a lapse (`day != s.lastDay + 1`): record `fellRun = uint16(s.streak)`
     and `fellDay = uint24(s.lastDay)` BEFORE the reset;
   - always, after the new streak is known: `if (streak > s.bestRun) s.bestRun =
     uint16(streak);`
   Both writes land in a slot already being written. Saturate rather than
   truncate on the `uint16` casts -- a run cannot reach 65,535 in this piece's
   lifetime, but a silent wrap is not an acceptable failure mode, so clamp.

3. **The Mark gate reads the effective run.** In `applyMark`, replace
   `if (s.streak < u.minStreak) revert MarkGate();` (`:502`) with a run computed
   as `s.streak > s.bestRun ? s.streak : s.bestRun`, and write Mark 6's stored
   run at `:521` from that SAME value, so an earned Iris records the run it was
   actually granted for.

4. **Raise the ladder ceiling.** `MAX_MARK_ID` 10 -> 15 (`:89`). Nothing else
   moves: `excludes` and `requiresAny` are already `uint16` so bit 15 is
   addressable, and bit 16 is the Iris shape, which makes 15 the true ceiling.
   The deploy script writes ids 1-10 only, exactly as it does now.

5. **Record the Warden's last write.** `uint32 public lastWardenDay;` beside
   `sunsetDay` (`:81`, that slot has 112 bits spare). Set to `today()` in `mint`,
   `batchCheckIn`, `applyMark`, `seed` and `checkInWithVoucher` -- one warm
   `SSTORE` per transaction, not per token, so the nightly batch pays it once.
   Initialise to `today()` in the constructor.

6. **The unplanned ending.** Add `error NotAbsent(uint32 daysSinceLastWrite);`
   and a permissionless `sunsetByAbsence()` that reverts `AlreadySunset` if
   already closed, reverts `NotAbsent` under 365 days since `lastWardenDay`, and
   otherwise sets `isSunset`, sets `sunsetDay = today()` and emits `SunsetAt`.
   It can only ever do what the owner could already have done.

7. **Extend the view.** Add `fellRun`, `fellDay` and `sunsetDay` to `TokenView`
   and populate all three in `viewOf` (`:151`). `sunsetDay` shares a slot with
   `isSunset`, so that read is free. While here, correct `TokenView`'s stale
   comment "(1 Vein .. 7 Singularity)" -- that ladder was retired on 2026-09-02.

### Phase 2 -- the two renderers, in step

8. **`Renderer._rung`.** Three branches instead of two:
   - `resting` -- unchanged, `tierIndex(v.streak)`. Rest is the owner's choice at
     a moment and the stored streak is that moment.
   - `sunset` -- `Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay)`: the
     colour as at the day the piece closed, which is what "rests where it
     stands" means. Today a sunset un-pales a two-year-old lapse.
   - live -- the decision 1 rule:
     `max(lapsedIndex(streak, lastDay, today),
          min(lapsedIndex(fellRun, fellDay, today), tierIndex(fellRun) - 1))`
     with the second term skipped entirely when `fellRun == 0`.

9. **`_suffix` returns " (At Rest)" for `v.resting || v.sunset`** (`:333-335`),
   which the spec already says and the code does not do.

10. **Mirror both in `tools/render-token.mjs`.** The byte-for-byte differential
    test fails otherwise, which is the point of it.

### Phase 3 -- the Warden mirrors the contract

11. **Carry `bestRun` in the mirror.** A `bestRun` column on `tokens`, maintained
    by `checkin` the same way the contract does, and read by the run gate in
    `upgrade.mjs:50` and `ladder.mjs:44` -- both of which today read the stored
    streak while their own comment says "run is the live streak". The gates must
    mirror the contract or an agent is quoted a Mark the chain then refuses.
    `fellRun`/`fellDay` are NOT mirrored: nothing in the Warden draws.

12. **Reconcile learns `bestRun`** from the same events it already reads, so a
    token whose history predates the column converges.

### Phase 4 -- the documents that are now wrong

13. **Ladder spec** (`2026-09-02-mro-mark-ladder-design.md`): delete ":816 A third
    Tint ink could be added later" -- still false at `MAX_MARK_ID = 15`, because
    `_variantCount` is a pure function and not a dial -- and replace ":80 Run is
    the live streak" with the ever-reached rule.

14. **Master spec**: decision 10 becomes true as written once ids 11-15 exist, so
    it stays. Record the ceiling and the ending in section 9 and the endings
    section.

15. **`llms.txt`**: add the `sunsetByAbsence` sentence to "The operator" --
    "If the operator simply stops, the piece closes itself: after 365 days
    without a write from the Warden, anyone may call `sunsetByAbsence()`, and
    every token rests where it stood." Add NO permanence sentence about the Mark
    count, per decision 4. Check whether `:138-139`'s lapse wording still
    describes the new colour rule. `pm2 restart mro-warden` after any change.

### Phase 5 -- proof

16. **Tests.** One Foundry test per bound, because the reviews found that
    14 committed tests once passed only because a bound was missing:
    - the slip colour at the day of return, +3, +7, +30, and a new run
      overtaking the fall;
    - a lapsed-then-returned token CAN take Break, and a token that never
      reached 365 cannot;
    - `bestRun` survives multiple falls and never decreases;
    - `sunsetByAbsence` at 364 days (reverts) and 365 (succeeds), the reset on
      every warden write, and a paused-and-abandoned contract still resolving;
    - `setUpgrade` accepts id 15 and rejects 16.
17. **Parity.** The JS/Solidity differential must be byte-for-byte green.
18. **Deployability**, which this project requires before "done":
    `forge build --sizes` showing positive runtime margin, and the strict-limit
    anvil deploy with non-empty `cast code`. Re-measure the gas worst case --
    `GasBudget.t.sol`'s `worstGas` and `maxBytes` are DIFFERENT tokens and both
    figures move.

## What this plan does not do

- **It does not deploy.** A Base Sepolia redeploy is the natural next step and
  is a separate decision; a mainnet deploy spends real funds and is an operator gate
  every time.
- **It does not touch the payment path.** 14.1 and 14.3 are the next plan, and
  they are Criticals -- they are second only because they can be fixed on a
  running piece and this cannot.
- **It does not re-solve the QR bitmaps.** That is a mainnet prerequisite
  already recorded, and it is independent of everything here.

## The cost of being wrong

Everything in Phase 1 is permanent from the mainnet deploy. Phases 2 to 5 can
be changed afterwards -- the renderer is swappable by design, and the Warden and
the documents are not on chain. So Phase 1 is the phase to review slowly, and
the rest is ordinary work.
