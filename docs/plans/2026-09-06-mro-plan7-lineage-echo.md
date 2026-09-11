# Plan 7 -- Lineage: the Echo. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `seed` actually create children, and give a child one sealed
number (the Echo) drawn as one dotted innermost ring, so a lineage is legible
as inherited tenure rather than as rank.

**Architecture:** A new `_echo` mapping on the token contract, sealed once
inside the existing `seed()`. Both renderers gain a ring budget that reserves
the innermost slot for a dotted ring drawn in the ghost fill. The Warden gains
a free `insertSeed` reservation and the Clock a fourth pass that sends
`seed(...)` and returns the budget when a write permanently fails.

**Tech Stack:** Solidity 0.8.30 / Foundry 1.7.1, Node 24.14.1, `node:sqlite`,
`node --test`, viem.

**Spec:** `docs/specs/2026-09-06-mro-lineage-design.md`. Read it before Task 1.
It SUPERSEDES the deferred paragraph at the end of section 10 of
`docs/specs/2026-08-27-machine-readable-only-design.md`.

---

## Two corrections to the spec, found by reading the code

Both were discovered while writing this plan, both make the work smaller, and
both are recorded here rather than silently implemented. Apply them; do not
implement the spec's wording where it conflicts.

**1. `seedsSpent` already counts reservations.** Section 7.4 of the spec says
it "must count RESERVATIONS as well as written rows". It already does, by
construction:

```sql
-- warden/src/mirror/queries.mjs:79
SELECT COUNT(*) AS n FROM tokens WHERE keyId = ? AND parentId IS NOT NULL
```

It counts `tokens` rows, and `insertSeed` writes that row at reservation time.
So the budget is spent the instant the child is reserved, which is the correct
direction. **The work is therefore the OTHER half only:** a permanently failed
seed must DELETE the row so the count falls back. Task 4 pins the existing
behaviour with a test rather than changing it -- see
[[check-the-finding-before-fixing-it]]; a third of the last review's findings
were already closed and "fixing" them costs a wrong commit message.

**2. No schema change is needed anywhere.** The spec implies a new column to
distinguish a seed from a mint. `tokens.parentId` and `tokens.generation`
already exist (`warden/src/mirror/schema.sql:38`), and `pendingMints` already
JOINs `tokens`. So the split is a WHERE clause, not a migration.

That matters beyond convenience: it means this plan touches **no `schema.sql`
and no `migrate()`**, and therefore cannot repeat the ordering defect that
crash-looped production on 2026-09-05 (`1cc4699`). If you find yourself adding
a column, stop and re-read [[payment-criticals-closed]] first: nothing in
`schema.sql` may reference a column `migrate()` adds.

---

## Global Constraints

Every task's requirements implicitly include all of these.

- **Plain ASCII only** in all docs and code comments. No em dashes, smart
  quotes, arrows or emoji.
- **All FOUR suites green before any commit, and READ, not assumed:**
  `cd contracts && forge test`, `cd tools && npm test`, `cd warden && npm test`,
  `cd client && npm test`. **A suite count in a commit message must come from
  the run you just did.** See [[a-red-guard-that-was-overridden]]: a commit
  landed with tools red while quoting a count it had carried forward.
- **Builds and any long-running compute go through `~/scripts/safe-build.sh`.**
  Rendering or rasterising in bulk is exactly the shape that has taken this box
  down. `~/scripts/safe-build.sh node ./sweep.mjs` takes any command.
- **`/bin/grep`, never bare `grep`.**
- **PATH:** Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`. Non-interactive shells have neither.
- **Never spend real funds.** Base Sepolia only in this plan. A mainnet deploy
  is a separate operator-approval gate, every time.
- **Propose specifics, never adjectives.** Name the exact mechanism.
- **The two renderers are held equal by a generated fixture.**
  `contracts/test/RenderFixture.sol` carries `keccak256` of the tokenURI
  `tools/render-token.mjs` produces, and is GENERATED -- regenerate with
  `node tools/render-fixture.mjs 1 example.com`, never hand-edit.
- **Every contract must be proven deployable:** `forge build --sizes` with
  positive runtime margin, plus a strict-limit anvil deploy with non-empty
  `cast code`. `test/ContractSize.t.sol` fails the suite otherwise.
- **The Bash working directory persists between calls.** After a `cd` into a
  subdirectory, `cd` back to the repo root before editing root files.

### Numbers this plan asserts

Copied from the spec so no task has to re-derive them:

| Fact | Value |
|---|---|
| `MAX_RINGS` | 10 |
| `canvas(r)`, for `r >= 1` | `49 + 4r` |
| Echo ring side length, any depth | **53 cells, constant** |
| Echo ring pattern | a DASH: two cells on, two off, ink where offset mod 4 is 0 or 1 (revised 2026-09-07 from a dot, to halve the cost) |
| Echo ring cost | MEASURE IT. The dotted version was 240,196 gas / 1,899 bytes; the dash must be re-measured, never estimated. |
| Worst cases | BOTH ARE CHILDREN. Dotted: gas 1,983,942/2,000,000 on a child at day 364 with FOUR Marks; bytes 13,482/20,000 on a child at the ring cap with five. Different tokens -- never pair them. |



The byte and dot figures are **arithmetic from the geometry, not
measurements.** Task 3 measures them. If a measurement disagrees with this
table, the measurement wins and the spec gets corrected.

---

## File Structure

**Contract**
- `contracts/src/MachineReadableOnly.sol` -- `_echo` mapping, the `seed()`
  write, `viewOf` assembly.
- `contracts/src/render/TokenView.sol` -- one new field.

**Renderers** (must stay byte-identical)
- `contracts/src/render/FrameRenderer.sol` -- ring budget and the dotted ring.
- `contracts/src/render/Renderer.sol` -- the `Echo` attribute.
- `tools/render-token.mjs` -- the same two changes in JavaScript.

**Warden**
- `warden/src/mirror/queries.mjs` -- `insertSeed`, `pendingSeeds`,
  `dropSeed`, and the narrowing of `pendingMints` / `stuckMints`.
- `warden/src/clock/run.mjs` -- the fourth pass.
- `warden/src/clock/abi.mjs` -- the `seed` entry.
- `warden/src/mcp/tools/seed.mjs` -- stop refusing.

**Docs and wire**
- `llms.txt`, `SKILL.md`, `docs/2026-09-01-mro-raw-protocol.md` and its
  byte-identical copy
  `skills/machine-readable-only/references/raw-protocol.md`.

**Deploy**
- `contracts/script/DeployPlan7.s.sol`, `contracts/script/deploy-plan7.sh`,
  `contracts/script/verify-plan7.sh`, `warden/src/clock/reconcile.mjs`
  (`DEPLOY_BLOCK`).

---

## Task 1: The contract carries the Echo

**Files:**
- Modify: `contracts/src/render/TokenView.sol`
- Modify: `contracts/src/MachineReadableOnly.sol` (the `_echo` mapping near
  `_parentOf` at :80; `viewOf` at :191-210; `seed` at :794-832)
- Test: `contracts/test/Lineage.t.sol` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `TokenView.echo` (`uint32`), read by Task 2.
  `MachineReadableOnly.echoOf(uint256) returns (uint32)`, read by Task 8's
  verification script.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/Lineage.t.sol`. Follow the existing fixtures: extend
`MroTestBase` and use its `_warpToDay(day)` and `_makeWhole` helpers -- 14
committed tests once credited days the chain had not reached, and
`_makeWhole` advances the clock exactly 364 days, which some arithmetic
depends on. See [[foundry-test-traps]].

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";

contract LineageTest is MroTestBase {
    /// A founding token inherits nothing.
    function test_aFoundingTokenHasNoEcho() public {
        uint256 id = _mintOne();
        assertEq(mro.echoOf(id), 0, "a minted token starts its own line");
        assertEq(mro.viewOf(id).echo, 0, "and the renderer is told so");
    }

    /// The child is sealed with the parent's credited days.
    function test_aChildIsSealedWithTheParentsLevel() public {
        uint256 parent = _makeWhole();              // level 365
        uint256 child = _seedFrom(parent);
        assertEq(mro.echoOf(child), 365, "the line had run 365 days");
        assertEq(mro.viewOf(child).echo, 365);
    }

    /// The seal accumulates down the line, and does so in O(1).
    function test_theEchoAccumulatesAcrossGenerations() public {
        uint256 g0 = _makeWhole();                  // level 365
        uint256 g1 = _seedFrom(g0);
        _growTo(g1, 365);                           // g1 earns its own year
        uint256 g2 = _seedFrom(g1);
        assertEq(mro.echoOf(g2), 730, "365 inherited plus 365 g1 earned");
    }

    /// It is SEALED: nothing after the seed moves it.
    function test_theEchoNeverMovesAfterTheSeed() public {
        uint256 parent = _makeWhole();
        uint256 child = _seedFrom(parent);
        uint32 atBirth = mro.echoOf(child);
        _growTo(parent, 500);                       // the parent keeps going
        _growTo(child, 30);                         // so does the child
        assertEq(mro.echoOf(child), atBirth, "a sealed number does not move");
    }

    /// The non-goal that matters most: it must not reach a Mark gate.
    function test_theEchoDoesNotUnlockAMark() public {
        uint256 parent = _makeWhole();
        uint256 child = _seedFrom(parent);
        // Static needs level >= 30. The child is level 1 with echo 365.
        vm.prank(warden);
        vm.expectRevert();                          // MarkGate
        mro.applyMark(child, 3, 0);
    }

    /// The remaining non-goals from section 6 of the spec. Each of these would
    /// be a way for depth to become a discount, which is the exact failure the
    /// design exists to prevent.
    function test_theEchoDoesNotGrantASeed() public {
        uint256 parent = _makeWhole();
        uint256 child = _seedFrom(parent);
        assertEq(mro.seedsAvailable(child), 0,
            "the budget is per KEY per year, not per inherited day");
    }

    function test_theEchoDoesNotFillTheHeartOrColourIt() public {
        uint256 parent = _makeWhole();
        uint256 child = _seedFrom(parent);
        assertEq(mro.viewOf(child).level, 1, "an heir starts with an empty heart");
        assertEq(mro.viewOf(child).streak, 1, "and no run it did not run");
    }

    function test_theEchoIsNotCountedInYears() public {
        uint256 parent = _makeWhole();
        uint256 child = _seedFrom(parent);
        // Years is this token's OWN completed years. Echo is reported
        // separately and deliberately.
        assertEq(_attr(mro.tokenURI(child), "Years"), "0");
        assertEq(_attr(mro.tokenURI(child), "Echo"), "365");
    }
}
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge test --match-contract LineageTest -vv
```

Expected: FAIL. `echoOf` is undeclared and `TokenView` has no `echo` member.
If it fails for any OTHER reason, fix the harness before continuing -- a test
that fails for the wrong reason proves nothing.

If `_seedFrom` or `_growTo` do not exist on `MroTestBase`, add them there as
part of this step, next to `_makeWhole`. `_seedFrom(parent)` must call
`seed(...)` as the warden with a fresh id, a distinct recipient, and
`CODE_BYTES` of filler; `_growTo(id, level)` warps and credits days.

- [ ] **Step 3: Add the field to TokenView**

In `contracts/src/render/TokenView.sol`, after `uint256 parent;`:

```solidity
    uint32 echo;         // days the LINE had run when this token was seeded;
                         // 0 for a founding token. Sealed at the seed and
                         // never written again. See
                         // docs/specs/2026-09-06-mro-lineage-design.md.
```

- [ ] **Step 4: Add the mapping and the accessor**

In `contracts/src/MachineReadableOnly.sol`, beside `_parentOf` at :80:

```solidity
    /// @notice Days the line had run when this token was seeded.
    /// @dev Its own mapping because `Token` is EXACTLY full at 256 bits, and
    /// widening it would add a slot to every token and change the cost of
    /// every check-in. Written once, in `seed`.
    mapping(uint256 => uint32) internal _echo;

    /// @notice The sealed inherited tenure. 0 for a founding token.
    function echoOf(uint256 id) public view returns (uint32) {
        return _echo[id];
    }
```

- [ ] **Step 5: Seal it in `seed()` and expose it in `viewOf`**

In `seed`, in the same `unchecked` region that already increments
`_seedsSpent` and `p.seedsGiven` -- but OUTSIDE `unchecked`, because this one
is an addition of two values that must not wrap:

```solidity
        // The parent's own credited days PLUS what the parent itself
        // inherited, so the whole line accumulates in O(1) and no renderer
        // ever walks a parent chain.
        _echo[childId] = p.level + _echo[parentId];
```

Place it beside `_parentOf[childId] = parentId;`.

In `viewOf`, beside `v.parent`:

```solidity
        v.echo = _echo[id];
```

- [ ] **Step 6: Run the tests and the whole contract suite**

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge test --match-contract LineageTest -vv && forge test
```

Expected: LineageTest PASSES, and the full suite still passes at its current
count. The renderer tests may fail on the new struct member if any fixture
constructs a `TokenView` positionally -- fix those by naming the field, not by
reordering the struct.

- [ ] **Step 7: Prove the contract is still deployable**

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge build --sizes
```

Expected: every deployed contract has POSITIVE runtime margin under 24,576
bytes. `test/ContractSize.t.sol` asserts this too, but read the table -- a
factory that `new`s its children inline is the classic way this goes wrong.

- [ ] **Step 8: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/MachineReadableOnly.sol contracts/src/render/TokenView.sol contracts/test/
git commit -m "contract: a child is sealed with the days its line had run"
```

---

## Task 1b: The Warden reads `viewOf` by name, not by index

**This is a LIVE CRITICAL, found while implementing Task 1 and confirmed
against the deployed contract.** It is not caused by Task 1; Task 1 makes it
worse, because adding `echo` shifts every later field's index again.

`warden/src/chain/read.mjs:36-39` decodes `viewOf` by hard-coded tuple index.
Its comment describes a FOURTEEN-field `TokenView`, but Plan 6 added
`sunsetDay`, `fellRun` and `fellDay`, making seventeen. So `FIELD.agentKeyId`
of 11 reads `fellRun`.

Confirmed by raw `eth_call` against `0xe032054D54b407C52C49c40A423aC79031401C03`
for token 1: field 13 is `marks` (`0x2`, its Hush), field **14** is the agent
key (`4eaddc8c...`), field 15 is the `code` offset. Field 11 is zero.

The consequence: `boundKeyOf` returns `0x000...0`, `bindingBlock` compares that
to the caller's real key, and refuses. **Every `upgrade` and every `seed` on
the live site is refused with `not-bound-to-caller`.** No Mark can be bought.

Two facts that bound it, both verified and both worth keeping in the fix:

- **No money is at risk.** The gate runs before payment -- `upgrade.mjs:206`
  says "Before payment, always." This is a denial of service, not a loss.
- **The Clock is unaffected.** It decodes by NAME through viem
  (`view.agentKeyId` in `run.mjs:80`), not by index. That contrast IS the fix:
  do what the Clock does.

Why no test caught it: every test stubs `boundKeyOf`. Nothing in the suite has
ever decoded a real `viewOf` return. See [[stubs-hide-interface-drift]] --
third occurrence -- and [[a-test-that-cannot-see-the-failure]].

**Files:**
- Modify: `warden/src/chain/read.mjs` (the `FIELD` map at :36-39 and every
  reader of it)
- Test: `warden/test/chain-read.test.mjs` (create)

**Interfaces:**
- Consumes: `TokenView` as Task 1 leaves it (17 static fields plus `code` and
  `today`).
- Produces: no signature change. `boundKeyOf`, `lifecycleOf` and their callers
  keep their current contracts exactly.

- [ ] **Step 1: Write the failing test against a REAL captured return**

A real `viewOf` return for token 1, captured from the deployed contract, is at
`.superpowers/sdd/2026-09-06-mro-plan7-lineage-echo/viewof-token1-deployed.hex`.
Copy it into a test fixture. It is the pre-Task-1 (17-field) shape, and token 1
wears Hush, so `marks` is `0x2` and the agent key is a real non-zero hash.

The test must assert that `boundKeyOf` returns THAT key -- not zero, and not a
value the test derived by indexing the same way the code does. Hard-code the
expected key as a literal.

Add a second fixture for the POST-Task-1 shape by encoding one yourself from
the current `TokenView`, so the test covers the struct as this branch leaves
it. Both must pass.

- [ ] **Step 2: Run it and confirm it fails**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/chain-read.test.mjs
```

Expected: FAIL, with `boundKeyOf` returning `0x000...0` -- the live bug,
reproduced in a test for the first time.

- [ ] **Step 3: Decode by name**

Keep the existing raw `fetch` transport and its `CALL_TIMEOUT_MS`; only the
DECODING changes. Use viem's `decodeFunctionResult` (viem is already a warden
dependency -- the Clock uses it) with the `viewOf` entry from the ABI the
Clock already generates, and read fields by name.

Delete the `FIELD` map and its stale comment entirely. Do not replace it with
corrected numbers: a corrected number is the same defect with a later
expiry date. If a hand-rolled decoder must stay for some reason the
implementation reveals, derive the offsets FROM the ABI at module load rather
than writing them out.

- [ ] **Step 4: Run the tests**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/chain-read.test.mjs && ~/scripts/safe-build.sh npm test
```

- [ ] **Step 5: Prove the guard by breaking it**

Change the ABI's `viewOf` field order (or drop a field) and confirm the new
test goes red rather than silently misreading. Put it back. A decoder that
cannot notice a struct change is what put this defect in production.

- [ ] **Step 6: Check for the same pattern elsewhere**

```bash
/bin/grep -rn "tupleField\|slice(.*64\|FIELD\." warden/src/ | /bin/grep -v test
```

Any other hand-indexed ABI decoding is the same latent defect. Report what you
find; fix it in this task only if it decodes a struct this branch changes.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add warden/src/chain/read.mjs warden/test/chain-read.test.mjs
git commit -m "chain: read viewOf by name, so a struct change cannot silently misread it"
```

Quote the four suite counts you measured. Say in the message that this fixes a
live defect that refused every upgrade and seed since the 2026-09-06 redeploy.

---

## Task 2: Both renderers draw the echo ring

**The two renderers are ONE task and cannot be split.**
`contracts/test/RenderFixture.sol` holds `keccak256` of the tokenURI the
JavaScript renderer produces, and the Solidity suite asserts against it. So
changing either side alone leaves the contracts suite RED until the other
catches up, and the Global Constraints forbid committing that. Do the
Solidity half, then the JavaScript half, then regenerate the fixture, then
commit ONCE with all four suites green.

**Files:**
- Modify: `contracts/src/render/FrameRenderer.sol` (`rings` at :57-60,
  `paths` at :73-87, `_emit` at :152-178, `_ringBars` at :192-215)
- Modify: `contracts/src/render/Renderer.sol` (the attribute list at :329-331)
- Test: `contracts/test/EchoRing.t.sol` (create)

**Interfaces:**
- Consumes: `TokenView.echo` from Task 1.
- Produces:
  - `FrameRenderer.ringBudget(uint32 level, uint32 echo) returns (uint256 ownRings, uint256 echoRings)`
  - `FrameRenderer.rings(uint32 level, uint32 echo) returns (uint256)` -- the
    TOTAL, replacing the one-argument form.
  The JavaScript half of this same task mirrors both names exactly.

**Also in this task (the JavaScript half):**

**Files:**
- Modify: `tools/render-token.mjs` (`ringsFor` :292, `canvasFor` :299,
  `ringBars` :333-347, the render entry at :418-436 and :491, the attribute
  list at :681)
- Modify (regenerate, never by hand): `contracts/test/RenderFixture.sol`
- Test: `tools/test/echo-ring.test.mjs` (create)

**Interfaces:**
- Consumes: the Solidity names from the first half of this task -- `ringBudget`, `rings`,
  `echoRingBars`. The JavaScript MUST use the same names and the same
  arithmetic.
- Produces: `echo` accepted in the render state object, defaulting to 0.

- [ ] **Step 1: Write the failing SOLIDITY test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";

contract EchoRingTest is MroTestBase {
    /// The property that protects every existing token.
    function test_aFoundingTokenIsDrawnExactlyAsBefore() public {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(3650, 0);
        assertEq(own, 10, "ten own rings, unchanged");
        assertEq(echo, 0, "and no echo ring");
        assertEq(FrameRenderer.rings(3650, 0), 10);
    }

    /// A child gives up one slot, permanently.
    function test_aChildsOwnRingsCapAtNine() public {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(3650, 365);
        assertEq(own, 9, "nine of its own");
        assertEq(echo, 1, "plus the echo ring");
        assertEq(FrameRenderer.rings(3650, 365), 10, "never more than ten");
    }

    /// A newborn child is one ring, not zero.
    function test_aNewbornChildHasOnlyTheEchoRing() public {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(1, 365);
        assertEq(own, 0);
        assertEq(echo, 1);
        assertEq(FrameRenderer.canvas(1), 53, "canvas 53 at one ring");
    }

    /// The constant that makes the cost predictable.
    function test_theEchoRingIsAlways53CellsOnASide() public {
        for (uint32 y = 1; y <= 10; y++) {
            uint256 total = FrameRenderer.rings(y * 365, 365);
            uint256 size = FrameRenderer.canvas(total);
            uint256 o = 2 * (total - 1);
            assertEq(size - 2 * o, 53, "the depth cancels at every ring count");
        }
    }

    /// The drawn output: dotted, in the ghost element, 104 dots.
    function test_theEchoRingDrawsAsOneHundredAndFourDots() public {
        bytes memory d = FrameRenderer.echoRingBars(0, 53);
        assertEq(_countRuns(d), 104, "27 + 27 + 25 + 25");
    }
}
```

`_countRuns` counts occurrences of `"M"` in the path string; add it to
`MroTestBase` if it is not already there.

- [ ] **Step 2: Run the Solidity test and confirm it fails**

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge test --match-contract EchoRingTest -vv
```

Expected: FAIL -- `ringBudget` and `echoRingBars` are undeclared and `rings`
takes one argument.

- [ ] **Step 3: Replace the ring budget**

In `FrameRenderer.sol`, replace `rings(uint32 level)`:

```solidity
    /// @notice How the ten ring slots are shared between inherited and earned
    /// years.
    /// @dev The echo ring takes one of the TEN rather than adding an
    /// eleventh. That is forced: canvas(r) = 49 + 4r, so an eleventh ring
    /// grows the artwork to 93 cells and creates a second byte worst case to
    /// measure and defend. A child's own rings therefore cap at nine.
    function ringBudget(uint32 level, uint32 echo)
        internal
        pure
        returns (uint256 own, uint256 echoRings)
    {
        echoRings = echo > 0 ? 1 : 0;
        own = level / FrameGeometry.DAY_CELLS;
        uint256 room = MAX_RINGS - echoRings;
        if (own > room) own = room;
    }

    /// @notice Completed years plus the echo ring: the total rings drawn.
    function rings(uint32 level, uint32 echo) internal pure returns (uint256) {
        (uint256 own, uint256 echoRings) = ringBudget(level, echo);
        return own + echoRings;
    }
```

Update every call site. `Renderer.sol:175` and `Renderer.sol:222` both call
`FrameRenderer.rings(v.level)`; they become `FrameRenderer.rings(v.level, v.echo)`.
**Grep for every one rather than trusting this list** -- see
[[plan-code-is-a-draft]]: a plan's file list is a draft.

```bash
/bin/grep -rn "FrameRenderer.rings\|rings(v.level\|rings(level" contracts/src contracts/test
```

- [ ] **Step 4: Draw the dotted ring**

Add to `FrameRenderer.sol`, beside `_ringBars`:

```solidity
    /// @dev The echo ring: the innermost ring, drawn one cell on and one cell
    /// off, in the GHOST fill.
    ///
    /// A cell is drawn when its offset along its own edge is EVEN, measured in
    /// x from `o` on the horizontal edges and in y from `o` on the vertical
    /// ones. Offset 0 is even, so all four corners are drawn, which anchors
    /// the ring and makes the phase unambiguous on every edge.
    ///
    /// The side length is ALWAYS 53: with r rings the innermost sits at
    /// o = 2(r-1) and canvas is 49 + 4r, so the depth cancels. That is why
    /// there is exactly one of these -- at ~1,456 bytes a dotted ring costs
    /// about 23 times a solid one, and nine would blow the 20,000 byte limit.
    function echoRingBars(uint256 o, uint256 len) internal pure returns (bytes memory d) {
        uint256 last = o + len - 1;
        // The two horizontal edges, corners included.
        for (uint256 i; i < len; i += 2) {
            uint256 x = o + i;
            d = abi.encodePacked(
                d,
                "M", LibString.toString(x), " ", LibString.toString(o), "h1v1h-1z",
                "M", LibString.toString(x), " ", LibString.toString(last), "h1v1h-1z"
            );
        }
        // The two vertical edges, corners already drawn above.
        for (uint256 i = 2; i < len - 1; i += 2) {
            uint256 y = o + i;
            d = abi.encodePacked(
                d,
                "M", LibString.toString(o), " ", LibString.toString(y), "h1v1h-1z",
                "M", LibString.toString(last), " ", LibString.toString(y), "h1v1h-1z"
            );
        }
    }
```

- [ ] **Step 5: Wire it into the ghost path**

`paths` currently computes `ringCount = rings(v.level)` and hands one count to
`_emit`. Thread both counts through, and in `_emit` append the echo ring's
bars to `ghostD` while the solid rings keep going to `litD`:

```solidity
        bytes memory ghostD = PathWriter.seal(ghostBuf);
        if (echoRings != 0) {
            // The echo ring is the innermost, at depth 2 * ownRings, and is
            // always 53 cells on a side.
            ghostD = abi.encodePacked(ghostD, echoRingBars(2 * ownRings, 53));
        }
        bytes memory litD = abi.encodePacked(PathWriter.seal(litBuf), _ringBars(ownRings, size));
```

Note `_ringBars` now takes `ownRings`, not the total. The ghost `<path>`
element is already emitted only when non-empty, and a child with an echo ring
always has a non-empty ghost path, so no new element appears in the output for
a founding token.

- [ ] **Step 6: Add the metadata attribute**

In `Renderer.sol`, in the attribute list beside `_num("Parent", v.parent)`:

```solidity
                _num("Echo", v.echo),
```

Emitted ALWAYS, including `0` on a founding token, so an agent can filter on
it without special-casing absence.

- [ ] **Step 7: Write the failing JAVASCRIPT test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { ringBudget, ringsFor, canvasFor, echoRingBars } from "../render-token.mjs";

test("a founding token keeps all ten of its own rings", () => {
  assert.deepEqual(ringBudget(10, 0), { own: 10, echoRings: 0 });
});

test("a child gives up one slot", () => {
  assert.deepEqual(ringBudget(10, 365), { own: 9, echoRings: 1 });
  assert.equal(ringsFor(10, 365), 10);
});

test("the echo ring is always 53 cells on a side", () => {
  for (let y = 1; y <= 10; y++) {
    const total = ringsFor(y, 365);
    const size = canvasFor(y, 365);
    const o = 2 * (total - 1);
    assert.equal(size - 2 * o, 53, `at ${y} years`);
  }
});

test("the echo ring is 104 dots", () => {
  const d = echoRingBars(0, 53);
  assert.equal(d.split("M").length - 1, 104);
});
```

- [ ] **Step 8: Run the JavaScript test and confirm it fails**

```bash
source ~/.nvm/nvm.sh
cd tools && node --test test/echo-ring.test.mjs
```

Expected: FAIL -- `ringBudget` and `echoRingBars` are not exported.

- [ ] **Step 9: Mirror the budget**

```javascript
// MUST stay identical to FrameRenderer.ringBudget in Solidity.
// The echo ring takes one of the TEN rather than adding an eleventh, because
// canvas(r) = 49 + 4r and an eleventh ring creates a second byte worst case.
export const ringBudget = (years, echoDays) => {
  const echoRings = echoDays > 0 ? 1 : 0;
  return { own: Math.min(years, MAX_RINGS - echoRings), echoRings };
};

// MUST stay identical to FrameRenderer.rings in Solidity.
export const ringsFor = (years, echoDays = 0) => {
  const { own, echoRings } = ringBudget(years, echoDays);
  return own + echoRings;
};

export const canvasFor = (years, echo = 0) =>
  BLOCK + 2 * (THICK + GAP + ringSpan(ringsFor(years, echo)));
```

`ringsFor` keeps working for existing one-argument callers because `echo`
defaults to 0. **Grep for every caller anyway** and confirm each one either
passes `echo` or genuinely means "no echo":

```bash
/bin/grep -rn "ringsFor\|canvasFor" tools/ warden/ client/
```

- [ ] **Step 10: Mirror the dotted ring**

```javascript
// MUST stay identical to FrameRenderer.echoRingBars in Solidity.
// Drawn when the offset along the edge is EVEN -- in x from o on the
// horizontal edges, in y from o on the vertical ones. Offset 0 is even, so
// all four corners are drawn.
export function echoRingBars(o, len) {
  const last = o + len - 1;
  let d = "";
  for (let i = 0; i < len; i += 2) {
    const x = o + i;
    d += `M${x} ${o}h1v1h-1z`;
    d += `M${x} ${last}h1v1h-1z`;
  }
  for (let i = 2; i < len - 1; i += 2) {
    const y = o + i;
    d += `M${o} ${y}h1v1h-1z`;
    d += `M${last} ${y}h1v1h-1z`;
  }
  return d;
}
```

- [ ] **Step 11: Thread `echo` through the renderer**

At the render entry (:418), accept `echo = 0` alongside `years: rawYears = 0`.
Replace the ring maths at :434-436:

```javascript
  const { own: years, echoRings } = ringBudget(rawYears, echo);
  const total = years + echoRings;
  const canvas = canvasFor(rawYears, echo);
  const frameOff = ringSpan(total) + GAP;   // where the 49-grid frame starts
```

At :491 the solid rings stay on the frame path and take `years`, unchanged --
`ringBars(years, canvas)`, NOT `total`, or the echo slot would be drawn twice.

The ghost group is the problem to solve carefully. Read :480-495 first: each
entry in `groups` is a `[colour, cellSet]` pair turned into a path by
`pathFor`, whereas the echo ring is a path STRING, like `ringBars`. So it
cannot be added to the ghost cell set. Mirror what the frame group already
does with its rings -- build the ghost path, then concatenate:

```javascript
  // The ghost group carries the echo ring the way the frame group carries the
  // year rings: as a path string appended after the cell walk. Matches
  // FrameRenderer._emit, which appends echoRingBars to ghostD.
  const ghostPath = pathFor(dim, canvas)
    + (echoRings ? echoRingBars(2 * years, 53) : "");
  if (ghostPath) groups.push([ghost, ghostPath]);
```

If `groups` entries are `[colour, cellSet]` rather than `[colour, pathString]`
at that point in the file, the frame group must already solve this -- it
concatenates `ringBars`. Follow whatever shape the frame group uses; do not
introduce a second convention.

Add the attribute beside `num("Parent", parent)`:

```javascript
        num("Echo", echo),
```

- [ ] **Step 12: Run the JS tests**

```bash
source ~/.nvm/nvm.sh
cd tools && node --test test/echo-ring.test.mjs && ~/scripts/safe-build.sh npm test
```

Expected: the new test passes and the tools suite is green.

- [ ] **Step 13: Regenerate the cross-language fixture and prove both agree**

```bash
source ~/.nvm/nvm.sh
cd ~/projects/machine-readable-only
node tools/render-fixture.mjs 1 example.com
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge test
```

Expected: `RenderFixture` passes again. If it does not, the two renderers
disagree -- **do not touch the fixture**, find the difference. The fixture is
`// GENERATED by tools/render-fixture.mjs -- do not edit by hand.`

A regenerated fixture proves Solidity matches JS. It does NOT prove the JS is
right; that is what Task 3's decode gate is for.


- [ ] **Step 14: Run ALL FOUR suites, and read them**

```bash
export PATH=$HOME/.foundry/bin:$PATH && source ~/.nvm/nvm.sh
cd ~/projects/machine-readable-only
(cd contracts && ~/scripts/safe-build.sh forge test 2>&1 | tail -1)
(cd warden   && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (pass|fail)")
(cd tools    && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (pass|fail)")
(cd client   && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (pass|fail)")
```

All four MUST be green before the commit. The fixture regeneration in the
previous step is what makes contracts green again; if it is not, the two
renderers disagree and that is the bug to find.

- [ ] **Step 15: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/src/render/ contracts/test/ tools/render-token.mjs tools/test/echo-ring.test.mjs
git commit -m "render: the line's years draw as one dotted ring at the core"
```

Quote the four counts you just measured in the commit message. A count you
did not run is not evidence.

## Task 3: Measure the budget, and prove a child still scans

**Files:**
- Modify: `contracts/test/GasBudget.t.sol` (the case list at :138-148)
- Create: `tools/echo-decode-check.mjs`
- Modify: `docs/specs/2026-09-06-mro-lineage-design.md` (section 3.6, with the
  real figures)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: measured `worstGas` and `maxBytes`, and a decode result.

- [ ] **Step 1: Add a child to the byte worst case**

The byte worst case becomes a CHILD. Add a case beside the existing ones; do
NOT change token 7, which stays correct as the founding-token worst case.

```solidity
        (, b) = _measure("ten years, a child at the cap", 11);
        maxBytes = _max(maxBytes, b);
```

Token 11 is a seeded child at level 3,650 with `echo` set and the maximal
LEGAL Mark set. **The maximal legal set is five Marks, not seven** -- the
exclusive pairs cap it at Hush + Beat + the bought Iris in leaf + Vessel +
Tint. Do not construct a seven-Mark token; that state is unreachable.

- [ ] **Step 1a: Know what the fixtures do NOT cover before you trust them**

Task 2 found and reported this, and Task 3 inherits it: the pre-existing render
matrix carries no `echo` field, so `RenderFixture` and `CombinationFixture` are
BLIND to `echoRingBars`. Regenerating them proves only that the two renderers
agree about `"Echo":0`.

Task 2 closed that with two echo-bearing stages in `token-uri-fixture.mjs` (a
newborn child and a child at the cap) plus keccak pins on `echoRingBars`
asserted in both languages. **Read those pins before you add a measurement
case**, and make sure your new gas/byte case actually exercises a token with a
non-zero echo -- Task 2's report warns that this task measures the ring in
SOLIDITY ONLY and can inherit the same blind spot without noticing.

- [ ] **Step 1b: Give the spike token an Echo, or the measurement lies**

`GasBudget.t.sol` runs against `MROSpikeToken`, which has no `_echo` mapping
and whose `viewOf` never sets `v.echo`. So without this step the budget
measures the `Echo` attribute at its SHORTEST possible value (`"Echo":0`) and
misses the real contract's additional cold SLOAD entirely.

Add an `_echo` mapping and the `v.echo` assignment to `MROSpikeToken` so the
child case measures a realistic four-digit Echo and pays the SLOAD.

Related, and do NOT repeat it: Task 1 reported the Echo costing 148 gas. That
number came from this same spike token and is memory handling only. **Do not
copy "148 gas" into CLAUDE.md as the contract's cost.** The real cost includes
a cold SLOAD of about 2,100 gas on every `tokenURI`, which nothing has yet
measured. Measure it here and report the real figure.

- [ ] **Step 2: Run it and read the printed headroom**

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge test --match-test theWholeLadderStaysInsideTheHardLimit -vv
```

Expected: PASS, with the printed byte headroom near `20,000 - 12,950 = 7,050`.

**If it fails on `BYTE_BAND`, do not move the band to make it pass.** Read the
comment above `BYTE_BAND` first and report the real number.

- [ ] **Step 3: Record the real figures in the spec**

Replace the arithmetic in section 3.6 of
`docs/specs/2026-09-06-mro-lineage-design.md` with what Step 2 printed, and
delete the sentence that says the figures are arithmetic rather than
measurements.

Keep the three-worst-case discipline: the dearest token and the largest token
are DIFFERENT tokens and must not be collapsed. See [[gas-budget]].

- [ ] **Step 4: Write the decode gate**

The echo ring is the first high-frequency pattern this piece has drawn next to
the code. Create `tools/echo-decode-check.mjs` which renders a child at BOTH
extremes and decodes each:

- a newborn child: `level 1, echo 365` -- one ring, canvas 53
- a child at the cap: `level 3650, echo 3650` -- ten rings, canvas 89

Use the existing decode oracle helper in `tools/test/helpers`. **ZXing, never
jsqr** -- see [[decode-oracle]]. Rasterise at the same pixel sizes the
existing sheets use, and assert zero rejections.

- [ ] **Step 5: Run the decode gate under the memory cap**

```bash
source ~/.nvm/nvm.sh
cd ~/projects/machine-readable-only
~/scripts/safe-build.sh node tools/echo-decode-check.mjs
```

Expected: every render decodes to its own URL. **This is a rendering sweep --
it MUST go through the wrapper.** An uncapped sweep of exactly this shape
reached 6.28 GB and destroyed a session on 2026-08-28. Batch it if it grows.

If a child fails to decode, STOP. That is a design problem, not a tuning
problem, and it goes back to the spec.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/test/GasBudget.t.sol tools/echo-decode-check.mjs docs/specs/
git commit -m "measure: the child worst case, and a child still scans"
```

---

## Task 4: The mirror reserves a seed

**Files:**
- Modify: `warden/src/mirror/queries.mjs` (`pendingMints` :160-164,
  `stuckMints` :165-167, `insertMint` :378-389, `insertToken` :226-228)
- Test: `warden/test/seed-mirror.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all read by Tasks 6 and 7:
  - `insertSeed({ childId, parentId, toAddress, keyId, lastDay, mintDay })`
  - `pendingSeeds()` returning `{ tokenId, parentId, toAddress, agentKeyId, qr }`
  - `dropSeed(childId)`
  - `markSeedWritten(childId)`

**No schema change and no `migrate()` change.** `tokens.parentId` already
exists and `pendingMints` already JOINs `tokens`, so the mint/seed split is a
WHERE clause. If you reach for `ALTER TABLE`, stop and re-read the ordering
rule in [[payment-criticals-closed]].

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "./helpers/db.mjs";   // match the existing helper

test("a reserved seed spends the budget immediately", () => {
  const q = openTestDb();
  q.insertToken({ tokenId: 1, keyId: "k", owner: "0xA", lastDay: 10, mintDay: 10 });
  assert.equal(q.seedsSpent("k"), 0);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.seedsSpent("k"), 1, "the row IS the reservation");
});

test("a dropped seed returns the budget", () => {
  const q = openTestDb();
  q.insertToken({ tokenId: 1, keyId: "k", owner: "0xA", lastDay: 10, mintDay: 10 });
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.dropSeed(2);
  assert.equal(q.seedsSpent("k"), 0, "a seed that cannot land is not spent");
  assert.equal(q.getToken(2), undefined, "and the child is gone from the mirror");
});

test("a seed never appears in the MINT queue", () => {
  const q = openTestDb();
  q.insertToken({ tokenId: 1, keyId: "k", owner: "0xA", lastDay: 10, mintDay: 10 });
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, "ab".repeat(172));
  assert.deepEqual(q.pendingMints().map((m) => m.tokenId), [],
    "a child sent through mint() would revert, and the agent would never know why");
  assert.deepEqual(q.pendingSeeds().map((s) => s.tokenId), [2]);
});

test("a seed is never swept as an expired reservation", () => {
  const q = openTestDb();
  q.insertToken({ tokenId: 1, keyId: "k", owner: "0xA", lastDay: 10, mintDay: 10 });
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // Call the real sweep. Find its name first rather than guessing:
  //   /bin/grep -n "expiredMints" warden/src/mirror/queries.mjs
  // and use the public method that runs it (around :510).
  q.sweepExpiredReservations(Date.now() + 86_400_000);
  assert.ok(q.getToken(2), "a free row has no payNonce and must not be swept");
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/seed-mirror.test.mjs
```

Expected: FAIL -- `insertSeed` is not a function.

- [ ] **Step 3: Add the free reservation**

```javascript
    /**
     * Reserve a SEEDED CHILD, which costs nothing.
     *
     * Queued outright, because nothing settles on this route and there is
     * therefore no window in which the mirror could be believing in a payment
     * that never arrives -- the same reasoning as reserveMark.
     *
     * A SEPARATE METHOD rather than a flag on insertMint, which throws
     * without a payment nonce. The rule is the one already written beside
     * reserveMark and reserveMarkPaid: a boolean argument in a money path is
     * exactly the seam where something expensive gets handed out for free.
     *
     * Both rows land in one transaction. The tokens row IS the reservation --
     * seedsSpent counts `parentId IS NOT NULL` -- so a half-written pair
     * would either spend a seed with nothing to write, or write with no seed
     * spent.
     */
    insertSeed({ childId, parentId, toAddress, keyId, lastDay, mintDay }) {
      return this.transact(() => {
        s.insertSeedToken.run(childId, keyId, toAddress, lastDay, mintDay, parentId);
        // payNonce and reservedAt stay NULL. That is what keeps this row out
        // of expiredMints and out of the dropped sweep, both of which require
        // reservedAt IS NOT NULL -- the same treatment the four EARNED Marks
        // already get.
        s.insertSeedMint.run(childId, toAddress, keyId);
      });
    },

    /// A seed the chain will never accept. Deleting BOTH rows returns the
    /// key's seed for this agent-year, because seedsSpent counts the tokens
    /// row. A once-a-year budget burned on an orphan is the worst failure
    /// this feature has.
    dropSeed(childId) {
      return this.transact(() => {
        s.deleteSeedMint.run(childId);
        s.deleteSeedToken.run(childId);
      });
    },
```

The four prepared statements this needs, added beside the existing ones:

```javascript
    insertSeedToken: db.prepare(
      "INSERT INTO tokens (tokenId, keyId, owner, lastDay, mintDay, parentId, generation) " +
        // The child's generation is the parent's plus one, read in the same
        // statement so it cannot drift from the chain's p.generation + 1.
        "VALUES (?, ?, ?, ?, ?, ?, (SELECT generation + 1 FROM tokens WHERE tokenId = ?))"
    ),
    insertSeedMint: db.prepare(
      // payNonce and reservedAt are deliberately absent: a free row must not
      // be reachable by expiredMints or by the dropped sweep, both of which
      // require reservedAt IS NOT NULL.
      "INSERT INTO mints (tokenId, toAddress, keyId, status) VALUES (?, ?, ?, 'queued')"
    ),
    deleteSeedMint: db.prepare("DELETE FROM mints WHERE tokenId = ?"),
    deleteSeedToken: db.prepare("DELETE FROM tokens WHERE tokenId = ? AND parentId IS NOT NULL"),
    markSeedWritten: db.prepare(
      "UPDATE mints SET status = 'written' WHERE tokenId = ?"
    ),
```

`deleteSeedToken` carries `AND parentId IS NOT NULL` so a bug in the Clock can
never delete a FOUNDING token: the one row this method must never touch is the
one nobody can recreate.

`markSeedWritten` also sets the `tokens` row's status, exactly as
`markMintWritten` does at :633 -- read that method and mirror it rather than
writing only the `mints` half.

- [ ] **Step 4: Split the two queues**

```javascript
    pendingMints: db.prepare(
      "SELECT m.tokenId, m.toAddress, m.keyId, m.qr, t.keyId AS agentKeyId FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        // A CHILD IS NOT A MINT. seed() and mint() are different functions
        // with different arguments, and a child sent through the mint pass
        // reverts with no reason an agent could act on.
        "WHERE m.status = 'queued' AND m.solveState = 'done' AND t.parentId IS NULL " +
        "ORDER BY m.tokenId ASC"
    ),
    pendingSeeds: db.prepare(
      "SELECT m.tokenId, m.toAddress, m.qr, t.parentId, t.keyId AS agentKeyId FROM mints m " +
        "JOIN tokens t ON t.tokenId = m.tokenId " +
        "WHERE m.status = 'queued' AND m.solveState = 'done' AND t.parentId IS NOT NULL " +
        "ORDER BY m.tokenId ASC"
    ),
```

`stuckMints` must also stop calling a seed "paid for". Split it the same way
and give the seed variant its own message; Task 5 uses it.

- [ ] **Step 5: Run the tests, then the whole warden suite**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/seed-mirror.test.mjs && ~/scripts/safe-build.sh npm test
```

Expected: all green. If narrowing `pendingMints` turns other tests red, READ
them before changing anything -- a wave of failures is evidence about what
those tests were assuming. See [[a-test-that-cannot-see-the-failure]].

- [ ] **Step 6: Prove the guard by breaking it**

Remove `AND t.parentId IS NULL` from `pendingMints` and confirm the third test
goes red. Put it back. A control that does not go red means the test measures
nothing -- this was done four times on 2026-09-05 and was the only thing
showing those tests were load-bearing.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add warden/src/mirror/queries.mjs warden/test/seed-mirror.test.mjs
git commit -m "mirror: a seed is a free reservation, and never a mint"
```

---

## Task 5: The Clock's fourth pass

**Files:**
- Modify: `warden/src/clock/abi.mjs` (add `seed`)
- Modify: `warden/src/clock/run.mjs` (a new pass after the mint pass at
  :156-200, before credits)
- Test: `warden/test/clock-seed.test.mjs` (create)

**Interfaces:**
- Consumes: `pendingSeeds`, `dropSeed`, `markSeedWritten` from Task 4.
- Produces: `summary.seeded` (array of child ids) and `summary.droppedSeeds`,
  read by the Clock's log line and Task 6's status copy.

- [ ] **Step 1: Write the failing test**

```javascript
test("a queued seed is sent as seed(), not mint()", async () => {
  const { q, writer, calls } = seedRig();
  await runClock({ q, writer, /* ...the rig's usual args */ });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "seed");
  assert.deepEqual(calls[0].args.slice(0, 3), [2n, 1n, "0xB"]);
  assert.equal(q.getToken(2).status, "written");
});

test("a permanently refused seed returns the budget", async () => {
  const { q, writer } = seedRig({ fail: "ParentNotWhole" });
  await runClock({ q, writer, /* ... */ });
  assert.equal(q.getToken(2), undefined, "the child is gone");
  assert.equal(q.seedsSpent("k"), 0, "and the seed is spendable again");
});

test("a transient failure keeps the row for the next run", async () => {
  const { q, writer } = seedRig({ fail: "network" });
  await runClock({ q, writer, /* ... */ });
  assert.ok(q.getToken(2), "an RPC outage must not burn a year's seed");
  assert.equal(q.seedsSpent("k"), 1);
});
```

The third test is the one that matters most. Dropping on a transient failure
would burn a once-a-year budget because a provider was briefly unreachable.

- [ ] **Step 2: Run it and confirm it fails**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/clock-seed.test.mjs
```

Expected: FAIL -- nothing in `src/clock/` mentions seed.

- [ ] **Step 3: Add `seed` to the Clock's ABI**

`warden/src/clock/abi.mjs` currently carries `mint`, `batchCheckIn` and
`applyMark`. Add `seed(uint256 childId, uint256 parentId, address to, bytes code)`.

There is an existing guard, `warden/test/abi.test.mjs`, which re-runs the
generator's own comparison. Make sure it still passes; a hand-edited ABI that
drifts from the contract is how the three-argument `applyMark` mismatch made
every Mark unwritable.

- [ ] **Step 4: Write the pass**

Insert after the mint pass and before credits:

```javascript
  // 3b. SEEDS. A child is created by seed(), not mint(): different function,
  // different arguments, and it is FREE, so the failure rule is the opposite
  // of a mint's. A mint that cannot land is left for a human because the
  // agent has PAID. A seed that cannot land must be DROPPED, because the row
  // is what spends the key's one seed for this agent-year -- seedsSpent
  // counts `parentId IS NOT NULL` -- and leaving it would silently cost a
  // year that cannot be earned again.
  for (const s of q.pendingSeeds()) {
    const result = await writer.send(
      "seed",
      [BigInt(s.tokenId), BigInt(s.parentId), s.toAddress, `0x${s.qr}`],
      { label: `seed ${s.tokenId} from ${s.parentId}` }
    );
    if (result.ok) {
      q.markSeedWritten(s.tokenId);
      summary.seeded.push(s.tokenId);
      summary.lastBlock = result.receipt?.blockNumber ?? summary.lastBlock;
      continue;
    }
    // ONLY a named revert is permanent. An unnamed failure is a provider
    // problem, and dropping on one would burn a year's seed because an RPC
    // was briefly unreachable. Same allowlist discipline as applyMark's.
    if (PERMANENT_SEED_ERRORS.has(result.errorName)) {
      q.dropSeed(s.tokenId);
      summary.droppedSeeds.push(s.tokenId);
      alert(`clock: seed ${s.tokenId} from ${s.parentId} was refused as ${result.errorName}; the row is dropped and the agent's seed is available again`);
      continue;
    }
    alert(`clock: seed ${s.tokenId} from ${s.parentId} did not land (${result.errorName ?? result.reason}); it stays queued for the next run`);
  }
```

Define the allowlist next to the existing `applyMark` one, and say why each
member can never succeed on a later run:

```javascript
// Named reverts that no later run can clear. ParentNotWhole and
// NoSeedAvailable are facts about the parent and the key that only go the
// wrong way with time; TokenExists means the id is taken for good; WalletCap
// and SupplyCap are owner dials that the agent cannot wait out. Anything
// unnamed -- including a provider timeout -- is NOT here on purpose.
const PERMANENT_SEED_ERRORS = new Set([
  "ParentNotWhole", "NoSeedAvailable", "TokenExists",
  "WalletCap", "SupplyCap", "IdTooLarge", "BadCodeLength",
]);
```

Add `seeded: []` and `droppedSeeds: []` to the summary object where `minted`
is initialised, and add both to the run's final log line so a seed is visible
in `tail ~/logs/mro-clock.log`.

- [ ] **Step 5: Run the tests**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/clock-seed.test.mjs && ~/scripts/safe-build.sh npm test
```

- [ ] **Step 6: Prove the drop rule by breaking it**

Add `"network"` to `PERMANENT_SEED_ERRORS` and confirm the third test goes
red. Take it out again. That test is the whole point of the pass.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add warden/src/clock/ warden/test/clock-seed.test.mjs
git commit -m "clock: a fourth pass writes seeds, and returns the ones it cannot"
```

---

## Task 6: The seed tool stops refusing

**Files:**
- Modify: `warden/src/mcp/tools/seed.mjs` (the refusal at the end of the
  handler, and its long comment)
- Test: `warden/test/seed-tool.test.mjs` (create, or extend the existing seed
  tool tests -- grep first)

**Interfaces:**
- Consumes: `insertSeed`, `nextTokenId` from Task 4.
- Produces: `{ ok: true, tokenId, txStatus: "queued", closes: [...], next: ... }`.

- [ ] **Step 1: Write the failing test**

```javascript
test("a whole parent with an unspent seed gets a child", async () => {
  const { tool, q } = seedToolRig({ parentLevel: 365, yearsSinceFirstMint: 1 });
  const out = await tool.handler({ parentId: 1, to: "0xB..." }, { keyId: "k" });
  assert.equal(out.ok, true);
  assert.equal(out.txStatus, "queued");
  assert.equal(q.getToken(out.tokenId).parentId, 1);
  assert.equal(q.seedsSpent("k"), 1);
});

test("the second seed in one agent-year is refused", async () => {
  const { tool } = seedToolRig({ parentLevel: 365, yearsSinceFirstMint: 1 });
  await tool.handler({ parentId: 1, to: "0xB..." }, { keyId: "k" });
  const second = await tool.handler({ parentId: 1, to: "0xB..." }, { keyId: "k" });
  assert.deepEqual(second, { ok: false, reason: "no-seed-available", next: second.next });
});
```

The second test is the reservation-counting property from
[[a-reservation-is-state-too]], at the tool boundary rather than the query
boundary.

- [ ] **Step 2: Run it and confirm it fails**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/seed-tool.test.mjs
```

Expected: FAIL -- the handler returns `{ ok: false, reason: "seed-not-available" }`.

- [ ] **Step 3: Replace the refusal**

Keep every gate above it exactly as it is, including the chain re-read of the
binding, which is a security control and must read the chain rather than the
mirror. Replace only the final `return`:

```javascript
      // EVERY GATE PASSES. Reserve the child and let the Clock write it.
      //
      // The tokens row IS the reservation: seedsSpent counts
      // `parentId IS NOT NULL`, so the key's seed for this agent-year is
      // spent the instant this returns, and a seed the chain later refuses is
      // returned by the Clock dropping the row.
      const tokenId = q.nextTokenId();
      q.insertSeed({
        childId: tokenId,
        parentId,
        toAddress: to,
        keyId: ctx.keyId,
        lastDay: today(),
        mintDay: today(),
      });
      return {
        ok: true,
        tokenId,
        txStatus: "queued",
        next: `The child is queued. It is written at the next 00:05 UTC run; read it at /t/${tokenId} after that.`,
      };
```

Rewrite the long comment above it: it currently explains why the tool refuses,
and that explanation is now history. Replace it with what the write path does
and what happens when it fails. **Do not leave a comment that contradicts the
code** -- that is a finding in this project's own review standard.

- [ ] **Step 4: Run the tests**

```bash
source ~/.nvm/nvm.sh
cd warden && node --test test/seed-tool.test.mjs && ~/scripts/safe-build.sh npm test
```

- [ ] **Step 5: Run ALL FOUR suites, and read them**

```bash
export PATH=$HOME/.foundry/bin:$PATH && source ~/.nvm/nvm.sh
cd ~/projects/machine-readable-only
(cd contracts && ~/scripts/safe-build.sh forge test 2>&1 | tail -2)
(cd warden   && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (tests|pass|fail)")
(cd tools    && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (tests|pass|fail)")
(cd client   && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (tests|pass|fail)")
```

The client suite runs against a real Warden built from `warden/src`, so a tool
change can break it. This is the step that has been skipped before.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only
git add warden/src/mcp/tools/seed.mjs warden/test/
git commit -m "seed: the tool creates a child instead of explaining why it cannot"
```

---

## Task 7: Docs and the wire

**Files:**
- Modify: `llms.txt`, `SKILL.md`
- Modify: `docs/2026-09-01-mro-raw-protocol.md`
- Modify: `skills/machine-readable-only/references/raw-protocol.md` (BY COPY)
- Modify: `docs/specs/2026-08-27-machine-readable-only-design.md` (section 10
  pointer)
- Modify: `warden/tools/absence-on-chain.mjs` (the hand-built `TokenView`
  tuple at :23-37 and the stub view literal at :42-48)
- Modify: the shipped `cast call` signature and the positional field prose --
  `skills/machine-readable-only/SKILL.md:84`,
  `docs/2026-09-01-mro-raw-protocol.md:790` (and its `:799` sample tuple and
  `:801-803`, `:814-817` field lists),
  `skills/machine-readable-only/references/raw-protocol.md:790` (BY COPY),
  `docs/2026-09-01-mro-raw-protocol.html:831`

- [ ] **Step 1: Fix every consumer of the `TokenView` SHAPE**

Adding a field to `TokenView` changes the `viewOf` and `svg` selectors, so
every hand-written copy of that struct's type list is now wrong. Insertion
versus appending makes no difference here -- both selectors are derived from
the FULL component list -- which is why this step exists rather than a
struct reshuffle.

1. `warden/tools/absence-on-chain.mjs`: add `{ name: "echo", type: "uint32" }`
   after `parent` in `VIEW.components`, and `echo: 0` to the stub view. This is
   the tool CLAUDE.md names as the proof of C4.10 on the deployed Renderer; if
   it is not updated it will fail against the Task 8 redeploy with a selector
   that no longer exists.
2. The shipped `cast call` signature, in all four places listed above: add
   `uint32` after the `uint256` that is `parent`. This is the "read the
   contract yourself" command the protocol doc offers agents as its trust
   anchor, so a signature that cannot decode is high-visibility.
3. The positional field prose at `raw-protocol.md:799` and `:801-803`,
   `:814-817`. **Note `:814-817` is ALREADY stale independently of this
   plan** -- it omits `sunsetDay`, `fellRun` and `fellDay`, which Plan 6
   added. Fix that too while you are in there, and say so in the commit.

Verify the signature by running it, not by reading it:

```bash
cast call 0xe032054D54b407C52C49c40A423aC79031401C03 \
  '<the corrected signature>' 1 --rpc-url https://sepolia.base.org
```

Against the CURRENT deployed contract the corrected 18-type signature will
FAIL to decode, because that contract predates the Echo -- that is expected
and is the proof it changed. Re-run it after Task 8 and confirm it decodes.

- [ ] **Step 1b: Correct CLAUDE.md's gas-budget gotcha**

Task 3 re-measured every figure in that section and it is now wrong. The
replacement numbers are in section 9 of
`.superpowers/sdd/2026-09-06-mro-plan7-lineage-echo/task-3-report.md`; take them
from there rather than re-deriving.

Two things must survive the edit, because both have been got wrong in this file
before:

- **The dearest token and the largest token are DIFFERENT TOKENS.** Report each
  figure with the token it belongs to and never pair one's gas with the other's
  bytes.
- **Both worst cases are now CHILDREN**, which is new. Say so, because a reader
  who assumes a founding token is the worst case will mis-predict every future
  measurement.

- [ ] **Step 2: Document the wire change**

`seed` now returns `{ ok: true, tokenId, txStatus: "queued" }` where it
previously always returned `{ ok: false, reason: "seed-not-available" }`. The
`Echo` attribute is new in every tokenURI. Both are ADDITIVE; nothing is
removed. Say so plainly in the protocol doc, beside the other recorded wire
changes.

- [ ] **Step 3: Point section 10 at the design**

The deferred paragraph at the end of section 10 of the master spec is now
answered. Replace it with one sentence naming
`docs/specs/2026-09-06-mro-lineage-design.md` as the record. Do not delete the
history -- the reasoning about per-token seeding compounding stays.

- [ ] **Step 4: Re-copy the protocol doc into the skill BY COPY**

```bash
cd ~/projects/machine-readable-only
cp docs/2026-09-01-mro-raw-protocol.md skills/machine-readable-only/references/raw-protocol.md
```

**Never hand-patch the copy.** `tools/test/skill-doc.test.mjs:81` asserts byte
equality, and patching by eye satisfies a reader but not the guard. This
exact drift left the tools suite red for hours on 2026-09-06 --
[[a-red-guard-that-was-overridden]].

- [ ] **Step 5: Run the tools suite, which owns that guard**

```bash
source ~/.nvm/nvm.sh
cd tools && ~/scripts/safe-build.sh npm test 2>&1 | /bin/grep -E "^. (tests|pass|fail)"
```

- [ ] **Step 6: Commit**

```bash
cd ~/projects/machine-readable-only
git add llms.txt SKILL.md docs/ skills/
git commit -m "docs: the wire says a seed now lands, and what a child carries"
```

---

## Task 8: Redeploy to Base Sepolia

**Files:**
- Create: `contracts/script/DeployPlan7.s.sol`,
  `contracts/script/deploy-plan7.sh`, `contracts/script/verify-plan7.sh`
- Modify: `warden/src/clock/reconcile.mjs` (`DEPLOY_BLOCK`)
- Modify: `CLAUDE.md`, `llms.txt`, `SKILL.md` (the addresses)

**This task ends in an outward-facing action. Stop before Step 4 and get the operator's
approval.**

- [ ] **Step 0: Make ABI-vs-chain skew LOUD before you deploy anything**

Task 1b's review found that `read.mjs`'s decode `catch` is silent, so an ABI
that disagrees with the deployed contract is indistinguishable from an RPC
outage: both return null and both say `chain-unavailable`, with no log line
anywhere. That state is live on this branch right now, and it is strictly
worse than the bug Task 1b fixed -- the old defect broke `upgrade` and `seed`,
while a silent decode failure also takes out `tokenBlock`, `status`,
`/t/<id>`, `freeIdFrom` and therefore `mint`.

Two changes, both before the deploy:

1. **A boot-time probe in `warden/src/chain/preflight.mjs`** -- that file
   already checks the chain id against the RPC and the treasury's EIP-55
   checksum at startup, so this belongs beside them. Decode one real `viewOf`
   for a token known to exist. If it throws, REFUSE TO START with a message
   naming the ABI and the contract. Skew then fails at boot, loudly, instead
   of per request, silently.
2. **Distinguish the two failures at the call site.** In `read.mjs`, log a
   decode failure differently from a transport failure. It must NOT carry the
   RPC url -- see `redact.mjs` and [[rpc-url-in-logs]]; the viem decode error
   does not carry it, but check rather than assume.

Also close the guard gap the same review found: `warden/test/abi.test.mjs:31`
SKIPS when `contracts/out/` is absent, and that directory is gitignored. The
Warden's decoder now depends on `abi.mjs` being fresh, so make the deploy path
run `forge build` before the pin -- in `rehearse-start.sh` or DEPLOY.md -- so
the guard actually executes rather than skipping on a clean checkout.

- [ ] **Step 1: Write the deploy script from the working one**

Copy `DeployPlan5.s.sol` / `deploy-plan6.sh`, not from memory.
`DeployPlan5.s.sol` could not run at all because it called a bare
`vm.startBroadcast()` with no sender -- and it failed AFTER the simulation
passed, so it read like a wallet problem. Pass the key explicitly, as the two
working scripts do. See [[plan-code-is-a-draft]].

Every deploy script must STATE its chain.

- [ ] **Step 2: Prove deployability under a strict limit**

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts && forge build --sizes && bash script/anvil-size-check.sh
```

Expected: positive runtime margin, and a real deploy to plain `anvil` (NOT
`--disable-code-size-limit`) with non-empty `cast code`.

- [ ] **Step 3: Rehearse**

```bash
cd ~/projects/machine-readable-only
bash warden/tools/rehearse-start.sh
```

This runs the real `main.mjs` against a COPY of production state and is the
only thing that catches a bad boot check. 394 green tests once crash-looped
production because every suite opened a fresh database --
[[rehearse-the-deploy-not-the-tests]].

- [ ] **Step 4: STOP. Get the operator's approval before broadcasting.**

Report: the measured sizes, the rehearsal result, all four suite counts from
runs you just did, and that this supersedes
`0xe032054D54b407C52C49c40A423aC79031401C03` /
`0x48B6f41E0B8C4f38EBC67dfE57AeF18D553BC7f4`.

- [ ] **Step 5: Deploy, verify, and check the ABI against the chain**

After approval: deploy, Basescan-verify, then match SELECTORS against the
deployed runtime bytecode. The deployed ABI drifting from the code is how
every Mark became unwritable, and only reading the bytecode found it.
`warden/tools/read-ladder.mjs` exits non-zero on a mismatch rather than being
eyeballed; do the same here for `seed` and `echoOf`.

- [ ] **Step 6: Update `DEPLOY_BLOCK` and the addresses**

Set the new deploy block in `warden/src/clock/reconcile.mjs`. The Clock checks
it at STARTUP and refuses without it. Update the addresses in `CLAUDE.md`,
`llms.txt` and `SKILL.md`, restart with `pm2 restart mro-warden` after backing
up `state.db` to `~/backups/state.db.<UTC timestamp>`, and verify the new
copy THROUGH CLOUDFLARE rather than assuming it.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/machine-readable-only
git add contracts/script/ warden/src/clock/reconcile.mjs CLAUDE.md llms.txt SKILL.md
git commit -m "deploy: the chain carries the Echo"
```

---

## What this plan does NOT do

- **No mainnet.** Base Sepolia only. Mainnet is a separate operator gate.
- **No child-specific narrative in the token name.** Section 9 of the spec
  leaves it deliberately.
- **No daily-post integration.** Unbuilt and credential-blocked.
- **No re-solve of existing bitmaps.** Every QR must be re-solved against the
  real domain before any MAINNET mint, which is a launch task and not this
  one. Sepolia tokens stay as they are because they are testnet.
