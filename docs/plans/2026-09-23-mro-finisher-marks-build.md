# The Finisher's Marks and the Year That Ends -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**After completing any operator-only step, tell Claude so it can update memory
immediately.** There are two: the sheet in Task 7 and the deploy approval in
Task 14.

**Goal:** A token stops at 365 credited days. The credit that takes it there
gives it a finishing PLACE and, by that place, one of five Marks -- Apex (1st),
Atrium (2nd-4th), Valve (5th-14th), Chamber (15th-64th), Aorta (65th on) --
and its number is written round the border in that Mark's ink.

**Architecture:** Everything that decides a place happens ON CHAIN, inside the
same `batchCheckIn` transaction that credits the 365th day: a counter, a fixed
place-to-Mark table, one write into the existing `_marks` word. No agent asks
for a finisher Mark and the Warden reserves nothing, so the cap-reservation
machinery the spec's section 7 feared is not needed at all. The renderer picks
the band's ink from the Mark held, freezes a finished token's colour, and caps
its own rings at one. The Warden stops accepting check-ins for a finished
token, orders each day's batch by token id, and records the place from a new
event.

**Tech Stack:** Solidity 0.8.30 (Foundry 1.7.1, via_ir), Node 24 (Warden,
Clock, the JS reference renderer and its fixture generators).

**Spec:** `docs/specs/2026-09-20-mro-finisher-marks-design.md`. Section **10l**
is the latest decision and wins wherever an older section disagrees. Section
**10f** (stop at 365, one ring) is built here too. The design choices made on
2026-09-23 that the spec does not yet carry are listed below and must be
written into it in Task 13.

---

## Why this exists, and what it unblocks

The piece promises agents a year. Until now nothing happened at the end of it:
a token kept counting, kept growing rings, and nothing marked who got there
first. The operator decided on 2026-09-23 that the year is a RACE with a visible
prize for being first, and chose the look (the finisher's number, coloured by
place) and the names. This build is the last piece of contract work before the
mainnet mint of token #1, and it has to land before that mint: the contract is
permanent, and "nothing is limited" becomes a promise to a real holder the day
token 1 exists.

It ends in a new Base Sepolia deployment, because the contract changes.

## Decided on 2026-09-23, and NOT yet in the spec

| Decision | What it replaces |
|---|---|
| **The Mark is ASSIGNED at 365, not claimed.** The credit that takes `level` to 365 increments a counter; the counter value is the place; the place picks the Mark. | Spec sections 4, 6 and 7: an agent claiming a Mark over MCP, with the Warden reserving caps (`sold + reserved`). None of that is built. |
| **Place is FINISHING order, ties within a day by lowest token id.** The Clock sorts each batch by `(day, tokenId)`. | Spec section 5's "claim order" -- there is no separate claim any more, so the two orders cannot disagree. |
| **Stop-at-365 (10f) is in this build.** A credit to a token already at 365 reverts. | 10f was decided on 2026-09-20 and never built. |
| **The tier boundaries are CONSTANTS in the token contract**, not dials. | Section 4's "they are dials (`setUpgrade`)". A place-to-Mark table the owner could edit after finishers exist is a promise that can be broken; the constants cannot be. The `Upgrade` records for 11-15 still carry the caps, for readers, and a test pins them to the constants. |
| **`applyMark` refuses ids 11-15 outright.** | Nothing -- today `applyMark` would accept them once `setUpgrade` activates them. |

## What this deliberately does NOT build

- **Nothing about the digit band's GEOMETRY.** It is built and signed off
  (2026-09-22). Only its ink changes.
- **No change to pairs 1-5.** No finisher Mark excludes anything in them and
  nothing in them excludes a finisher Mark.
- **No drawn Mark other than the ink.** Colour on the ring and five ring styles
  were both rejected; the number in its ink IS the Mark.
- **The OpenSea check, the treasury, the mainnet mint.** Operator items,
  unchanged.

## Global Constraints

- Plain ASCII only in every doc and code comment. No em dashes, smart quotes,
  arrows or emoji.
- `/bin/grep`, never bare `grep`.
- Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`.
- Any sweep that renders or decodes images runs through
  `~/scripts/safe-build.sh`.
- **All four suites green before EVERY commit:** `cd contracts && forge test`,
  and `npm test` in `tools/`, `warden/` and `client/`. Never pipe a gate.
- **The Solidity renderer and `tools/render-token.mjs` move together.**
  `RenderMatrix.t.sol` diffs them byte for byte. A change to one without the
  other is a red suite, not a follow-up.
- **`Ladder.sol` and `warden/src/mcp/ladder.mjs` move together.** The hash in
  `Ladder.t.sol` is regenerated with `node tools/ladder-fixture.mjs`, never
  hand-typed.
- **`docs/2026-09-01-mro-raw-protocol.md` and
  `skills/machine-readable-only/references/raw-protocol.md` are byte-identical.**
  Edit the first, then `cp` it over the second. Never hand-patch the copy.
- Every contract must be proven deployable: `forge build --sizes` with positive
  runtime margin under 24,576 bytes AND a strict-limit anvil deploy
  (`bash contracts/script/anvil-size-check.sh`) with non-empty `cast code`.
- **Measure, never estimate.** Gas and byte figures come from running
  `RealTokenGas.t.sol` and `GasBudget.t.sol -vv` and reading the output. The
  limits are 4,000,000 gas and 24,000 bytes; the real external ceiling is
  30,000 bytes (Alchemy).
- The repository is PUBLIC. No absolute local path, session id or personal
  identifier in any tracked file.
- Commit messages carry no AI attribution.

## The inks and names, in one place

| Id | Name | Places | Cap | Ink | Constant |
|---|---|---|---|---|---|
| 15 | apex | 1st | 1 | `#b8860b` | `APEX_GOLD` (same value as `VESSEL_GOLD`) |
| 14 | atrium | 2nd-4th | 3 | `#8c9096` | `ATRIUM_SILVER` |
| 13 | valve | 5th-14th | 10 | `#a0612b` | `VALVE_BRONZE` |
| 12 | chamber | 15th-64th | 50 | `#2000ff` | `CHAMBER_BLUE` (same value as `BEAT_TO`) |
| 11 | aorta | 65th on | none | `#c8102e` | `AORTA_RED` (the heart's red, the top tier colour) |

Names are lower case in the metadata, matching the existing ten. Every ink is
seven characters, so which one a token wears never changes its byte count.

## File Structure

| File | Change |
|---|---|
| `contracts/src/MachineReadableOnly.sol` | `AlreadyFinished`, `FINISH_LEVEL`, `finishers` counter, `_finish`, `finisherMark`, the `Finished` event, `applyMark` refusing 11-15, `_credit` taking the id |
| `contracts/src/Ladder.sol` | `Upgrade[16]`; entries 11-15 via a new `_finisher(cap)` helper |
| `contracts/script/DeployPlan5.s.sol`, `contracts/script/fast/DeployFast.s.sol` | write ids 1-15 |
| `contracts/src/render/MarkRenderer.sol` | five bit constants, five inks, `finisherInk`, names to 15 |
| `contracts/src/render/Renderer.sol` | band ink from `finisherInk`; `Finisher` trait; finished token's colour frozen |
| `contracts/src/render/FrameRenderer.sol` | own rings cap at one |
| `tools/render-token.mjs` | the same four renderer changes, mirrored |
| `tools/ladder-fixture.mjs` | tuple `[16]`, loop to 15 |
| `warden/src/mcp/ladder.mjs` | entries 11-15 with `route: "finisher"`; boot check allows exactly those caps |
| `warden/src/mcp/tools/upgrade.mjs`, `warden/src/mcp/tools/ladder.mjs` | never offer 11-15 for sale |
| `warden/src/mcp/tools/checkin.mjs`, `warden/src/mcp/gates.mjs` | refuse a finished token, `year-complete` |
| `warden/src/mcp/nextSteps.mjs`, `skills/machine-readable-only/references/refusals.md` | answer `year-complete` |
| `warden/src/clock/batch.mjs` | sort each chunk by `(day, tokenId)`; `AlreadyFinished` is an entry error |
| `warden/src/clock/reconcile.mjs`, `warden/src/mirror/db.mjs`, `warden/src/mirror/schema.sql`, `warden/src/mirror/queries.mjs` | `Finished` event -> `tokens.finisher` column plus the Mark bit |
| `warden/src/clock/abi.mjs` | the new error and event (regenerate from the build) |
| `warden/src/mcp/tokenView.mjs` | `finisher: { place, mark }`; `years` gone |
| `warden/tools/read-ladder.mjs` | verify ids 1-15 |
| `warden/public/llms.txt`, `skills/machine-readable-only/SKILL.md`, the raw protocol and its copy, `warden/public/door.html` | the year ends; the race; the five Marks; "nothing is limited" rewritten |
| `docs/specs/2026-09-20-mro-finisher-marks-design.md` | a section 10m recording the 2026-09-23 build decisions |

---

# PHASE A -- THE CONTRACT

## Task 1: A token stops at 365

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol` (`_credit` at about line 479, its two callers at about 566 and 653)
- Test: `contracts/test/FinishLine.t.sol` (new)

**Interfaces:**
- Produces: `error AlreadyFinished(uint256 id)`; `uint32 internal constant FINISH_LEVEL = 365`; `_credit(uint256 id, Token storage s, uint32 day)`.

- [ ] **Step 1: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice A token's year ends at 365 credited days, and the credit that ends
/// it gives the token its finishing place. Spec sections 10f and 10l.
contract FinishLineTest is MroTestBase {
    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), _today());
    }

    function test_aCreditPast365Reverts() public {
        _makeWhole(1);
        uint32 next = t.viewOf(1).lastDay + 1;
        _warpToDay(next);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.AlreadyFinished.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(next));
    }

    function test_level364StillCredits() public {
        _growTo(1, 364);
        assertEq(t.viewOf(1).level, 364);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd contracts && forge test --match-path test/FinishLine.t.sol -vv`
Expected: FAIL -- `AlreadyFinished` is not a member of `MachineReadableOnly`.

- [ ] **Step 3: Implement**

Add beside the other check-in errors (`DayNotAdvanced`, `FutureDay`):

```solidity
    /// A credit to a token whose year is already complete. The piece records a
    /// year, and a finished token's record is final -- the same freeze `rest`
    /// gives, reached by completion rather than by the owner. Spec 10f.
    error AlreadyFinished(uint256 id);

    /// @dev The day a token's year is complete. Equal to FrameGeometry.DAY_CELLS
    /// in the renderer; a test pins the two together.
    uint32 internal constant FINISH_LEVEL = 365;
```

Change `_credit` to take the id and refuse a finished token first:

```solidity
    function _credit(uint256 id, Token storage s, uint32 day) private {
        // THE YEAR ENDS. Refused here, in the one function both check-in paths
        // share, so the voucher path cannot become a way round it.
        if (s.level >= FINISH_LEVEL) revert AlreadyFinished(id);
        uint32 run;
        // ... the existing body, unchanged ...
    }
```

Update both call sites to `_credit(id, s, day);`.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd contracts && forge test --match-path test/FinishLine.t.sol -vv`
Expected: PASS, 2 tests.

- [ ] **Step 5: Do NOT commit yet.** The full suite is red until Task 3 fixes the tests that credit past 365. Tasks 1-3 commit together.

## Task 2: The credit that reaches 365 assigns the place and the Mark

**Files:**
- Modify: `contracts/src/MachineReadableOnly.sol`, `contracts/src/Ladder.sol`, `contracts/script/DeployPlan5.s.sol:31-32`, `contracts/script/fast/DeployFast.s.sol:25-26`
- Test: `contracts/test/FinishLine.t.sol`

**Interfaces:**
- Consumes: `_credit(uint256, Token storage, uint32)` from Task 1.
- Produces: `uint32 public finishers`; `event Finished(uint256 indexed id, uint32 ordinal, uint8 indexed markId)`; `error MarkNotRequestable(uint8 upgradeId)`; `function finisherMark(uint32 ordinal) public pure returns (uint8)`; `Ladder.all()` returning `Upgrade[16]`.

- [ ] **Step 1: Write the failing tests** (append to `FinishLineTest`)

```solidity
    uint256 internal constant ORDINAL_SHIFT = 64;

    /// @dev Mint `n` more tokens (ids 2..n+1) under fresh keys, all on today.
    function _mintMore(uint32 n) internal {
        for (uint32 i = 2; i <= n + 1; i++) {
            vm.prank(WARDEN);
            t.mint(i, ALICE, keccak256(abi.encode("key", i)), _code(), _today());
        }
    }

    function test_theFirstFinisherIsApexAndNumberOne() public {
        _makeWhole(1);
        uint256 m = t.marksOf(1);
        assertTrue(m & (1 << 15) != 0, "apex bit");
        assertEq(uint32(m >> ORDINAL_SHIFT), 1, "place 1");
        assertEq(t.finishers(), 1);
        assertEq(t.upgradeOf(15).sold, 1);
    }

    /// @dev The table, at every boundary, written out as literals so it cannot
    /// share a mistake with the function it checks.
    function test_placeToMarkBoundaries() public view {
        uint32[10] memory place = [uint32(1), 2, 4, 5, 14, 15, 64, 65, 1000, 65535];
        uint8[10] memory mark = [uint8(15), 14, 14, 13, 13, 12, 12, 11, 11, 11];
        for (uint256 i; i < 10; i++) assertEq(t.finisherMark(place[i]), mark[i]);
    }

    /// @dev Same-day finishers take places in the order the batch lists them.
    /// The Warden sorts by token id; the contract only has to honour order.
    function test_sameBatchPlacesFollowBatchOrder() public {
        _mintMore(1);
        _growTo(1, 364);
        _growTo(2, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        uint32[] memory ids = new uint32[](2);
        ids[0] = 1; ids[1] = 2;
        uint32[] memory ds = new uint32[](2);
        ds[0] = d; ds[1] = d;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds);
        assertEq(uint32(t.marksOf(1) >> ORDINAL_SHIFT), 1);
        assertEq(uint32(t.marksOf(2) >> ORDINAL_SHIFT), 2);
        assertTrue(t.marksOf(2) & (1 << 14) != 0, "second place is atrium");
    }

    function test_finishingEmitsFinished() public {
        _growTo(1, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.Finished(1, 1, 15);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d));
    }

    function test_applyMarkRefusesEveryFinisherId() public {
        _makeWhole(1);
        for (uint8 id = 11; id <= 15; id++) {
            vm.prank(WARDEN);
            vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkNotRequestable.selector, id));
            t.applyMark(1, id, 0);
        }
    }

    /// @dev The Upgrade records are for readers; the constants decide. They
    /// must agree, or an agent reading `upgradeOf` is told a cap that is false.
    function test_ladderCapsMatchThePlaceTable() public pure {
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        assertEq(u[15].maxSupply, 1);
        assertEq(u[14].maxSupply, 3);
        assertEq(u[13].maxSupply, 10);
        assertEq(u[12].maxSupply, 50);
        assertEq(u[11].maxSupply, 0);
    }

    /// @dev Bits 32-63 are the earned Iris's run. Finishing must not touch them.
    function test_finishingLeavesTheIrisRunAlone() public {
        _growTo(1, 364);
        vm.prank(WARDEN);
        t.applyMark(1, 6, 0); // earned Iris at run 364 -- _growTo credits consecutive days
        uint256 before = t.marksOf(1);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d));
        assertEq((t.marksOf(1) >> 32) & 0xFFFFFFFF, (before >> 32) & 0xFFFFFFFF);
    }
```

(Import `Ladder` at the top of the file.)

- [ ] **Step 2: Run and watch them fail**

Run: `cd contracts && forge test --match-path test/FinishLine.t.sol -vv`
Expected: FAIL to compile -- `finishers`, `Finished`, `MarkNotRequestable`, `finisherMark`, `Upgrade[16]` do not exist.

- [ ] **Step 3: Implement in `MachineReadableOnly.sol`**

State, beside `lastWardenDay`:

```solidity
    /// @notice How many tokens have finished their year. The next finisher's
    /// place is this plus one.
    uint32 public finishers;
```

Events and errors, beside `MarkApplied`:

```solidity
    /// @dev The one record of a place. Not MarkApplied: nobody applied this,
    /// the year's end did, and the Clock reads the place from here.
    event Finished(uint256 indexed id, uint32 ordinal, uint8 indexed markId);
    /// Ids 11-15 are given by finishing and can never be asked for.
    error MarkNotRequestable(uint8 upgradeId);
```

In `applyMark`, directly after the `MarkIdOutOfRange` check:

```solidity
        if (upgradeId >= FIRST_FINISHER_MARK) revert MarkNotRequestable(upgradeId);
```

with `uint8 internal constant FIRST_FINISHER_MARK = 11;` beside `MAX_MARK_ID`.

The table and the write:

```solidity
    /// @notice Which Mark a finishing place earns.
    /// @dev CONSTANTS, deliberately not dials. The operator set these caps on
    /// 2026-09-23 as a race with a prize for being first; a table the owner
    /// could edit after finishers exist is a promise that can be broken. The
    /// Upgrade records for 11-15 repeat the caps for readers, and
    /// FinishLine.t.sol pins the two together.
    ///   1st          15 apex
    ///   2nd-4th      14 atrium
    ///   5th-14th     13 valve
    ///   15th-64th    12 chamber
    ///   65th on      11 aorta, never refused
    function finisherMark(uint32 ordinal) public pure returns (uint8) {
        if (ordinal <= 1) return 15;
        if (ordinal <= 4) return 14;
        if (ordinal <= 14) return 13;
        if (ordinal <= 64) return 12;
        return 11;
    }

    /// @dev Called once in a token's life, by the credit that makes it whole.
    /// The place is the ORDER finishes are credited in: across days by day, and
    /// within one batch by the order the Warden listed them -- which it sorts
    /// by token id (warden/src/clock/batch.mjs). The ordinal lands in bits
    /// 64-95 of the marks word, the slot TokenView.sol reserves for it; bits
    /// 32-63 are the earned Iris's run and are never touched here.
    function _finish(uint256 id) private {
        uint32 ordinal;
        unchecked { ordinal = ++finishers; }
        uint8 markId = finisherMark(ordinal);
        _marks[id] |= (uint256(1) << markId) | (uint256(ordinal) << 64);
        unchecked { _upgrades[markId].sold += 1; }
        emit Finished(id, ordinal, markId);
    }
```

At the end of `_credit`, after `s.lastDay = day;`:

```solidity
        if (s.level == FINISH_LEVEL) _finish(id);
```

Update the `MAX_MARK_ID` comment: ids 11-15 are now the five finisher Marks,
written by the deploy and given only by `_finish`.

- [ ] **Step 4: Implement in `Ladder.sol`**

Return `MachineReadableOnly.Upgrade[16] memory u`, add after `u[10]`:

```solidity
        // The five finisher Marks. GIVEN at 365 by the token contract's own
        // place table, never applied -- applyMark refuses these ids. The caps
        // here are for readers of upgradeOf and are pinned to that table.
        u[11] = _finisher(0);   // Aorta,   65th on, never refused
        u[12] = _finisher(50);  // Chamber, 15th-64th
        u[13] = _finisher(10);  // Valve,   5th-14th
        u[14] = _finisher(3);   // Atrium,  2nd-4th
        u[15] = _finisher(1);   // Apex,    1st
```

and the helper:

```solidity
    /// @dev A finisher Mark: free, whole-only, and excluding the other four,
    /// because a token finishes once. The mask is built from the group, minus
    /// the Mark's own bit, which setUpgrade refuses.
    function _finisher(uint32 cap) private pure returns (MachineReadableOnly.Upgrade memory) {
        return MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: cap, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: true,
            active: true, excludes: 0, requiresAny: 0
        });
    }
```

then, after the five assignments, set each one's exclusion to the other four:

```solidity
        uint16 group = uint16((1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15));
        for (uint8 i = 11; i <= 15; i++) u[i].excludes = group & ~uint16(1 << i);
```

Update the library header: "Nothing is limited" is no longer true of 11-15;
say what is.

- [ ] **Step 5: The deploy writes 15 entries**

In `DeployPlan5.s.sol` and `fast/DeployFast.s.sol`:

```solidity
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        for (uint8 i = 1; i <= 15; i++) t.setUpgrade(i, u[i]);
```

- [ ] **Step 6: Run the new tests**

Run: `cd contracts && forge test --match-path test/FinishLine.t.sol -vv`
Expected: PASS, 9 tests.

- [ ] **Step 7: Break the wiring and watch it fail.** Copy the contract to the
scratchpad, delete the `if (s.level == FINISH_LEVEL) _finish(id);` line, run
the file: `test_theFirstFinisherIsApexAndNumberOne` and three others must go
red. Restore from the COPY, never `git checkout --`, and re-run to green.

## Task 3: The tests that assumed a token could go past 365

**Files:** the ones the survey found. Each is either REWRITTEN to reach its
state without crediting past 365, or its assertion is widened to allow the
finisher bits it now legitimately carries. None is deleted without saying
which property it protected and where that property is now tested.

- `contracts/test/Lineage.t.sol:65,77` -- `_growTo(1, 500)`. The seed budget is
  keyed by ELAPSED time, not level, so replace with `_makeWhole(1)` then
  `_warpToDay(...)` to the day the test needs.
- `contracts/test/Ladder.t.sol`: every `Upgrade[11]` becomes `Upgrade[16]`;
  the pair loops stay `1..10` and say so; `test_nothingIsLimited` and `_row`
  assert `maxSupply == 0` for 1-10 only; `test_everyMarkIsPricedOrEarnedAndNeverBoth`
  counts 1-10; the assertions at 141/150/162/171 mask `0x07FE` (bits 1-10)
  instead of `0xFFFE`; the "five Marks at once" test at 262-274 adds the one
  finisher Mark the token now holds. Regenerate the pinned hash in Task 4.
- `contracts/test/MroTestBase.sol`: `_makeWhole` now also gives place 1 to the
  first token made whole in a test. Add a one-line comment saying so.
- `contracts/test/FrameRenderer.t.sol:146-158,230`, `GasBudget.t.sol:302-338`,
  `GasProfile.t.sol:250-251`, `CodeRenderer.t.sol:410`,
  `IntrinsicSize.t.sol:80`: these build a `TokenView` directly and are fixed in
  Task 5, where the ring cap changes.
- `contracts/test/BuilderCodeSuffix.t.sol:80`: check it does not credit past
  365; it only warps.

- [ ] **Step 1:** `cd contracts && forge test 2>&1 | tail -40` and list every failure.
- [ ] **Step 2:** fix each as above. For anything not on the list, work out why before changing it.
- [ ] **Step 3:** `forge test` -- everything green except tests whose expectations depend on Task 4's hash or Task 5's rings. List those by name in the commit message.

(No commit here: Task 4 finishes the ladder mirror and the three commit together.)

## Task 4: The Warden's ladder mirror, so the hash agrees

**Files:**
- Modify: `warden/src/mcp/ladder.mjs`, `tools/ladder-fixture.mjs:18-20,34`, `contracts/test/Ladder.t.sol:224` (the regenerated literal), `warden/tools/read-ladder.mjs:39-52`
- Test: `warden/test/ladder.test.mjs`, `tools/test/ladder-fixture.test.mjs`

**Interfaces:**
- Produces: `LADDER[11..15]` with `route: "finisher"`, `supply` 0-cap mapped as `Infinity` for 11 and the numbers for 12-15; `FINISHER_IDS = [11, 12, 13, 14, 15]`.

- [ ] **Step 1: Write the failing tests** in `warden/test/ladder.test.mjs`

```js
test("the five finisher Marks are given, never sold", () => {
  for (const id of [11, 12, 13, 14, 15]) {
    assert.equal(LADDER[id].route, "finisher");
    assert.equal(LADDER[id].priceUsdc6, 0);
    assert.equal(LADDER[id].needsWhole, true);
  }
  assert.deepEqual([11, 12, 13, 14, 15].map(id => LADDER[id].name),
    ["aorta", "chamber", "valve", "atrium", "apex"]);
  assert.deepEqual([11, 12, 13, 14, 15].map(id => LADDER[id].supply),
    [Infinity, 50, 10, 3, 1]);
});

test("a cap on anything but a finisher Mark is still a startup error", () => {
  const bad = structuredClone(LADDER);
  bad[3] = { ...bad[3], supply: 5 };
  assert.throws(() => assertLadderSane(bad), /limited/);
});
```

Replace `test("nothing is limited")` with the same assertion over ids 1-10 only.

- [ ] **Step 2: Run and watch them fail** -- `cd warden && node --test test/ladder.test.mjs`. Expected: FAIL, `LADDER[11]` undefined.

- [ ] **Step 3: Implement**

In `ladder.mjs`, a third factory and five entries:

```js
// A finisher Mark: given by the token contract at 365, in finishing order,
// and never sold or requested. The cap is the size of the place band --
// MachineReadableOnly.finisherMark() is the authority, and Ladder.sol repeats
// it. The other four finisher Marks are excluded, because a token finishes once.
const FINISHERS = (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15);
const finisher = (id, name, supply) => ({
  id, name, pair: 0, route: "finisher", price: undefined, priceUsdc6: 0,
  minLevel: 0, minStreak: 0, needsWhole: true, variants: 1,
  excludes: FINISHERS & ~(1 << id), requiresAny: 0, supply,
});
export const FINISHER_IDS = [11, 12, 13, 14, 15];
```

Match the existing factories' exact field set (read `bought`/`earned` first; if
they carry a field not listed here, add it with the value a free Mark has).
Add to `LADDER`:

```js
  11: finisher(11, "aorta", Infinity),
  12: finisher(12, "chamber", 50),
  13: finisher(13, "valve", 10),
  14: finisher(14, "atrium", 3),
  15: finisher(15, "apex", 1),
```

In `assertLadderSane`, let a finisher Mark through the price/earned check and
the supply check, and keep both checks exactly as they are for everything else:

```js
    if (m.route === "finisher") {
      if (m.priceUsdc6 !== 0 || m.price !== undefined) throw new Error(`mark ${id} is a finisher Mark and priced`);
      continue;
    }
```

(as the first statement in the loop body). Update the header comment: nothing
in pairs 1-5 is limited; the finisher Marks are, by place.

`ladderSentence` ends "Pairs are 1-2, 3-4, 5-6, 7-8, 9-10"; add " Marks 11-15
are given by finishing and cannot be requested." and update the pinned string
in `warden/test/mcp.test.mjs:316-334`.

In `tools/ladder-fixture.mjs`: the tuple becomes `[16]` and the loop runs to 15.
A finisher's `supply === Infinity ? 0 : supply` already maps Aorta to 0.

In `warden/tools/read-ladder.mjs`: loop to 15, and add the five expected rows.

- [ ] **Step 4: Regenerate the pinned hash**: `node tools/ladder-fixture.mjs`, paste the printed literal into `Ladder.t.sol` in place of the old one (there must still be exactly one 64-hex literal in that file).

- [ ] **Step 5: All four suites** -- expect green apart from any renderer-fixture tests listed in Task 3. If anything else is red, fix it before committing.

- [ ] **Step 6: Commit Tasks 1-4 together**

```bash
git add contracts/ tools/ladder-fixture.mjs warden/src/mcp/ladder.mjs warden/test/ warden/tools/read-ladder.mjs
git commit -m "feat(contract): a token finishes at 365 and is given its place"
```

**PHASE A CHECK-IN with the operator:** what was built, the test count, and any
test whose meaning changed.

---

# PHASE B -- THE PICTURE

## Task 5: A finished token keeps one ring and stops fading

**Files:**
- Modify: `contracts/src/render/FrameRenderer.sol:40-80`, `contracts/src/render/Renderer.sol` (`_rung`, `_absence`), `tools/render-token.mjs` (`ringBudget`, `rungFor`, `absenceOf`, and the calls that pass them state)
- Test: `contracts/test/FrameRenderer.t.sol`, `contracts/test/Renderer.t.sol`, `tools/test/render-token.test.mjs`

**Interfaces:**
- Produces: `ringBudget(level, echo)` returning `own <= 1`; `rungFor({..., whole})`, `absenceOf({..., whole})` in JS.

- [ ] **Step 1: Write the failing tests**

In `FrameRenderer.t.sol`, replace the `MAX_RINGS` block at 146-158 with:

```solidity
    /// @dev Spec 10f: a token finishes at 365 and keeps ONE ring of its own.
    function test_ownRingsCapAtOne() public pure {
        assertEq(FrameRenderer.rings(364, 0), 0);
        assertEq(FrameRenderer.rings(365, 0), 1);
        assertEq(FrameRenderer.rings(365 * 10, 0), 1, "a level the chain can no longer reach still draws one");
        assertEq(FrameRenderer.rings(365, 1), 2, "own ring plus the echo ring");
        assertEq(FrameRenderer.rings(1, 400), 1, "a young child: the echo ring only");
    }
```

In `Renderer.t.sol` (use whatever state-building helper that file already uses):

```solidity
    /// @dev A finished token's colour is the one it finished with, however long
    /// the calendar runs. Without this, a token that finished and then stopped
    /// checking in -- which is now the ONLY thing it can do -- would fade.
    function test_aFinishedTokenDoesNotFade() public pure {
        TokenView memory v = _state(); // existing helper; set the fields below
        v.level = 365; v.streak = 365; v.lastDay = 20_000; v.today = 20_000;
        string memory atFinish = renderer.svg(v);
        v.today = 20_400;
        assertEq(renderer.svg(v), atFinish);
    }
```

In `tools/test/render-token.test.mjs`, the same two properties against the JS
functions (`ringBudget(10, 0).own === 1`; `rungFor` and `absenceOf` unchanged
by `today` when `whole: true`).

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement, both languages**

`FrameRenderer.ringBudget`:

```solidity
        echoRings = echo > 0 ? 1 : 0;
        // Spec 10f: a year ends at 365, so a token has at most ONE ring of its
        // own. The chain can no longer produce a level past 365; the cap is
        // here as well so a swapped renderer can never draw what cannot exist.
        own = level >= FrameGeometry.DAY_CELLS ? 1 : 0;
```

Delete `MAX_RINGS` and rewrite the comments that explain the ten-ring cap to
say what replaced it. Same in `tools/render-token.mjs`
(`ringBudget = (years, echoDays = 0) => ({ own: Math.min(years, 1), echoRings: echoDays > 0 ? 1 : 0 })`).

`Renderer._absence` and `_rung`:

```solidity
    function _absence(TokenView memory v) private pure returns (uint256) {
        // A finished token's record is final: nothing it does not do can count
        // against it. Spec 10f.
        if (v.resting || v.level >= FrameGeometry.DAY_CELLS) return 0;
        // ... unchanged ...
    }

    function _rung(TokenView memory v) private pure returns (uint256) {
        if (v.resting) return Palette.tierIndex(v.streak);
        bool whole = v.level >= FrameGeometry.DAY_CELLS;
        // A sunset before the year ended seals it at the piece's last day.
        if (v.sunset && !whole) return Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay);
        // A FINISHED token is read on the day it finished, forever: the same
        // rules as a live one, with the clock stopped at its last credited day.
        uint32 at = whole ? v.lastDay : v.today;
        uint256 live = Palette.lapsedIndex(v.streak, v.lastDay, at);
        if (v.fellRun == 0) return live;
        uint256 fell = Palette.lapsedIndex(v.fellRun, v.fellDay, at);
        // ... the existing cap, unchanged ...
    }
```

JS: `absenceOf` and `rungFor` take `whole = false` and apply the same two
rules; `renderSvg` passes `whole: level >= DAY_CELLS`.

- [ ] **Step 4: Fix the tests that built multi-year tokens**: `GasBudget.t.sol:302-338`, `GasProfile.t.sol:250-251`, `CodeRenderer.t.sol:410`, `IntrinsicSize.t.sol:80`, `tools/state-matrix.mjs:30,58-68,243,250`, `tools/echo-ring-fixture.mjs:32`. A stage that no longer exists ("ten years, at the cap") is REMOVED from the sweep and the removal named in the commit; the byte and gas worst cases are re-measured in Task 7, not carried over.

- [ ] **Step 5: Regenerate every golden and fixture whose test now fails** by running its generator (`node tools/<name>-fixture.mjs`), never by hand-editing a hash. The generators are `render-fixture`, `token-uri-fixture`, `combination-fixture`, `echo-ring-fixture`, `frame-path-fixture`, `colour-fixture`. Run each generator's own test afterwards.

- [ ] **Step 6: All four suites green, then commit**: `feat(render): a finished token keeps one ring and stops fading`.

## Task 6: The number is written in its Mark's ink, and the place is a trait

**Files:**
- Modify: `contracts/src/render/MarkRenderer.sol`, `contracts/src/render/Renderer.sol` (`_digitGroup` at 304-308, `_attrsA` at 430-441), `contracts/src/render/DigitBand.sol` (the `INK` comment), `tools/render-token.mjs`
- Test: `contracts/test/MarkRenderer.t.sol`, `contracts/test/DigitBandRender.t.sol`, `tools/test/render-token.test.mjs`

**Interfaces:**
- Produces: `MarkRenderer.finisherInk(uint256 marks) returns (string memory)`; `MarkRenderer.names` covering ids 1-15; JS `finisherInk(ids)`, `MARKS` of length 15.

- [ ] **Step 1: Write the failing tests**

```solidity
    function test_eachFinisherMarkHasItsInk() public pure {
        assertEq(MarkRenderer.finisherInk(1 << 15), "#b8860b");
        assertEq(MarkRenderer.finisherInk(1 << 14), "#8c9096");
        assertEq(MarkRenderer.finisherInk(1 << 13), "#a0612b");
        assertEq(MarkRenderer.finisherInk(1 << 12), "#2000ff");
        assertEq(MarkRenderer.finisherInk(1 << 11), "#c8102e");
        // An ordinal with no finisher bit cannot exist on chain; the spike's
        // setMarks can write one, and it keeps the near-black it always had.
        assertEq(MarkRenderer.finisherInk(0), "#2f2f2f");
    }

    function test_finisherNamesReachTheMetadata() public pure {
        assertEq(MarkRenderer.names((1 << 7) | (1 << 15)), '["vessel","apex"]');
        assertEq(MarkRenderer.names(1 << 11), '["aorta"]');
    }
```

and a `tokenURI` test that a token with ordinal 42 carries
`{"trait_type":"Finisher","value":42}` and a token with none carries value 0.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement, both languages**

`MarkRenderer`: constants `AORTA = 1 << 11` ... `APEX = 1 << 15`, the five ink
strings from the table at the top of this plan, and:

```solidity
    /// @notice The ink the finisher's number is written in: the Mark IS the ink.
    /// @dev Decided by the operator 2026-09-23 (spec 10l). Gold, silver, bronze
    /// are a ranking every viewer already reads; blue and the heart's red finish
    /// the five. Seven characters each, so the byte count never depends on
    /// which. Checked highest place first, though a token only ever holds one.
    function finisherInk(uint256 marks) internal pure returns (string memory) {
        if (has(marks, APEX)) return APEX_GOLD;
        if (has(marks, ATRIUM)) return ATRIUM_SILVER;
        if (has(marks, VALVE)) return VALVE_BRONZE;
        if (has(marks, CHAMBER)) return CHAMBER_BLUE;
        if (has(marks, AORTA)) return AORTA_RED;
        return DigitBand.INK;
    }
```

`names`: `string[15]` with `"apex"` last, loop `i < 15`. Update its comment:
bits outside 1-15 are ignored.

`Renderer._digitGroup`: pass `MarkRenderer.finisherInk(v.marks)` instead of
`DigitBand.INK`. Rewrite `DigitBand.INK`'s comment: it is now only the ink of a
state the chain cannot produce, and the reason the band has five inks.

`Renderer._attrsA`: add `_num("Finisher", MarkRenderer.ordinal(v.marks)),`
immediately after the `Whole` line. It goes in `_attrsA`, not `_attrsB`,
because `_attrsB` is already at the stack limit under the coverage profile.

JS: `MARKS` gains `"aorta","chamber","valve","atrium","apex"`; `finisherInk(ids)`
with the same order; `renderSvg` uses it for the band; `tokenUri` emits
`Finisher` in the same position. Export the five ink constants with the same
names and a `MUST match MarkRenderer` comment.

- [ ] **Step 4: Regenerate fixtures** as in Task 5 Step 5. `tools/state-matrix.mjs:172` already iterates ordinals `[1, 42, 365, 0xaaaa, 0xffff]`; give each of those states the Mark its place earns (`finisherMark` mirrored in JS as a five-line function beside `finisherInk`), so the matrix exercises all five inks.

- [ ] **Step 5: All four suites green, then commit**: `feat(render): the finisher's number is written in its Mark's ink`.

## Task 7: Measure it, prove it deploys, prove it decodes, and show the operator

- [ ] **Step 1: Gas and bytes.** `cd contracts && forge test --match-path test/RealTokenGas.t.sol -vv` and `forge test --match-path test/GasBudget.t.sol -vv`. Record the dearest token's gas and the largest token's bytes, and both headrooms against 4,000,000 / 24,000. The 1M / 5 KB target is reported as MISSED. Expect both worst cases to FALL (no ring-cap children any more); if either rises, stop and find out why.
- [ ] **Step 2: Check-in gas.** The finishing credit writes three extra slots. Read the per-token cost of an ordinary credit and of a finishing credit from `GasProfile.t.sol`; add a case for the finishing credit if none exists. Report both.
- [ ] **Step 3: Deployability.** `forge build --sizes` (positive margin for both contracts), then `bash contracts/script/anvil-size-check.sh`.
- [ ] **Step 4: Decode.** Extend `tools/finisher-band-sheet.mjs` so its cases are one per Mark (places 1, 3, 9, 42, 365 with their Marks) plus the unbanded control, and run it through `~/scripts/safe-build.sh`. Every tile must decode at 256, 848 and 1600 px to its own url. A failure is a blocker.
- [ ] **Step 5: The operator's sheet -- OPERATOR ONLY.** Send ONE image: the five finished tokens in a row, labelled with place, Mark name and ink, and say what to look at (the colour of the number). The operator confirms it before Phase C.

**PHASE B CHECK-IN with the operator:** the measured figures and the sheet.

---

# PHASE C -- THE WARDEN AND THE CLOCK

## Task 8: The door refuses a finished token

**Files:**
- Modify: `warden/src/mcp/tools/checkin.mjs` (beside the `already-credited-today` guard at about line 98), `warden/src/mcp/gates.mjs`, `warden/src/mcp/nextSteps.mjs`, `skills/machine-readable-only/references/refusals.md`, `warden/test/chain-stub.mjs:73`, `warden/test/gates.test.mjs:269`
- Test: `warden/test/checkin.test.mjs` (or whichever file holds the `already-credited-today` test -- put it beside that one)

**Interfaces:**
- Produces: reason string `"year-complete"`; `yearCompleteBlock(chain, tokenId)` in `gates.mjs`.

- [ ] **Step 1: Write the failing tests**

```js
test("a finished token is told its year is complete, and nothing is queued", async () => {
  const { tool, q } = await setupWithToken({ level: 365 }); // use the file's existing fixture helper
  const res = await tool.call({ tokenId: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "year-complete");
  assert.equal(q.pendingCredits(99_999).length, 0);
});

test("the credit that makes 365 is still accepted", async () => {
  const { tool } = await setupWithToken({ level: 364 });
  const res = await tool.call({ tokenId: 1 });
  assert.equal(res.ok, true);
});
```

and in `gates.test.mjs`, `yearCompleteBlock` blocks at chain level 365 and not at 364.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

In `checkin.mjs`, immediately before the `already-credited-today` check:

```js
  // THE YEAR IS OVER. The mirror's level already counts the credit that made
  // it 365 (it is incremented when a check-in is queued), so `>= 365` here is
  // exactly "a 365th credit already exists" -- the one this refuses is the
  // 366th, which the chain would revert with AlreadyFinished.
  if (token.level >= 365) {
    return { ok: false, accepted: false, reason: "year-complete",
             tokenId, heart: "365/365" };
  }
```

In `gates.mjs`, a gate that mirrors the contract's `AlreadyFinished`, read from
`chain.lifecycleOf()` (which already returns `level`), in the same shape as the
file's existing gates, and wire it into `checkin.mjs`'s chain-gate call beside
the others. The file's header says gates must mirror the contract; this is
that rule applied to the new revert.

`nextSteps.mjs`: `"year-complete"` -> "Your year is complete. The record is
final and its place is written round the border; `status` shows it. A whole
token can seed a child once its key has a seed available." Add the same reason
to `refusals.md` in that file's format.

Set the stubs' `level: 400` to `level: 200` (a level the chain can still hold)
unless the test is ABOUT a finished token.

- [ ] **Step 4: Run, then all four suites, then commit**: `feat(warden): a finished token's check-in is refused as year-complete`.

## Task 9: The Clock orders finishers by token id, and survives a stray one

**Files:**
- Modify: `warden/src/clock/batch.mjs` (`writeCheckInChunk` at about 144; `ENTRY_ERRORS`)
- Test: `warden/test/clock-batch.test.mjs` (or the file that tests `writeCheckInChunk`)

- [ ] **Step 1: Write the failing tests**

```js
test("a chunk is sent in (day, tokenId) order, whatever order it arrived in", async () => {
  const sent = [];
  const writer = fakeWriter({ onSend: (args) => sent.push(args) }); // the file's existing fake
  await writeCheckInChunk(writer, [
    { tokenId: 9, day: 100 }, { tokenId: 2, day: 101 }, { tokenId: 3, day: 100 },
  ], deps);
  assert.deepEqual(unpackIds(sent[0][0]), [3, 9, 2]);
  assert.deepEqual(sent[0][1], [100, 100, 101]);
});

test("AlreadyFinished drops the named token's entries and writes the rest", async () => {
  const sent = [];
  let first = true;
  const writer = fakeWriter({
    onSend: (args) => {
      sent.push(args);
      if (first) { first = false; throw revertWith("AlreadyFinished", [7n]); } // the file's existing revert helper
    },
  });
  const out = await writeCheckInChunk(writer, [
    { tokenId: 7, day: 100 }, { tokenId: 8, day: 100 },
  ], deps);
  assert.deepEqual(unpackIds(sent[1][0]), [8]);
  assert.deepEqual(out.dropped.map(d => [d.entry.tokenId, d.reason]), [[7, "AlreadyFinished"]]);
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

At the top of `writeCheckInChunk`, and again immediately before each `send`
(the heal path appends to the end; `writeInHalves` splits):

```js
  // FINISHING PLACE IS DECIDED BY THIS ORDER. The contract gives places in the
  // order credits arrive, and the published rule is lowest token id first
  // within a day. The SQL already selects in this order; the heal and bisect
  // paths below reorder, so the order is re-imposed at the last moment rather
  // than trusted from upstream.
  const byDayThenId = (a, b) => a.day - b.day || a.tokenId - b.tokenId;
```

`ENTRY_ERRORS.AlreadyFinished = { by: "id" }`, with a comment: the door refuses
these, so one reaching the chain is a mirror that fell behind, and dropping it
loses nothing -- the token's year is already complete on chain.

**`writeInHalves` splits a day across two transactions.** That keeps order
(first half first), so places are still assigned in `(day, tokenId)` order.
Write a test proving the first half is sent before the second.

- [ ] **Step 4: Run, then all four suites, then commit**: `feat(clock): a day's batch is ordered by token id, which sets finishing place`.

## Task 10: The mirror records the place

**Files:**
- Modify: `warden/src/mirror/schema.sql`, `warden/src/mirror/db.mjs` (`migrate`), `warden/src/mirror/queries.mjs`, `warden/src/clock/reconcile.mjs` (the event switch at about 190-220), `warden/src/clock/abi.mjs`, `warden/src/mcp/tokenView.mjs:38-41`
- Test: `warden/test/clock-reconcile.test.mjs`, `warden/test/mirror.test.mjs` (or equivalents), `warden/test/token-view.test.mjs`

**Interfaces:**
- Produces: `tokens.finisher INTEGER NOT NULL DEFAULT 0`; `q.setFinished(tokenId, ordinal, markId)`; `tokenView` field `finisher: { place, mark } | null`.

- [ ] **Step 1: Write the failing tests**

```js
test("a Finished event writes the place and the Mark bit", () => {
  const q = freshMirrorWithToken(5);
  applyEvents(q, [{ eventName: "Finished", args: { id: 5n, ordinal: 3, markId: 14 } }]);
  const t = q.token(5);
  assert.equal(t.finisher, 3);
  assert.equal(t.marks & (1 << 14), 1 << 14);
});

test("the migration adds finisher to an existing mirror", () => {
  // open a db built from the PREVIOUS schema, run migrate(), read the column
});

test("status shows the place and the Mark, and no years field", () => {
  const v = tokenView({ ...baseToken, level: 365, finisher: 1, marks: 1 << 15 });
  assert.deepEqual(v.finisher, { place: 1, mark: "apex" });
  assert.equal("years" in v, false);
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

Regenerate `abi.mjs` from the build the way it was generated before (read its
header for the command) so it carries `Finished` and `AlreadyFinished`.

`schema.sql`: add `finisher INTEGER NOT NULL DEFAULT 0, -- finishing place, 0 until the year is complete`
to `tokens`. `db.mjs` `migrate`: the same `ALTER TABLE ... ADD COLUMN` guarded
the way the existing ones are. **Read the `the-index-that-blocked-lineage`
lesson first: `schema.sql` runs on every open, so anything that depends on the
new column belongs in `migrate()`.**

`queries.mjs`: `setFinished` updates `finisher` AND ORs the Mark bit into
`marks`, in one statement or one transaction.

`reconcile.mjs`: a `case "Finished":` that validates `markId` is 11-15 and
`ordinal >= 1` exactly the way the `MarkApplied` case validates its id (a bad
decode is counted as skipped and logged, never written), then calls
`q.setFinished`.

`tokenView.mjs`: drop `years`; add
`finisher: t.finisher ? { place: t.finisher, mark: markNameIn(t.marks & FINISHER_MASK) } : null`,
using `markNameIn` from `ladder.mjs` (it names the FIRST Mark in a mask, which
is why the mask is narrowed to the five finisher bits first). Export
`FINISHER_MASK` from `ladder.mjs` as the `FINISHERS` constant Task 4 defines.

- [ ] **Step 4: Run, then all four suites, then commit**: `feat(mirror): the finishing place is recorded from the Finished event`.

## Task 11: The ladder tool shows the finisher Marks and never sells them

**Files:**
- Modify: `warden/src/mcp/tools/upgrade.mjs:67,103`, `warden/src/mcp/tools/ladder.mjs:133`, `warden/src/mcp/nextSteps.mjs:84-85`
- Test: `warden/test/ladder-tool.test.mjs`, `warden/test/pay.test.mjs:715,1001`

- [ ] **Step 1: Write the failing tests**: the `ladder` tool lists 11-15 as "given at 365 by finishing place" with their caps and how many are taken, never with a price or a way to ask; `upgrade` with `upgradeId: 11` still fails schema validation (`pay.test.mjs:1001` already pins this -- keep it); a hand-built call past the schema with id 12 returns `mark-not-requestable`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Keep the schema's `.max(10)`. In `upgrade.mjs`, directly after the catalogue lookup:

```js
  // Given at 365 by finishing place (MachineReadableOnly.finisherMark), never
  // asked for. The schema already stops 11-15; this is the second wall, for a
  // caller that reaches the handler some other way.
  if (mark.route === "finisher") {
    return { ok: false, reason: "mark-not-requestable", upgradeId };
  }
```

In `tools/ladder.mjs` at the `Object.values(catalogue)` listing, split the rows:

```js
  const offered = Object.values(catalogue).filter(m => m.route !== "finisher");
  const finishers = Object.values(catalogue).filter(m => m.route === "finisher");
```

render `offered` exactly as today, and `finishers` as their own group, each row
`{ id, name, places, cap, taken }` where `taken` is the count of mirror tokens
holding that bit and `places` is the band ("1st", "2nd-4th", ...), with no
price and no call to action. `nextSteps.mjs`: add `"mark-not-requestable"` ->
"Marks 11-15 are given by finishing your year, in the order tokens finish; they
cannot be asked for." and change `mark-inactive`'s "the ten that exist" to "the
Marks that exist". Add `mark-not-requestable` to `refusals.md`.
- [ ] **Step 4: Run, then all four suites, then commit**: `feat(warden): the ladder shows the finisher Marks and refuses to sell them`.

**PHASE C CHECK-IN with the operator.**

---

# PHASE D -- THE WORDS, AND THE DEPLOY

## Task 12: The agent-facing copy, cold-read before it is served

**Files:** `warden/public/llms.txt` (8-13, 40, 250-281), `skills/machine-readable-only/SKILL.md` (37, 53-55, 232, 243), `docs/2026-09-01-mro-raw-protocol.md` (429, 469, 482, 521-524) and its copy, `warden/public/door.html:36`, `tools/ladder-table.mjs` and `tools/test/ladder-table.test.mjs`.

What must be said, in the piece's own register:

1. **The year ends.** At 365 credited days the frame closes, the heart is
   whole, and the record is final. Lines 8-13's "Each further 365 days adds a
   ring" is removed. Seeding a child is how a line goes on.
2. **The race.** Finishing place is the order tokens complete their year;
   tokens finishing on the same day are placed by lowest token id. The first
   finisher's number is written in gold; the table of five with caps.
3. **"Nothing is limited" is rewritten, not softened** (spec section 9): nothing
   in the five pairs is limited; the finisher Marks are limited by place and
   given, never bought or asked for; nothing already held can be taken away --
   that last clause stays verbatim.

- [ ] **Step 1:** Regenerate the ladder table (`tools/ladder-table.mjs`) to include 11-15 as given, with no price column value.
- [ ] **Step 2:** Edit the four files. Re-copy the raw protocol with `cp`, then re-render every edited `.md` to `.html` with `node ~/scripts/render-md-to-html.js <file>`.
- [ ] **Step 3: Cold read (spec section 10).** Three `Explore` agents per variant, each told only that the operator fetched the file from the project's site, asked what the piece asks of them and whether anything reads as a sales funnel. Two "sales funnel" verdicts out of three send the copy back.
- [ ] **Step 4:** All four suites, then commit: `docs(agents): the year ends, and the first to finish is written in gold`.

## Task 13: Record the 2026-09-23 decisions in the spec

- [ ] Add section 10m to `docs/specs/2026-09-20-mro-finisher-marks-design.md` carrying the "Decided on 2026-09-23, and NOT yet in the spec" table above, and mark sections 6-7's claim and reservation design SUPERSEDED by it. Update 11 (Non-goals): "The ordinal is not drawn" and "The QR version is not raised" are stale -- both happened. Re-render the HTML. Commit: `docs(finisher): the Mark is given at 365, and 10f is built`.

## Task 14: Redeploy on Base Sepolia -- needs the operator's go-ahead

**This spends testnet ETH only and sends nothing real, but it replaces the live
testnet contract and clears the mirror's chain rows. Ask before starting.**

- [ ] **Step 1:** `bash contracts/script/deployer-balance.sh`; stop if short.
- [ ] **Step 2:** `bash contracts/script/deploy-plan7.sh` (runs `DeployPlan5.s.sol`, now writing 15 Marks), then `bash contracts/script/verify-plan7.sh <renderer> <token> <warden>`.
- [ ] **Step 3:** `cd warden && node tools/read-ladder.mjs <token>` -- all 15 rows match.
- [ ] **Step 4:** `bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>`, then follow its printed steps in order: rehearse, set the contract address, snapshot the mirror, reset its chain rows, `pm2 restart mro-warden`, verify through Cloudflare.
- [ ] **Step 5: Prove the new rules on the live chain** with `cast`: `applyMark(<id>, 11, 0)` from the Clock reverts `MarkNotRequestable` (a `cast call`, no transaction); `finishers()` is 0; `upgradeOf(15)` shows cap 1.
- [ ] **Step 6:** Mint one token through the real paid path, as after the last redeploy, and confirm `/t/<id>` serves it.
- [ ] **Step 7:** All four suites, commit the adopted addresses, and ask before pushing.

**Finishing on the live testnet cannot be shown in real time -- it takes a
year.** The fast-days copy (`contracts/script/fast/`, a five-minute day) can
show it in about 30 hours. That is OPTIONAL and the operator's call; the
Foundry tests prove the same rules against the same contract.

---

## Self-review against the spec

- 10l the inks, caps and names -- Tasks 2, 4, 6.
- 10f stop at 365, one ring, no fading, the Clock stops including a finished token -- Tasks 1, 5, 8, 9.
- Section 5 ordinal in bits 64-95, never 32-63 -- Task 2 writes 64; `test_finishingLeavesTheIrisRunAlone` guards 32-63.
- Section 6 same-day ordering by token id, published -- Tasks 9 and 12.
- Section 7 reservation accounting -- NOT NEEDED: nothing is reserved when the chain assigns. Recorded in Task 13.
- Section 9 the published promise rewritten, not softened -- Task 12.
- Section 10 validation: cold read (12), break the wiring (2), decode sweep (7), gas measured (7), all four suites before every commit.
- 10i order of work: boot assertion before anything starts (Task 4 lands with the contract, so the Warden never boots against a ladder it rejects); copy last (Task 12).
