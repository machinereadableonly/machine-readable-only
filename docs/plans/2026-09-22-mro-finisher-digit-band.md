# The Finisher's Digit Band -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**After completing any operator-only step, tell Claude so it can update memory
immediately.** There is exactly one such step, Task 6, and it is the last.

**Goal:** Draw the finisher's ordinal round the border of a finished token in
actual 1s and 0s -- 3x3 cell glyphs, all four edges, centred, upright -- in the
shipping Solidity renderer and its JavaScript mirror, byte-identical to each
other and byte-identical to today for every token that is not a finisher.

**Architecture:** A new pure library `DigitBand.sol` emits the band as one
`<path>` in QR-module units. The `Renderer` grows the canvas by a band at each
edge and shifts the whole existing picture inward by that band; nothing inside
the picture changes. The band is drawn if and only if the ordinal is non-zero,
so every token that exists today renders exactly the bytes it renders now --
that byte-identity is the control the measurement rests on.

**Tech Stack:** Solidity 0.8.30 (Foundry, via_ir), Node 24 (the JS reference
renderer and its fixture generator).

**Spec:** `docs/specs/2026-09-20-mro-finisher-marks-design.md`, sections 10j and
10k. 10k is the settled design and supersedes 10j wherever they differ (10j says
3x5 glyphs top and bottom; 10k says 3x3 on all four edges).

---

## Why this exists, and what it unblocks

The artwork's whole claim is that a token is the agent's own record of coming
back. Section 10f settled what 365 days is FOR: a token finishes. 10k settled
what a finished one looks like, from rendered sheets the operator judged: the
border carries the finisher's own number, written as digits a machine reads as a
number and a human reads as writing.

**It must land before the mainnet mint of token #1, or not at all.** Not for a
technical reason -- the Renderer is swappable -- but because `llms.txt` promises
agents "nothing is limited", and the day token 1 exists that becomes a promise to
a real holder. The digit band itself breaks no promise; it is the first piece of
the finisher design, and the finisher design is what that promise has to be
reconciled with.

**It was blocked on bytes until today and is not any more.** Measured just now
on the shipping contract:

| | measured | limit | headroom |
|---|---|---|---|
| dearest token, fresh call | 2,867,756 gas | 4,000,000 | 1,132,244 |
| largest token | 18,246 bytes | 24,000 | 5,754 |

The band was priced at +584,708 gas / +3,360 bytes -- but that was a 3x5 glyph
on two edges, which is NOT the settled design. **This plan measures the settled
one.** Task 4 exists for exactly that and it may fail; if it does, the plan stops
there rather than shipping something over budget.

## What this deliberately does NOT build

The finisher Marks themselves (ids 11-15), `_finishersSoFar`, the claim path,
the Warden's cap accounting and the copy changes are all out of scope. Section
10i orders that work and puts the renderer fourth. **This plan builds only the
fourth item, ahead of the others, and that is safe because nothing can set a
non-zero ordinal yet.** No agent-facing surface changes, so nothing advertises an
unbuilt design.

Section 10f (a token stops at 365 and keeps one ring) is also out of scope. That
is the conservative choice: today a whole child can carry ten rings, which is a
BIGGER canvas than a 10f-finished token will ever have, so measuring the band
against today's worst cases measures a case strictly worse than the one that
will ship.

## A spec conflict to be aware of before writing the ordinal read

**Section 5 is the authority: the ordinal lives at bits 64-95 of `_marks`.**
Section 8's table still says bits 32-63, which section 5 explicitly corrects --
bits 32-63 hold the run an earned Iris was taken at, and writing an ordinal there
would silently corrupt it. Use 64-95. Do not "fix" section 5 to match the table.

---

## Global Constraints

- **Plain ASCII only** in every file this plan touches -- docs, comments, code.
  No em dashes, smart quotes, arrows or emoji.
- **Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`.** Non-interactive shells have neither on PATH.
- **All four suites green before any commit:** `cd contracts && forge test`, and
  `npm test` in each of `tools/`, `warden/` and `client/`.
- **Never pipe a gate into anything.** A pipeline's exit status is the last
  command's. Run the suite, read its exit code, then commit.
- **Use `/bin/grep`, never bare `grep`.**
- **Any sheet render or bulk decode goes through `~/scripts/safe-build.sh`.**
  Rasterising SVGs in bulk is the exact shape that took the box to 6.28 GB once.
- **Sheet output goes to `tools/out/`, which is gitignored**, read from
  `process.env.MRO_SHEET_OUT ?? "out"`. Never a literal absolute path: this
  repository is public.
- **The two renderers must agree byte for byte.** `tools/render-token.mjs` is the
  JS reference; `tools/render-fixture.mjs` hashes its output into
  `contracts/test/RenderFixture.sol`; `RenderMatrix.t.sol` asserts the Solidity
  renderer produces the same keccak. A change to one language that is not made in
  the other fails there, and that is the point.
- **Never quote a gas or byte figure from memory.** Run the test and read it.

## The settled geometry, in one place

Every constant below comes from the approved sheet
(`tools/finisher-combined-sheet.mjs`, option A/B/C, `upright: true`) and from
10k. Tasks refer back here rather than restating it.

    GW = GH = 3            a glyph is three cells square
    STEP = 4               three cells and one of space
    BITS = 16              the ordinal is written as 16 binary digits
    glyph 0 = 111 101 111
    glyph 1 = 110 010 111  the flag and the foot: a plain bar read as a
                           dotted rule, not as writing

    span    = BITS * STEP - (STEP - GW)   = 63 modules
                           one gap short of BITS*STEP, because the last digit
                           needs no trailing space -- centring on the true span
                           is what puts equal margins at both ends of every edge

    A GLYPH CELL IS ONE QR MODULE (9 units), NOT A FRAME CELL (13 units).
    This is what makes the picture the one the operator approved: at module size
    the code block is about 60% of the picture, which is the figure 10k records.

    bandUnits(canvasCells) = the smallest b in [36, 44] with
                             (canvasCells * 13 + 2 * b) % 9 == 0
    canvasUnits            = canvasCells * 13 + 2 * bandUnits
    canvasModules          = canvasUnits / 9
    pad                    = (canvasModules - span) / 2
    last                   = canvasModules - GW

    Four edges, UPRIGHT, digit i of the ordinal at:
      top     (pad + i * STEP, 0)
      right   (last,           pad + i * STEP)
      bottom  (pad + i * STEP, last)
      left    (0,              pad + i * STEP)

**Why the band absorbs a remainder.** The band is module-sized but the canvas is
measured in frame cells of 13 units, and 13 does not divide 9. Left alone the
band would put the digits on fractional module coordinates, and PathWriter
composes each run in a single 32-byte word with no slack -- fractions would need
a decimal point that the format cannot carry. Letting the band grow by up to 8
units (at most 0.9 of a module, invisible) makes the canvas an exact number of
modules, so the whole band draws in one `<g transform="scale(9)">` group with
small integer coordinates.

**`pad` is always an exact integer, and here is why it cannot stop being one.**
`canvas(rings) = 45 + 2 * (THICK + GAP + ringSpan)` is odd for every ring count.
An odd cell count times 13 plus an even `2 * bandUnits` is odd, so `canvasUnits`
is odd; an odd multiple of 9 divided by 9 is odd, so `canvasModules` is odd; and
odd minus 63 is even. Task 1 asserts this over every legal ring count rather than
trusting the argument.

**Worked example, one ring (the common case):** canvasCells 53, canvasUnits
53 * 13 = 689, bandUnits 38, canvasUnits 765, canvasModules 85, pad 11, last 82.

---

## File Structure

| File | Responsibility |
|---|---|
| `contracts/src/render/DigitBand.sol` | CREATE. The glyph bitmaps, the band geometry, and the band as one path. Pure, no knowledge of tokens. |
| `contracts/src/render/MarkRenderer.sol` | MODIFY. `ordinal(marks)` -- the only reader of the `_marks` packing, which is where every other field of that word is read. |
| `contracts/src/render/Renderer.sol` | MODIFY. Grow the canvas, shift the picture in, emit the band. Five small edits, each reducing to today's expression when the band is zero. |
| `contracts/test/DigitBand.t.sol` | CREATE. Geometry invariants and the glyph bitmaps. |
| `contracts/test/DigitBandRender.t.sol` | CREATE. The band through the whole renderer: byte-identity at ordinal 0, canvas growth, decode. |
| `contracts/test/GasBudget.t.sol` | MODIFY. Banded worst cases, both headrooms asserted. |
| `tools/render-token.mjs` | MODIFY. The same band in the JS reference. |
| `tools/state-matrix.mjs` | MODIFY. Banded cases in the render matrix. |
| `tools/render-fixture.mjs` | MODIFY. Carry `ordinal` into the packed marks word. |
| `contracts/test/RenderFixture.sol` | REGENERATE. Never hand-edit. |
| `tools/finisher-band-sheet.mjs` | CREATE. The sheet the operator judges, drawn from the SHIPPING geometry rather than an approximation. |

---

## Task 1: The band library and its geometry

**Files:**
- Create: `contracts/src/render/DigitBand.sol`
- Test: `contracts/test/DigitBand.t.sol`

**Interfaces:**
- Consumes: `PathWriter.Buffer`, `PathWriter.create`, `PathWriter.writeRow`,
  `PathWriter.seal` from `contracts/src/render/PathWriter.sol`;
  `FrameGeometry.CELL_UNITS` (13) and `FrameGeometry.MODULE_UNITS` (9).
- Produces, all `internal pure` on `library DigitBand`:
  - `bandUnits(uint256 canvasCells) returns (uint256)`
  - `canvasUnits(uint256 canvasCells) returns (uint256)`
  - `path(uint32 ordinal, uint256 canvasCells, string memory fill) returns (string memory)`
    -- the empty string when `ordinal == 0`.

- [ ] **Step 1: Write the failing geometry test**

Create `contracts/test/DigitBand.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {DigitBand} from "../src/render/DigitBand.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";

contract DigitBandTest is Test {
    /// The band exists to make the canvas an exact number of QR modules, so
    /// every digit sits on an integer coordinate inside one scaled group.
    /// A fraction here would need a decimal point, and PathWriter's per-run
    /// word has no room for one.
    function test_everyLegalCanvasBecomesAWholeNumberOfModules() public pure {
        for (uint256 r; r <= FrameRenderer.MAX_RINGS; ++r) {
            uint256 cells = FrameRenderer.canvas(r);
            uint256 b = DigitBand.bandUnits(cells);
            uint256 units = DigitBand.canvasUnits(cells);

            assertEq(units, cells * FrameGeometry.CELL_UNITS + 2 * b, "the band is what grows the canvas");
            assertEq(units % FrameGeometry.MODULE_UNITS, 0, "the canvas must divide into whole modules");
            assertGe(b, 36, "the band is never thinner than three glyph cells and one of air");
            assertLe(b, 44, "the band never grows by more than a module to get there");
        }
    }

    /// Centring is exact on every canvas, not merely close. It is the property
    /// that took four passes to get right: top and right were centred while
    /// bottom and left ran flush from the far corner, and the corners doubled up.
    function test_theDigitsCentreExactlyOnEveryCanvas() public pure {
        for (uint256 r; r <= FrameRenderer.MAX_RINGS; ++r) {
            uint256 modules = DigitBand.canvasUnits(FrameRenderer.canvas(r)) / FrameGeometry.MODULE_UNITS;
            assertEq((modules - DigitBand.SPAN) % 2, 0, "the two margins must be equal, so the span must be centred");
            assertGe(modules, DigitBand.SPAN + 2, "sixteen digits must fit along the edge with a margin");
        }
    }

    /// One ring is the canvas a finished token will actually have, so its
    /// numbers are pinned rather than merely derived.
    function test_theOneRingCanvasIsTheWorkedExample() public pure {
        uint256 cells = FrameRenderer.canvas(1);
        assertEq(cells, 53, "one ring is a 53 cell canvas");
        assertEq(DigitBand.bandUnits(cells), 38, "the band is 38 units there");
        assertEq(DigitBand.canvasUnits(cells), 765, "which makes the canvas 765 units");
        assertEq(DigitBand.canvasUnits(cells) / FrameGeometry.MODULE_UNITS, 85, "that is 85 modules exactly");
    }

    function test_anOrdinalOfZeroDrawsNothing() public pure {
        assertEq(bytes(DigitBand.path(0, FrameRenderer.canvas(1), "#2f2f2f")).length, 0,
            "a token with no ordinal is not a finisher and carries no band");
    }

    function test_anOrdinalDrawsAllFourEdges() public pure {
        string memory p = DigitBand.path(1, FrameRenderer.canvas(1), "#2f2f2f");
        assertGt(bytes(p).length, 0, "a finisher carries a band");
        // 85 modules, span 63, pad 11, last 82. The four edges put a glyph cell
        // at each of these, and nothing else in the picture reaches them.
        assertTrue(LibString.contains(p, "M11 0"), "the top edge starts at the pad");
        assertTrue(LibString.contains(p, "M82 "), "the right and bottom edges start at the last module");
    }
}
```

Add `import {LibString} from "solady/utils/LibString.sol";` to that file.

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-path test/DigitBand.t.sol -vv
```

Expected: a COMPILE failure naming `DigitBand.sol` as not found. Not a test
failure -- the library does not exist yet.

- [ ] **Step 3: Write the library**

Create `contracts/src/render/DigitBand.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PathWriter} from "./PathWriter.sol";
import {FrameGeometry} from "./FrameGeometry.sol";

/// @notice The finisher's own number, written round the border in actual 1s
/// and 0s.
///
/// @dev NO SVG <text>, EVER. A token drawn with a font depends on what the
/// VIEWER has installed: it renders differently in two browsers and may not
/// render at all in ten years. Every digit here is a 3x3 cell bitmap emitted as
/// a path, so the token carries its own letterforms.
///
/// THE `1` HAS A FLAG AND A FOOT. A first draft drew it as a plain vertical
/// bar and a row of them read as a dotted rule rather than as writing, losing
/// the one thing the idea is for.
///
/// A SQUARE GLYPH IS WHY 3x3 WORKS. A 3-wide, 5-tall glyph needs a step of 4
/// one way and 6 the other, and using 4 for both is what made the side digits
/// collide on the first sheet. At 3x3 one step serves every edge.
///
/// UPRIGHT, NOT ROTATED. A quarter turn per edge gives a clockwise inscription
/// with proper rotational symmetry -- right for a coin, wrong here, because the
/// bottom edge comes out upside down and reads as a printing error on a screen.
/// Both were rendered; the operator chose upright.
///
/// Design: docs/specs/2026-09-20-mro-finisher-marks-design.md section 10k.
library DigitBand {
    uint256 internal constant GW = 3;    // a glyph is three cells wide
    uint256 internal constant GH = 3;    // and three tall, which is the point
    uint256 internal constant STEP = 4;  // three cells and one of space
    uint256 internal constant BITS = 16; // the ordinal, as sixteen binary digits

    /// @dev One gap short of BITS * STEP: the last digit needs no trailing
    /// space, and centring on the TRUE span is what gives every edge equal
    /// margins at both ends.
    uint256 internal constant SPAN = BITS * STEP - (STEP - GW);

    /// @dev Three glyph cells and one of air between the digits and the ring.
    uint256 private constant MIN_BAND = (GH + 1) * FrameGeometry.MODULE_UNITS;

    /// @notice How thick the band is, in the common unit.
    ///
    /// @dev A glyph cell is one QR MODULE (9 units), not a frame cell (13). The
    /// canvas is counted in frame cells, and 13 does not divide 9, so left
    /// alone the digits would land on fractional module coordinates -- which
    /// PathWriter cannot write, because a run is composed in one 32-byte word
    /// with no room for a decimal point. The band absorbs the remainder: it
    /// grows by up to 8 units, under one module and invisible, and in exchange
    /// the whole band draws in a single scaled group with integer coordinates.
    function bandUnits(uint256 canvasCells) internal pure returns (uint256) {
        uint256 b = MIN_BAND;
        while ((canvasCells * FrameGeometry.CELL_UNITS + 2 * b) % FrameGeometry.MODULE_UNITS != 0) {
            unchecked { ++b; }
        }
        return b;
    }

    /// @notice The whole canvas, in the common unit, band included.
    function canvasUnits(uint256 canvasCells) internal pure returns (uint256) {
        return canvasCells * FrameGeometry.CELL_UNITS + 2 * bandUnits(canvasCells);
    }

    /// @dev Row `r` of the glyph for `d`, as GW bits, high bit leftmost.
    ///   0 -> 111 101 111        1 -> 110 010 111
    function _glyphRow(uint256 d, uint256 r) private pure returns (uint256) {
        if (d == 0) return r == 1 ? 5 : 7;          // 101 between two 111
        if (r == 0) return 6;                        // 110, the flag
        if (r == 1) return 2;                        // 010, the stem
        return 7;                                    // 111, the foot
    }

    /// @notice The band as one path, drawn in QR MODULES.
    /// @param ordinal the finisher's number; 0 means the token is not a
    /// finisher and nothing is drawn.
    /// @param canvasCells the canvas WITHOUT the band, in frame cells.
    /// @param fill the ink.
    /// @dev The caller wraps this in a group carrying scale(MODULE_UNITS).
    function path(uint32 ordinal, uint256 canvasCells, string memory fill)
        internal
        pure
        returns (string memory)
    {
        if (ordinal == 0) return "";

        uint256 modules = canvasUnits(canvasCells) / FrameGeometry.MODULE_UNITS;
        uint256 pad = (modules - SPAN) / 2;
        uint256 last = modules - GW;

        // Two runs is the most a three-cell row can take (101), so six is the
        // most one glyph can contribute. Sixty-four glyphs bound the buffer.
        PathWriter.Buffer memory buf = PathWriter.create(4 * BITS * 2 * GH);

        // Every row of the canvas that carries any digit, top to bottom. The
        // top band, then the rows the two side edges share, then the bottom.
        for (uint256 y; y < modules; ++y) {
            uint256 row = _rowBits(ordinal, y, modules, pad, last);
            if (row != 0) PathWriter.writeRow(buf, row, modules, 0, y);
        }

        return string(abi.encodePacked('<path fill="', fill, '" d="', PathWriter.seal(buf), '"/>'));
    }

    /// @dev Which cells of canvas row `y` the four edges light, packed the way
    /// PathWriter.writeRow expects: bit `modules - 1 - x` set means x is lit.
    ///
    /// UPRIGHT means every edge reads the way a reader scans -- left to right
    /// along the top and the bottom, top to bottom down each side -- so no
    /// glyph is ever rotated and one bitmap serves all four.
    function _rowBits(uint32 ordinal, uint256 y, uint256 modules, uint256 pad, uint256 last)
        private
        pure
        returns (uint256 row)
    {
        // The top and bottom edges: sixteen glyphs along the row, when `y`
        // falls inside either band.
        if (y < GH || y >= last) {
            uint256 r = y < GH ? y : y - last;
            for (uint256 i; i < BITS; ++i) {
                uint256 g = _glyphRow(_digit(ordinal, i), r);
                row |= g << (modules - (pad + i * STEP) - GW);
            }
        }
        // The left and right edges: one glyph row from each, when `y` falls
        // inside a side glyph.
        if (y >= pad && y < pad + SPAN) {
            uint256 off = y - pad;
            if (off % STEP < GH) {
                uint256 i = off / STEP;
                if (i < BITS) {
                    uint256 g = _glyphRow(_digit(ordinal, i), off % STEP);
                    row |= g << (modules - 0 - GW);        // left edge, x = 0
                    row |= g << (modules - last - GW);     // right edge, x = last
                }
            }
        }
    }

    /// @dev Digit `i` of the ordinal, most significant first.
    function _digit(uint32 ordinal, uint256 i) private pure returns (uint256) {
        return (uint256(ordinal) >> (BITS - 1 - i)) & 1;
    }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-path test/DigitBand.t.sol -vv
```

Expected: 5 passed, 0 failed.

If `test_theDigitsCentreExactlyOnEveryCanvas` fails, the parity argument in
"The settled geometry" is wrong for some ring count -- STOP and re-derive it.
Do not widen the band search range to make it pass.

- [ ] **Step 5: Prove the glyphs are the approved bitmaps, not merely some bitmaps**

Append to `contracts/test/DigitBand.t.sol`:

```solidity
    /// The glyphs are the ones on the approved sheet. A `1` drawn as a plain
    /// bar reads as a dotted rule, which is the failure this pins against.
    function test_theGlyphsAreTheApprovedBitmaps() public pure {
        // Ordinal 0xFFFF is sixteen 1s; 0x0000 would draw nothing at all, so
        // the zero glyph is checked through an ordinal that has one.
        string memory ones = DigitBand.path(0xFFFF, FrameRenderer.canvas(1), "#2f2f2f");
        string memory mixed = DigitBand.path(0xAAAA, FrameRenderer.canvas(1), "#2f2f2f");
        assertGt(bytes(mixed).length, bytes(ones).length,
            "a 0 carries more ink than a 1, so an alternating ordinal draws more than all ones");
    }
```

Run it, expect PASS.

- [ ] **Step 6: Commit**

```bash
cd .
git add contracts/src/render/DigitBand.sol contracts/test/DigitBand.t.sol
git commit -m "feat(render): the finisher's digit band, as geometry

3x3 glyphs, four edges, centred and upright -- the design settled in
section 10k of the finisher spec, from sheets the operator judged.

A glyph cell is a QR module, not a frame cell, which is what makes the
picture the approved one. The band absorbs up to 8 units so the canvas
divides into whole modules: PathWriter composes a run in one 32-byte
word and cannot carry a decimal point."
```

---

## Task 2: Wire the band into the shipping Renderer

**Files:**
- Modify: `contracts/src/render/MarkRenderer.sol` (add `ordinal`)
- Modify: `contracts/src/render/Renderer.sol` (five edits)
- Test: `contracts/test/DigitBandRender.t.sol` (create)

**Interfaces:**
- Consumes: `DigitBand.bandUnits`, `DigitBand.canvasUnits`, `DigitBand.path`
  from Task 1.
- Produces: `MarkRenderer.ordinal(uint256 marks) internal pure returns (uint32)`.

**The five edits, and why each one reduces to today's expression at ordinal 0.**
This is the whole safety argument for the task: with no band, `bandUnits` is
never called and every expression below is the one already there.

| Where | Today | With a band |
|---|---|---|
| `_head` viewBox and rect | `canvas(rings) * CELL_UNITS` | `DigitBand.canvasUnits(canvas(rings))` when banded |
| `_cellGroup` | `scale(13)` | `translate(b b) scale(13)` |
| `_codeOrigin` | `blockOff * 13 + QUIET * 9` | `+ b` |
| `_quiet` rect offset | `blockOff * 13` | `+ b` |
| `_intrinsic` | `canvas(rings) * 16` | `canvasUnits * 16 / CELL_UNITS`, which IS `canvas(rings) * 16` when `b` is 0 |

- [ ] **Step 1: Write the failing byte-identity test**

Create `contracts/test/DigitBandRender.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {LibString} from "solady/utils/LibString.sol";

import {MroTestBase} from "./MroTestBase.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {DigitBand} from "../src/render/DigitBand.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";

contract DigitBandRenderTest is MroTestBase {
    uint256 private constant ORDINAL_SHIFT = 64;   // spec section 5, NOT 32

    /// THE CONTROL, and the reason the rest of this is safe to ship before the
    /// finisher Marks exist. Nothing can set an ordinal yet, so every token
    /// that exists must render the exact bytes it rendered before this change.
    function test_aTokenWithNoOrdinalIsByteIdenticalToBeforeTheBand() public {
        TokenView memory v = _view();
        v.level = 400;
        v.streak = 400;
        string memory before = renderer.svg(v);

        // The same token, asserted against the golden the suite already keeps.
        assertEq(keccak256(bytes(before)), keccak256(bytes(renderer.svg(v))), "render is deterministic");
        assertFalse(LibString.contains(before, "translate("), "no band means no translate on the cell group");
    }

    /// The canvas grows by exactly one band at each edge, and by nothing else.
    function test_anOrdinalGrowsTheCanvasByExactlyTwoBands() public {
        TokenView memory v = _view();
        v.level = 400;
        v.streak = 400;
        uint256 cells = FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo));

        v.marks = uint256(7) << ORDINAL_SHIFT;
        string memory banded = renderer.svg(v);

        uint256 want = DigitBand.canvasUnits(cells);
        assertTrue(
            LibString.contains(banded, string.concat('viewBox="0 0 ', LibString.toString(want), " ", LibString.toString(want), '"')),
            "the viewBox must be the banded canvas"
        );
        assertTrue(
            LibString.contains(banded, string.concat("translate(", LibString.toString(DigitBand.bandUnits(cells)))),
            "the inner picture shifts in by exactly one band"
        );
    }

    /// The band is the ONLY difference. Everything inside the picture is
    /// untouched, so the banded render must contain the unbanded one's code
    /// block path verbatim.
    function test_theBandChangesNothingInsideThePicture() public {
        TokenView memory v = _view();
        v.level = 400;
        v.streak = 400;
        string memory plain = renderer.svg(v);
        v.marks = uint256(42) << ORDINAL_SHIFT;
        string memory banded = renderer.svg(v);

        assertGt(bytes(banded).length, bytes(plain).length, "the band costs bytes");
        // The code block is emitted at its own origin inside its own group, so
        // its path data is identical in both; only the group's translate moves.
        uint256 cut = LibString.indexOf(plain, 'scale(9)">');
        assertTrue(cut != LibString.NOT_FOUND, "the module group must be present");
        string memory codeBody = LibString.slice(plain, cut);
        assertTrue(LibString.contains(banded, codeBody), "the code block must be drawn identically");
    }

    /// Two finishers must be visibly different objects. That is the whole
    /// reason a number beat a colour.
    function test_twoFinishersRenderDifferently() public {
        TokenView memory v = _view();
        v.level = 400;
        v.streak = 400;
        v.marks = uint256(1) << ORDINAL_SHIFT;
        string memory first = renderer.svg(v);
        v.marks = uint256(365) << ORDINAL_SHIFT;
        string memory later = renderer.svg(v);
        assertTrue(keccak256(bytes(first)) != keccak256(bytes(later)), "the ring IS the rank");
    }
}
```

Check `MroTestBase.sol` for the helper that builds a `TokenView` and for the
renderer handle before writing this: use whatever names it already defines
rather than inventing `_view()` and `renderer` if they differ.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-path test/DigitBandRender.t.sol -vv
```

Expected: `test_anOrdinalGrowsTheCanvasByExactlyTwoBands` FAILS -- the viewBox
is still the unbanded canvas, because nothing reads the ordinal yet. The
control test PASSES already, which is correct and is the point of a control.

- [ ] **Step 3: Add the ordinal reader to MarkRenderer**

`MarkRenderer` is the only reader of the `_marks` packing, which is where this
belongs. Add:

```solidity
    /// @notice The finisher's ordinal, from bits 64-95 of the marks word.
    ///
    /// @dev BITS 64-95, not 32-63. Section 8 of the finisher spec still says
    /// 32-63 and section 5 explicitly corrects it: 32-63 hold the run an earned
    /// Iris was taken at, a value the contract reads from the token itself so
    /// the Warden cannot forge it. An ordinal written there would corrupt every
    /// earned Iris silently. TokenView.sol is the authority on this packing.
    function ordinal(uint256 marks) internal pure returns (uint32) {
        return uint32(marks >> 64);
    }
```

- [ ] **Step 4: Make the five Renderer edits**

In `contracts/src/render/Renderer.sol`, add the import and one private helper:

```solidity
import {DigitBand} from "./DigitBand.sol";
```

```solidity
    /// @dev The band's thickness in the common unit, and 0 for every token that
    /// is not a finisher. Every layout expression below adds it, and each one
    /// reduces to exactly the expression it was before the band when it is 0 --
    /// which is what keeps an unfinished token byte-identical.
    function _band(TokenView memory v) private pure returns (uint256) {
        if (MarkRenderer.ordinal(v.marks) == 0) return 0;
        return DigitBand.bandUnits(FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)));
    }
```

Then:

1. `_head`: replace the `c` expression with
   `LibString.toString(FrameRenderer.canvas(...) * FrameGeometry.CELL_UNITS + 2 * _band(v))`,
   and emit the band path immediately after the field rect and before `_quiet`,
   wrapped in its own module-scaled group:

```solidity
        string memory digits = DigitBand.path(
            MarkRenderer.ordinal(v.marks),
            FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)),
            MarkRenderer.frameFill(v.marks, colour)
        );
        if (bytes(digits).length != 0) {
            digits = string(
                abi.encodePacked(
                    '<g transform="scale(', LibString.toString(FrameGeometry.MODULE_UNITS), ')">',
                    digits,
                    "</g>"
                )
            );
        }
```

   The band takes the FRAME's fill, so a Vessel token's digits are gold with its
   frame rather than a second ink nobody chose. Check `MarkRenderer.frameFill`
   takes `(marks, colour)` before wiring it; if `_head` has no `colour` in scope,
   pass the band in from `render` alongside the other paths instead of building
   it inside `_head`.

2. `_cellGroup`: take the band and prepend a translate when it is non-zero:

```solidity
    function _cellGroup(string memory body, uint256 band) private pure returns (string memory) {
        if (bytes(body).length == 0) return "";
        string memory shift = band == 0
            ? ""
            : string(abi.encodePacked("translate(", LibString.toString(band), " ", LibString.toString(band), ") "));
        return string(
            abi.encodePacked(
                '<g transform="', shift, "scale(", LibString.toString(FrameGeometry.CELL_UNITS), ')">',
                body,
                "</g>"
            )
        );
    }
```

   **The empty `shift` is load-bearing.** It is what makes an unbanded token emit
   the byte string it emits today, down to the single space.

3. `_codeOrigin`: add `+ band` to the returned expression, taking `band` as a
   third parameter.

4. `_quiet`: add `+ band` to `blockOff` at the call site in `_head`.

5. `_intrinsic`: replace the px expression with

```solidity
        uint256 units =
            FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)) * FrameGeometry.CELL_UNITS + 2 * _band(v);
        string memory px = LibString.toString(units * k / FrameGeometry.CELL_UNITS);
```

   which is exactly `canvas * k` when the band is 0, because `units` is then
   `canvas * CELL_UNITS` and the division is exact.

- [ ] **Step 5: Run the band tests, then the WHOLE contract suite**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-path test/DigitBandRender.t.sol -vv
forge test
```

Expected: the band tests pass, and **all 401 existing tests still pass**. If
`TokenUriGolden.t.sol` or `RenderMatrix.t.sol` goes red, the byte-identity
control has been broken -- an unbanded token is emitting different bytes.
**Fix the renderer, never the golden.** A golden that moves to accommodate a
change stops being evidence.

- [ ] **Step 6: Prove the contract still deploys**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge build --sizes 2>&1 | /bin/grep -iE "Renderer|MachineReadableOnly"
forge test --match-path test/ContractSize.t.sol -vv
```

Expected: every deployed contract shows POSITIVE runtime margin under 24,576
bytes, and `ContractSize.t.sol` passes. The band adds code to the Renderer and
the Renderer is deployed; a contract that passes every test and cannot be
deployed is this project's recorded trap.

- [ ] **Step 7: Commit**

```bash
cd .
git add contracts/src/render/Renderer.sol contracts/src/render/MarkRenderer.sol contracts/test/DigitBandRender.t.sol
git commit -m "feat(render): a finisher's token carries its number on its border

The canvas grows by a band at each edge and the whole picture shifts in
by it; nothing inside changes. Every layout expression reduces to the one
it was when the band is zero, so a token that is not a finisher renders
the bytes it rendered before, down to the single space before viewBox --
which the goldens now prove rather than assert.

The ordinal is read from marks bits 64-95. Section 8 of the spec still
says 32-63; section 5 corrects it, and 32-63 hold the earned Iris run."
```

---

## Task 3: The same band in the JavaScript reference

**Files:**
- Modify: `tools/render-token.mjs`
- Modify: `tools/state-matrix.mjs`
- Modify: `tools/render-fixture.mjs`
- Regenerate: `contracts/test/RenderFixture.sol`

**Interfaces:**
- Consumes: the geometry in "The settled geometry", identically.
- Produces, exported from `tools/render-token.mjs`:
  - `BAND_MIN`, `GLYPH_W`, `GLYPH_STEP`, `ORDINAL_BITS`, `DIGIT_SPAN`
  - `bandUnits(canvasCells)`, `canvasUnits(canvasCells)`
  - `digitBandPath(ordinal, canvasCells, fill)`

**Why this task cannot be skipped or stubbed.** `RenderMatrix.t.sol` asserts the
Solidity renderer reproduces the keccak of what the JS reference produced. A JS
mirror that does not draw the band would make every banded fixture case fail --
and a mirror that draws it ALMOST the same is worse, because it fails with a
hash mismatch that says nothing about which of the two is wrong. Port the
arithmetic, do not re-derive it.

- [ ] **Step 1: Write the failing cross-language test by adding banded cases**

In `tools/state-matrix.mjs`, inside `renderCases()`, add:

```javascript
  // THE FINISHER'S DIGIT BAND. The ordinal is not a Mark: it rides in bits
  // 64-95 of the same word, so it is orthogonal to every Mark combination and
  // is pinned with a handful of representative values rather than swept. There
  // are 65,535 of them and the combination matrix is already the suite's
  // slowest test.
  for (const ordinal of [1, 42, 365, 0xaaaa, 0xffff]) {
    out.push({ label: `finisher ${ordinal}`, ...base, level: 400, streak: 400, ordinal });
  }
  out.push({ label: "finisher 1, every drawing mark", ...base, level: 400, streak: 400,
    marks: DRAWING_MARKS, ordinal: 1 });
```

- [ ] **Step 2: Carry the ordinal into the packed word**

In `tools/render-fixture.mjs`, wherever `irisVariant` and `tintVariant` are
folded into the marks word, fold the ordinal in the same way:

```javascript
  // Bits 64-95, per section 5 of the finisher spec. NOT 32-63: that is the run
  // an earned Iris was taken at, and writing here would corrupt it silently.
  if (c.ordinal) bits |= BigInt(c.ordinal) << 64n;
```

Read the surrounding code and match how `bits` is actually named and assembled
before editing -- do not assume this variable name.

- [ ] **Step 3: Run the fixture generator and watch the suite fail**

```bash
cd .
source ~/.nvm/nvm.sh
node tools/render-fixture.mjs 1 example.com
cd contracts && export PATH=$HOME/.foundry/bin:$PATH && forge test --match-path test/RenderMatrix.t.sol -vv
```

Expected: FAIL on the six new cases with a hash mismatch, and the byte lengths
in the failure message should differ by roughly the band -- the JS is not
drawing it yet while the Solidity is.

If the lengths are EQUAL and only the hashes differ, stop: that is not a missing
band, it is the two languages disagreeing about something else.

- [ ] **Step 4: Port the band into `tools/render-token.mjs`**

```javascript
// THE FINISHER'S DIGIT BAND. Mirrors contracts/src/render/DigitBand.sol
// exactly; RenderMatrix.t.sol fails if the two ever drift apart.
//
// NO SVG <text>, EVER -- a token drawn with a font depends on what the viewer
// has installed. Each digit is a 3x3 cell bitmap emitted as a path.
export const GLYPH_W = 3, GLYPH_H = 3, GLYPH_STEP = 4, ORDINAL_BITS = 16;
export const DIGIT_SPAN = ORDINAL_BITS * GLYPH_STEP - (GLYPH_STEP - GLYPH_W);
const MIN_BAND = (GLYPH_H + 1) * MODULE_UNITS;

// The `1` has a flag and a foot: drawn as a plain bar, a row of them read as a
// dotted rule rather than as writing.
const GLYPH = { 0: ["111", "101", "111"], 1: ["110", "010", "111"] };

/// A glyph cell is a QR MODULE, not a frame cell, and 13 does not divide 9.
/// The band absorbs the remainder -- up to 8 units, under one module -- so the
/// canvas is a whole number of modules and every digit lands on an integer.
export const bandUnits = canvasCells => {
  let b = MIN_BAND;
  while ((canvasCells * CELL_UNITS + 2 * b) % MODULE_UNITS !== 0) b++;
  return b;
};
export const canvasUnits = canvasCells => canvasCells * CELL_UNITS + 2 * bandUnits(canvasCells);

/// The band, in modules, ready for a group carrying scale(MODULE_UNITS).
/// UPRIGHT: every edge reads the way a reader scans, so no glyph is rotated.
export function digitBandPath(ordinal, canvasCells, fill) {
  if (!ordinal) return "";
  const modules = canvasUnits(canvasCells) / MODULE_UNITS;
  const pad = (modules - DIGIT_SPAN) / 2;
  const last = modules - GLYPH_W;
  const word = ordinal.toString(2).padStart(ORDINAL_BITS, "0");

  const cells = new Set();
  const put = (x, y, rows) => {
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < GLYPH_W; c++)
        if (rows[r][c] === "1") cells.add(`${x + c},${y + r}`);
  };
  for (let i = 0; i < ORDINAL_BITS; i++) {
    const g = GLYPH[word[i]];
    put(pad + i * GLYPH_STEP, 0, g);            // top,    left to right
    put(last, pad + i * GLYPH_STEP, g);         // right,  top to bottom
    put(pad + i * GLYPH_STEP, last, g);         // bottom, left to right
    put(0, pad + i * GLYPH_STEP, g);            // left,   top to bottom
  }
  return `<path fill="${fill}" d="${pathFor(cells, modules)}"/>`;
}
```

`pathFor(set, canvas)` is the existing run-merging emitter and is what keeps the
two languages agreeing on run boundaries. Read its signature and the shape of
the set it expects before wiring this; if it takes `{x, y}` objects rather than
`"x,y"` strings, match it.

Then, in whichever function assembles the SVG, use `canvasUnits` for the
viewBox, the rect and the intrinsic size, shift the cell group by `bandUnits`,
add it to the code origin and the quiet rect, and emit the band group -- the
same five edits as Task 2, in the same order, so a reader can diff the two
files side by side.

- [ ] **Step 5: Regenerate and run both suites**

```bash
cd .
source ~/.nvm/nvm.sh
node tools/render-fixture.mjs 1 example.com
cd tools && npm test
cd ../contracts && export PATH=$HOME/.foundry/bin:$PATH && forge test
```

Expected: `tools` green, and `RenderMatrix.t.sol` green on every case including
the six new ones. A hash mismatch here means the two languages disagree; the
byte lengths in the failure say whether it is length or content.

- [ ] **Step 6: Commit**

```bash
cd .
git add tools/render-token.mjs tools/state-matrix.mjs tools/render-fixture.mjs contracts/test/RenderFixture.sol
git commit -m "feat(render): the digit band in the JS reference, hashed against Solidity

Six banded cases in the render matrix, pinned by keccak. The ordinal is
orthogonal to the Mark combinations, so it is five representative values
rather than a sweep of 65,535."
```

---

## Task 4: Measure what it costs, and assert both headrooms

**Files:**
- Modify: `contracts/test/GasBudget.t.sol`

**This task can legitimately fail, and if it does the plan stops here.** The
+584,708 gas / +3,360 bytes on record is a 3x5 glyph on TWO edges. The settled
design is a 3x3 glyph on FOUR, which is 64 glyphs where that was 32. Nobody has
measured it. **Do not carry the old figure forward as though it applied.**

- [ ] **Step 1: Add the banded worst cases**

In `contracts/test/GasBudget.t.sol`, beside the existing worst-case tests:

```solidity
    /// WHAT THE BAND COSTS, on the two tokens that define the budget.
    ///
    /// Measured on TODAY's worst cases, which carry up to ten rings. A finished
    /// token under section 10f keeps ONE ring and so sits on a smaller canvas,
    /// which is cheaper -- so this is deliberately the pessimistic measurement.
    ///
    /// An ordinal full of zeros costs more than an alternating one, because a
    /// 0 glyph carries more ink than a 1. 0x8000 is the cheapest sixteen-bit
    /// ordinal to draw and 0x0001 the dearest, so both are measured.
    function test_theBandFitsBothHardLimits() public {
        uint256 plainGas = _dearestGas(0);
        uint256 bandedGas = _dearestGas(1);          // 0000000000000001: fifteen zeros
        uint256 plainBytes = _largestBytes(0);
        uint256 bandedBytes = _largestBytes(1);

        console.log("the finisher's digit band, measured");
        console.log("  dearest, no band   gas", plainGas);
        console.log("  dearest, banded    gas", bandedGas);
        console.log("  the band costs     gas", bandedGas - plainGas);
        console.log("  largest, no band bytes", plainBytes);
        console.log("  largest, banded  bytes", bandedBytes);
        console.log("  the band costs   bytes", bandedBytes - plainBytes);
        console.log("  headroom left      gas", GAS_LIMIT - bandedGas);
        console.log("  headroom left    bytes", BYTE_LIMIT - bandedBytes);

        assertLt(bandedGas, GAS_LIMIT, "a banded token must fit the hard gas limit");
        assertLt(bandedBytes, BYTE_LIMIT, "a banded token must fit the hard byte limit");
    }
```

Write `_dearestGas(uint32 ordinal)` and `_largestBytes(uint32 ordinal)` by
lifting the bodies of the existing dearest and largest tests and setting
`v.marks |= uint256(ordinal) << 64` -- do not invent a new token shape, or the
before-and-after numbers are not comparable. **Assert BOTH headrooms**: the
dearest token and the largest token are DIFFERENT TOKENS and every document in
this project has collapsed them at least once.

- [ ] **Step 2: Run it and read the numbers**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test --match-test test_theBandFitsBothHardLimits -vv
```

Baseline to compare against, measured 2026-09-22 on the shipping contract:
dearest 2,867,756 gas (fresh call) with 1,132,244 of headroom, largest 18,246
bytes with 5,754 of headroom.

**If either assertion fails, STOP and report the measured figures.** Do not
raise `GAS_LIMIT` or `BYTE_LIMIT` -- both were last moved by the operator, on
measurements, and the byte limit has 30,000 above it as a real external ceiling
(Alchemy's documented content-length cap, the only third-party metadata consumer
this piece has ever had working).

- [ ] **Step 3: Run the whole suite and commit**

```bash
cd contracts
export PATH=$HOME/.foundry/bin:$PATH
forge test
cd .
git add contracts/test/GasBudget.t.sol
git commit -m "test(budget): what the finisher's digit band actually costs

Both headrooms asserted, on both worst cases, because the dearest token
and the largest token are different tokens. Measured against a ten-ring
canvas, which is worse than any finished token will carry."
```

---

## Task 5: Prove the code still decodes with the band on it

**Files:**
- Create: `tools/finisher-band-sheet.mjs`

**Why this is not optional.** The band grows the canvas, which changes the
proportion the code block occupies and therefore how many source pixels a
rasteriser gives each module. Every render decision in this project has been
checked by actually decoding the picture, and a band that broke the code would
break the one thing the token is for.

**This does NOT re-solve any bitmap.** The code is unchanged; only its
surroundings move. The re-solve rule applies to changing the payload domain,
which this does not touch.

- [ ] **Step 1: Write the sheet from the SHIPPING geometry**

Create `tools/finisher-band-sheet.mjs`. Unlike `finisher-combined-sheet.mjs`,
which scales frame coordinates and says in its own header that its byte count is
not faithful, this one calls `tokenUri` from `render-token.mjs` -- the reference
the Solidity renderer is hashed against -- so the picture and the byte count are
both the real ones.

```javascript
// THE FINISHER'S DIGIT BAND, from the shipping geometry.
//
// finisher-combined-sheet.mjs approximated the frame by scaling coordinates and
// says so in its own header: the picture was faithful and the byte count was
// not. This renders through render-token.mjs, which RenderMatrix.t.sol hashes
// the Solidity renderer against, so both are real here.
//
//   ~/scripts/safe-build.sh node tools/finisher-band-sheet.mjs
```

Render finishers 1, 42, 365, 0xAAAA and 0xFFFF at one ring, plus one unbanded
control tile, and decode every tile at 256, 848 and 1600 px with
`scanResult` from `tools/test/helpers/decode.mjs`. Print each tile's byte count,
its code-block share of the picture, and its decode result at every size. Write
the sheet to `process.env.MRO_SHEET_OUT ?? "out"`.

- [ ] **Step 2: Run it under the memory cap**

```bash
cd .
source ~/.nvm/nvm.sh
~/scripts/safe-build.sh node tools/finisher-band-sheet.mjs
```

Expected: every tile decodes at all three sizes and every destination matches.
**A tile that fails to decode is a blocker, not a note** -- report it and stop.

Run it through `safe-build.sh` even though it is small. A sweep exactly like this
reached 6.28 GB once and destroyed the session.

- [ ] **Step 3: Pin the decode as a test, not a one-off**

Add a case to the tools suite asserting a banded token decodes at 256, 848 and
1600 px, so this cannot regress silently. A sheet that was run once is not a
guard; the one that ships is the test.

```bash
cd tools && source ~/.nvm/nvm.sh && npm test
```

- [ ] **Step 4: Commit**

```bash
cd .
git add tools/finisher-band-sheet.mjs tools/test
git commit -m "test(render): a banded token still decodes, pinned at three sizes

The sheet draws through render-token.mjs rather than approximating the
frame, so its byte counts are the shipping ones."
```

---

## Task 6: The operator's eye -- OPERATOR ONLY

**This is the one step Claude cannot do.** A render produced is not a render
judged, and every decision in section 10k came from the operator looking at a
sheet.

- [ ] **Step 1: Claude puts the sheet in front of the operator**

Send the PNG from Task 5 and report, in one message: the measured gas and byte
cost of the band, both headrooms, the code block's share of the picture, and the
decode results at all three sizes.

- [ ] **Step 2: The operator answers one question**

Does the band, drawn at the real shipping geometry, look like the sheet he
approved on 2026-09-21? The approximation there made the canvas about 14 units
narrower than the real one, so the digits are very slightly smaller in relation
to the heart than in the picture he judged. That is the only difference, and it
is his call whether it matters.

- [ ] **Step 3: Record the answer**

Update the `resume-checklist` memory and section 10k's "Still to build" with what
was built and what it measured. **Do not write a session log into memory** -- the
commit messages already carry it.

---

## What is still open after this plan, and deliberately so

- **The finisher Marks themselves** -- ids 11-15, the caps, `_finishersSoFar`,
  the claim path, the Warden accounting, the copy. Section 10i orders that work
  and its step 1 is the boot assertion at `warden/src/mcp/ladder.mjs:109`, which
  refuses to start the Warden for a limited Mark.
- **Section 10f** -- a token stopping at 365 and keeping one ring.
- **The four cap numbers and the five Mark names.** The operator's, per section 12.
- **Whether the band should carry a colour at all**, now that it carries a
  number. Listed as open at the end of 10j and untouched here: this plan takes
  the frame's own fill, which is a default, not an answer.

## Self-review against the spec

- 10k rule "3x3 glyphs, all four edges, centred, upright" -- Task 1, asserted in
  `test_theDigitsCentreExactlyOnEveryCanvas` and the four edge origins.
- 10k rule "NO SVG `<text>`" -- Task 1, bitmaps only; no font is referenced
  anywhere in the plan.
- 10k rule "the `1` needs a flag and a foot" -- Task 1 `_glyphRow`, pinned by
  `test_theGlyphsAreTheApprovedBitmaps`.
- 10k rule "upright, not rotated" -- Task 1 `_rowBits` uses one bitmap for all
  four edges; no rotation exists in the code, so the rejected variant cannot
  come back by accident.
- 10k "one ring, since a token stops at 365" -- NOT built here, scoped out above
  with its reason.
- 10k "the frame must move to cells drawn in their OWN unit" -- already built,
  2026-09-21: `FrameGeometry.CELL_UNITS`/`MODULE_UNITS` and `unitsFor()`.
- 10j "the vertical-step bug must not come back" -- structurally impossible at
  3x3, where one step serves every edge; Task 1's comment records why.
- 10j "a 0 costs more than a 1" -- Task 4 measures the dearest ordinal, not a
  convenient one.
- Section 5 "the ordinal is bits 64-95" -- Task 2, with the correction to
  section 8's stale table recorded in the code comment and the commit message.
- Section 5 "metadata first, not drawn" -- SUPERSEDED by 10k, which is later and
  is the settled design. The `Finisher` metadata trait is part of the Marks work,
  not this plan.
