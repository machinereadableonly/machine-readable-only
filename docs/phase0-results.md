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
| Buffer sized for the worst case, plus an overflow guard | **714,651** | shipped |

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

`tokenURI` still has to add the day frame and year rings, the Marks, the JSON
metadata and the base64 wrapper around the SVG.

| | Gas | Bytes |
| --- | ---: | ---: |
| Target | 1,000,000 | 5,000 |
| Spent by `CodeRenderer.paths` | 714,651 | 4,519 |
| Left for everything else | 285,349 | 481 |
| Hard limit | 2,000,000 | 20,000 |
| Left against the hard limit | 1,285,349 | 15,481 |

**The target is already tight and the byte target is effectively gone.** The
frame draws 376 cells against the code's 894, so on the code block's rate it
would cost roughly 290,000 gas on its own, which would land the pair at the
target with nothing left for JSON or base64. The hard limit has real room.

This is not a failure -- the spike's fail-over condition is 2,000,000 gas and
20,000 bytes, and both have margin. It does mean the 1,000,000 / 5,000 target
should be treated as lost rather than nearly met, unless the frame turns out
much cheaper per cell than the code block. That will be known at Task 6.
