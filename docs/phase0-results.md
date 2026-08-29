# Phase 0 rendering spike -- measured results

Started at Task 5 rather than Task 8, because the gas budget is the risk the
spike exists to retire and the first real number arrived here. Every figure
below is measured, not estimated.

Budget, from the spec: **1,000,000 gas / 5,000 bytes target, 2,000,000 gas /
20,000 bytes hard fail**, for the whole `tokenURI` call.

---

## Task 5: `CodeRenderer.paths`

The code block is roughly two-thirds of the image and, on these numbers, most of
the gas. Measured on token 1 of `example.com` at the year-zero offset: 894 dark
modules, 660 of them on the heart, merged into 372 runs.

### Gas

| Implementation | Gas | Note |
| --- | ---: | --- |
| Per-module reads, `DynamicBufferLib`, `LibString` | 3,198,702 | fails the hard limit outright |
| Rows read as words, buffer reserved up front | 1,699,273 | |
| Runs composed in a register, one `mstore` each | 1,872,623 | worse, see below |
| Run jumping with `LibBit.fls` | 1,201,275 | |
| The same source compiled `via_ir` | 693,747 | |
| Buffer sized for the worst case, plus an overflow guard | 714,651 | |
| Both classes written in one pass over the rows (Task 6 refactor) | **691,899** | shipped |

Floor with an empty code (both paths present, nothing drawn): **1,839**.
Worst case, a degenerate code of alternating modules -- 703 runs instead of 372,
which no real QR produces but the library must survive: **1,483,240**.

Three things are worth keeping from that table.

**The obvious implementation missed the hard limit by 60%.** Reading one module
at a time, allocating a string per coordinate and appending eight times per run
cost 3.2M gas for a picture that is 4.5 KB of text. None of that is visible in
the byte measurements, which is exactly why the resume checklist insisted this
number be taken at Task 5 rather than Task 8.

**Composing runs in a register made it worse before the scan was fixed.** That
step removed every per-run allocation and gas went UP by 173,000. The reason is
that allocation was never the bottleneck: a probe with run writing disabled
showed the bit-by-bit scan alone cost 954,000 gas, at roughly 350 gas for each
of its 2,738 iterations. Optimising the wrong half is only visible if each half
is measured separately, so both were.

**`via_ir` is worth 507,528 gas on identical source.** That is not a rounding
difference, it is 25% of the entire budget, and it is why `via_ir = true` is now
set in `foundry.toml`. See the note below on what it costs.

The last row bought memory safety for 20,904 gas. The buffer had been sized to
the measured path length, which a degenerate code -- alternating modules, 19 runs
per row -- would have overrun by roughly 8,000 bytes, writing into whatever
memory followed it. It is now sized to that worst case and guarded per run.

### Bytes

| Part | Bytes |
| --- | ---: |
| Heart path data | 2,495 |
| Noise path data | 1,970 |
| Element markup around them | 54 |
| **`paths()` total** | **4,519** |

Consistent with the 4,986 measured for the whole SVG in the Task 2 exploration,
which included the frame the code block does not draw.

### Contract size

Every render library is `internal` and inlines into its caller, so each measures
57 bytes of runtime with 24,519 bytes of margin. The harness contract that makes
`paths` externally callable for the gas report measures 1,923 bytes.

### Correctness

15 tests, all passing, including a byte-for-byte assertion that the Solidity
output equals the path data `tools/render-token.mjs` produces for the same
token. That test is what makes the assembly in this library safe to write: the
run finder, the row reader and the register composer are all checked against an
independent implementation rather than against themselves.

Line, statement, branch and function coverage of `CodeRenderer.sol` are all
100%.

---

## Task 6: `FrameRenderer`

The frame is one cell per credited day, filling from the top, plus one outline
ring per completed year. Unlike the code block it is not a fixed size: the rings
grow the canvas, so this is the only part of the image whose cost has to be
checked at the far end rather than at a typical value.

### Gas

| Token | Gas | Frame bytes |
| --- | ---: | ---: |
| Day zero, nothing earned | 240,986 | 1,259 |
| Day 200, part earned | 359,427 | 1,286 |
| Whole, one ring | 450,256 | 2,676 |
| Whole, three rings | 462,202 | 2,742 |
| Whole, eighty rings (the cap) | 990,983 | 5,938 |

Getting there took two steps, both measured rather than guessed.

**Reading the geometry constant word-wise saved 54,585 gas.** Sixteen cells fit
in one word, so the constant is read 24 times instead of 752. Useful, but far
smaller than expected -- a probe with the cell loop disabled showed the loop cost
479,958 gas in total, about 1,276 per cell, and only a tenth of that was the
byte indexing. The loop itself was the cost.

**Precomputing the frame as a row bitmap took the whole loop away.** A whole
frame lights every cell, so there is nothing to discover by walking them: the
generator now also emits `FrameGeometry.rows()`, 49 rows of bits, which the
renderer shifts into place directly. Below wholeness it walks only the days
actually earned and derives the ghost as the frame minus the lit, one XOR per
row rather than a second walk. Day zero fell from 510,920 to 240,986 and the
capped case from 1,254,078 to 990,983.

That matters because a token spends nearly all of its life whole, which was
precisely the case the first implementation handled worst.

### The ring cap

Rings are the only unbounded part of the image, so `MAX_RINGS` is set at 80.
Two independent measurements put the ceiling in the same place:

- **Bytes.** The reference renderer's tokenURI crosses 20,000 at 85 completed
  years: 84 measured at 19,932, 85 at 20,044. Eighty leaves 448 bytes of
  headroom.
- **The renderer.** A canvas row is held in one 256-bit word. Eighty rings make
  the canvas 211 cells; 107 would make it 265 and break that.

Past ten years the cost is close to linear, about 6,800 gas and 42 bytes per
additional year, which is recorded as a test so the right cap can be read off
the curve if it ever has to come down.

Eighty years is far beyond any plausible tenure, and the alternative to a cap is
a token that eventually cannot be rendered at all.

### Correctness

13 tests for the renderer and 7 for the geometry, including byte-for-byte
assertions against the reference renderer at three life stages, and a check that
the two representations of the frame -- the ordered cell list and the row bitmap
-- hold exactly the same 376 cells. Line, statement and function coverage of both
files is 100%.

---

## Both renderers together

| Token | Code | Frame | Total |
| --- | ---: | ---: | ---: |
| Day zero | 691,899 | 240,986 | 932,885 |
| Whole, one ring | 691,899 | 450,256 | 1,142,155 |
| Whole, eighty rings | 691,899 | 990,983 | 1,682,882 |

Against the 2,000,000 hard limit that leaves **317,118 gas at the ring cap** and
857,845 in the ordinary case, for the JSON envelope and the base64 wrapper that
Task 7 adds.

**The cap case is the one to watch.** If base64 and JSON come to more than
317,118 gas, `MAX_RINGS` comes down rather than anything else changing -- the
curve above says what each year is worth, so the new cap can be read straight
off it. The ordinary case has comfortable room either way.

## Build configuration change made here

`via_ir = true` in `[profile.default]`, for the 507,528 gas above.

The cost is that **`forge coverage` cannot use the IR pipeline**: optimised
output no longer maps back to source, so coverage either misreports or fails
with "stack too deep". This is a live, open Foundry issue
(foundry-rs/foundry#13001, still open January 2026), and the documented
`--ir-minimum` workaround does not always compile either.

Resolved with a second profile rather than by giving up either side:

```
FOUNDRY_PROFILE=coverage forge coverage
```

`[profile.coverage]` sets `via_ir = false` and `optimizer = false`. That is
sound because coverage measures which lines the tests reach, not how those lines
are compiled -- and this source compiles both ways, which the two gas figures in
the table above prove directly. Verified: coverage runs clean and reports 100%
on `CodeRenderer.sol`.

---

## What this leaves for the rest of the image

`tokenURI` still has to add the Marks, the JSON metadata and the base64 wrapper
around the SVG. Task 7 builds those.

| | Gas | Bytes |
| --- | ---: | ---: |
| Target | 1,000,000 | 5,000 |
| Spent by both renderers, ordinary token | 1,142,155 | 7,195 |
| Hard limit | 2,000,000 | 20,000 |
| Left against the hard limit, ordinary token | 857,845 | 12,805 |
| Left against the hard limit, at the ring cap | 317,118 | 10,062 |

**The 1,000,000 gas / 5,000 byte target is gone and should be recorded as
missed**, not nearly met: the two renderers alone exceed both halves of it. The
2,000,000 / 20,000 hard limit is the one that decides whether the spike passes,
and an ordinary token sits comfortably inside it.

The single open risk is the ring cap. An eighty-year-old token leaves 317,118
gas for base64 and JSON. If that proves too little, `MAX_RINGS` comes down --
`RingCurve.t.sol` records what each year costs, so the replacement value can be
read straight off the curve without re-deriving anything.

---

## Task 7: the wrapper, the Marks, and the ring cap

Measured 2026-08-28 and 2026-08-29 with three temporary probes (`B64Probe`,
`WrapperProbe`, `MarkCostProbe`), deleted once these numbers were recorded.
Every figure is the complete `tokenURI` for one token under `via_ir`.

### The encoding is settled: base64 the SVG, serve the JSON as utf-8

Three routes for the same token, measured at the old 80-ring canvas:

| Route | Bytes | Gas |
| --- | ---: | ---: |
| base64 SVG inside a utf-8 JSON | 14,780 | 2,375,511 |
| utf-8 SVG, percent-escaped | 11,139 | 5,846,742 |
| base64 SVG inside a base64 JSON | 19,804 | 3,210,443 |

Base64 wins on gas by a factor of 2.5 despite being the largest but one on
bytes, because a per-byte escape loop in Solidity costs far more than Solady's
word-wise encoder. The spec left this open pending the spike; the spike has
answered it.

A raw `#` cannot appear anywhere in the URI. The whole `tokenURI` is itself a
URI, so a raw hash starts the fragment and truncates the JSON -- measured,
`JSON.parse` fails at position 31. Base64 hides every `#` inside the SVG,
including Bloom's `url(#b)`; the only one left is in the name, written `%23`.

### The Marks are nearly free

Each Mark against a bare token, at the ten-ring cap:

| Mark | Gas delta | Bytes |
| --- | ---: | ---: |
| Vein | -739 | +6 |
| Halo | +3,021 | +6 |
| Crown | +4,419 | +7 |
| Voice | +4,601 | +83 |
| Bloom | +11,456 | +219 |
| All five together | +5,127 | +206 |

Vein and the combined figure measure below the sum of their parts because a
Mark substitutes one colour string for another of the same length; the
differences are noise, not savings. The point stands: Marks are colour
substitutions into paths that already exist, not new geometry.

### The ring cap: 80 did not fit, and would not have been worth it if it had

At the old cap the complete `tokenURI` with every drawn Mark came to
**2,434,094 gas**, over the 2,000,000 hard limit. The limit broke between 37 and
38 rings. Bytes were never the constraint -- even 80 rings came to 15,307.

Splitting the per-ring cost showed where it lived:

| Rings | Frame and rings | Code block |
| --- | ---: | ---: |
| 1 | 458,969 | 706,458 |
| 20 | 596,264 | 712,414 |
| 40 | 730,622 | 712,414 |
| 80 | 1,001,486 | 749,285 |

From 1 ring to 80 the frame grew by 542,517 gas and the code block by 42,827.
Ninety-three per cent of the cost was the frame renderer's own row walk, not the
larger canvas pushing coordinates up a digit.

That made a cheaper ring encoding look worth pursuing to defend a cap of 80.
Rendering the same token at every ring count (`tools/ring-sheet.mjs`) settled it
differently: the rings stop being *readable* long before they stop fitting.

| Rings | Canvas | Heart as % of canvas |
| --- | ---: | ---: |
| 0 | 51 | 88% |
| 5 | 69 | 65% |
| 10 | 89 | 51% |
| 20 | 91 (old geometry) | 49% |
| 80 | 211 (old geometry) | 21% |

An 80-ring token is a red field with a stamp in the middle, and it does not
decode at a 300px thumbnail at all. **The cap is now 10**, decided on that
evidence rather than on what fits.

### Making the rings countable cost more than the cap saved, until it did not

Rings drawn edge to edge merge into one slab of colour, so the year count cannot
be read off the image. Separating them with a blank cell fixed that and broke
the byte budget: away from a ring's own edge a row crosses every ring
separately, so ten rings put twenty one-cell runs on every row. The frame path
alone measured **20,531 bytes**, over the 20,000 limit for the whole `tokenURI`.

Rings are now emitted as four bars each, outside the row walk -- four runs per
ring whatever the canvas size. `GAP` guarantees a blank cell between the
innermost ring and the day frame, so no run here could ever have merged with a
frame run, and the differential test against the JS reference confirms no pixel
moved.

### Where the budget stands: Task 7 complete

Measured by `Renderer.t.sol` on the assembled contract, not by a probe. Run
`forge test --match-test test_theWorstCaseStaysInsideTheHardLimit -vv` to
reproduce.

| Token | Gas | Bytes |
| --- | ---: | ---: |
| Day one | 1,383,723 | 8,616 |
| Whole, one ring | 1,385,441 | 8,665 |
| Ten years, at the cap | 1,523,902 | 9,531 |
| **Cap and every Mark (worst case)** | **1,547,524** | **9,882** |

| | Gas | Bytes |
| --- | ---: | ---: |
| Target | 1,000,000 | 5,000 |
| Worst case | 1,547,524 | 9,882 |
| Hard limit | 2,000,000 | 20,000 |
| Left for the token contract | 452,476 | 10,118 |

**The 1,000,000 gas / 5,000 byte target is missed and is recorded as missed.**
The 2,000,000 / 20,000 hard limit has real headroom in every state, including
the worst one -- where the previous eighty-ring cap was over it outright.

These figures are slightly above the probe's because the assembled renderer
emits two things the probe did not: the `Sunset` attribute and the `Marks`
array.

### Correctness

- `Renderer.t.sol` diffs the complete `tokenURI` against
  `tools/render-token.mjs` across seven life stages -- day one, day 200, whole,
  whole and lapsed, the ring cap, every Mark at once, and a sealed token -- by
  keccak256 and byte length. Regenerate with `node tools/token-uri-fixture.mjs`.
- The lapse case caught a real divergence: the JS renderer had a lapse function
  it never called, so its image never paled while the contract's did.
- No raw `#` survives into the URI, asserted byte by byte on a Bloom token,
  whose `url(#b)` reference is the easiest one to leak.
- 100% line and statement coverage on every file under `src/render`.
- `Renderer` is 10,951 bytes with 13,625 bytes of margin, deployed to a local
  anvil and called back over RPC: `tokenURI` returned 9,974 bytes for a token at
  the cap wearing six Marks.

### What Task 7 leaves open

- **`TokenView` has no `parent` field.** The spec's attribute list wants one;
  the struct holds `generation` and `seedsGiven` only. Emitting an invented
  value would put a number on chain that nothing produced, so the renderer emits
  what the struct holds and the gap passes to the token contract in Task 8.
- **Pulse's `animation_url` is unbudgeted and unbuilt.** The spec wants an
  on-chain `data:text/html;base64` page carrying a second copy of the SVG plus a
  SMIL animation, which roughly doubles tokenURI bytes. Phase 0's job is the
  static image; this needs measuring separately before it is decided.
