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

---

## Task 8: `MROSpikeToken`, the size guard and the gas budget

Every number above was measured on the renderer alone, with its `TokenView`
already sitting in memory. A marketplace does not do that: it calls
`tokenURI(id)` on the token contract, which must read storage and build the
struct before the renderer sees anything. This section is that call.

`MROSpikeToken` is not the collection. It has no Warden, no x402, no mark
gating, no seeding rules, no pause and no vouchers, because none of those
change the cost of drawing. Two things are faithful to the spec on purpose,
because both move the number: the `Token` struct occupies exactly one 256-bit
slot, and the code bitmap is written once at mint and never rewritten.

### Gas and bytes, through the token contract

Cold storage, one token id per stage so no stage warms another's slots.
Reproduce with:

```
cd contracts && forge test --match-test test_theWholeLadderStaysInsideTheHardLimit -vv
```

| Stage | Gas | Bytes |
|---|---|---|
| Day one | 1,345,244 | 8,790 |
| Day 200 | 1,455,429 | 8,795 |
| Whole, one ring | 1,346,323 | 8,849 |
| Whole and lapsed | 1,347,406 | 8,848 |
| Three years | 1,382,351 | 9,078 |
| Ten years, at the ring cap | 1,482,032 | 9,715 |
| Ring cap and every Mark | 1,501,846 | **10,066** |
| Sealed at rest | 1,386,330 | 9,081 |
| **Day 364, every Mark** | **1,582,582** | 9,187 |

**The spike fits.** Against the 2,000,000 gas / 20,000 byte hard limit that
leaves **417,378 gas and 9,934 bytes**.

**The 1,000,000 gas / 5,000 byte target is missed** and is reported as missed.
Two assertions in `GasBudget.t.sol` now fail loudly if it ever starts passing,
so this table cannot quietly go stale.

The dearest stage and the largest stage are different tokens, so each limit is
tracked against its own worst case rather than one being reported from the
other's.

### The worst case is the day before the heart seals

This is the opposite of what the budget was planned around, and it was found by
sweeping levels rather than by reading the code.

The day frame is drawn as two paths, lit and ghost. At level 364 there are 364
lit cells with 12 ghost ones threaded through them, so both paths fragment into
many short runs. At 365 the ghost path vanishes entirely and the lit one seals
into a handful of long runs.

| Level (every Mark worn) | Gas |
|---|---|
| 352 | 1,569,688 |
| 358 | 1,572,019 |
| 361 | 1,576,407 |
| 364 | **1,582,582** |
| 365 | 1,372,891 |
| 366 | 1,374,236 |
| 730 | 1,397,002 |

**The seal is worth 213,666 gas.** Pinned by
`test_theWorstCaseIsTheDayBeforeTheHeartSeals`.

Rings cannot compound this. The frame fills to `min(level, 365)`, so a partial
frame implies `level < 365`, which implies zero rings. The two expensive cases
are mutually exclusive, which is why the ring cap is not the ceiling.

### What the token contract itself costs

| | Gas |
|---|---|
| `tokenURI` through the token contract | 1,497,085 |
| Renderer alone, view already in memory | 1,487,677 |
| **Storage read and struct assembly** | **9,408** |

This was the one quantity Task 8 existed to find. The plan estimated 20,000 to
30,000; the real figure is under a third of that, because the packed single
slot means the six `uint32`s and the `resting` flag are one `SLOAD`, and the
172-byte code bitmap is the only multi-word read.

### Contract size

`ContractSize.t.sol` reads the build artifacts; the limit is EIP-170's 24,576.

| Contract | Runtime bytes | Margin |
|---|---|---|
| `Renderer` | 11,772 | 12,804 |
| `MROSpikeToken` | 6,863 | 17,713 |

`Renderer` grew 821 bytes from Task 7's 10,951, which is the spec's full
attribute list plus the two name suffixes.

Foundry's test EVM does not enforce the code-size cap, so that table is
necessary and not sufficient. `contracts/script/anvil-size-check.sh` is the
other half: it deploys both to an anvil started with `--code-size-limit 24576`,
asserts non-empty `cast code` for each, mints a token with a bitmap from
`tools/token-bitmap.mjs`, and reads one real `tokenURI` back over RPC.

```
Renderer at 0x5FbDB2315678afecb367f032d93F642f64180aa3: 11772 runtime bytes
MROSpikeToken at 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512: 6863 runtime bytes
tokenURI: 8904 chars returned
OK
```

Both byte counts agree with the test exactly.

### The metadata gap, closed

The renderer emitted eleven attributes; the spec asks for thirteen and four did
not line up. All were closed, plus the two name suffixes the spec specifies:

| Attribute | Was |
|---|---|
| `heart` (`"212/365"`) | not emitted |
| `agentKeyId` | not emitted, though `TokenView` already carried the field |
| `parent` | not emitted, and there was no field to emit from |
| `children` | emitted under the name `Seeds Given` |
| name suffix | no `(Whole)` at 365 days, no `(At Rest)` once sealed |

Measured before and after on the same worst case, renderer alone:

| | Gas | Bytes |
|---|---|---|
| Before | 1,547,524 | 9,882 |
| After | 1,482,495 | 10,066 |

**The new attributes made the renderer 65,029 gas cheaper.** `_attributes` had
to be split into `_attrsA` and `_attrsB` because fourteen arguments to one
`abi.encodePacked` runs out of stack under the coverage profile, and two
smaller calls beat one large one by more than the four new attributes cost.
This is the third time on this spike that the expensive half was not the one it
looked like.

### Correctness

- 112 tests: 74 render, 34 `MROSpikeToken`, 3 gas budget, 1 size guard.
- Every owner function has an explicit test and every access-control revert has
  one, including the full `Ownable2Step` flow and the window where the old owner
  still holds control.
- 100% line, statement and function coverage on every file under `src/render`
  and on `src/spike/MROSpikeToken.sol`.
- Both build profiles run green. Gas ceilings are asserted only on the profile
  that ships: `forge coverage` cannot use the IR pipeline, so
  `[profile.coverage]` turns off `via_ir` and the optimiser, and the same source
  then costs roughly two and a half times as much. Asserting a gas ceiling
  against that build measures the profile, not the contract.

### One bug found by a test rather than by review

The spec stores sunset as `sunsetDay == 0 means not sunset`. That sentinel works
only because the piece does not launch on 1 January 1970 -- and it fails outright
in a test, where the chain clock starts at timestamp 1 and `today()` is genuinely
0. An explicit `isSunset` flag removes the ambiguity at no cost, since a `uint32`
and a `bool` share one slot. `test_sunsetOnDayZeroIsStillSunset` pins it, and
the spec should be amended in Task 12.

### What Task 8 leaves open

- **Pulse's `animation_url` is still unbudgeted and unbuilt.** Unchanged from
  Task 7. It roughly doubles tokenURI bytes and needs measuring separately.
- **`touchRange` refuses the collection-wide catch-all**, and `sunset()`
  therefore emits no `BatchMetadataUpdate` at all, because this contract does
  not track its own id range. The real contract must emit over the ids it
  actually minted; that is a Plan 2 requirement, recorded here so it is not
  lost.

---

## Task 9: deploy script, local run, end-to-end decode

Everything above was measured inside Foundry. A `forge` test never crosses the
RPC boundary, so it cannot show that a node returns the call at all, and it
cannot rasterise the SVG and put a decoder on it. **"The image renders" and "a
decoder reads the image a chain returned" are different claims**, and only the
second one matters for an art piece whose subject is a scannable code.

`contracts/script/anvil-verify.sh` is the whole check in one command: start an
anvil with `--code-size-limit 24576`, run `DeploySpike.s.sol`, then read each
token's `tokenURI` back over JSON-RPC with viem, base64-decode the SVG out of
it, rasterise with resvg and decode with ZXing.

### Result: four for four

| Token | State | Gas over RPC | URI bytes | SVG bytes | Scan |
|---|---|---|---|---|---|
| 1 | Day one | 1,395,460 | 8,793 | 6,000 | OK |
| 2 | Level 200, Vein + Bloom | 1,497,120 | 8,852 | 6,028 | OK |
| 3 | Whole, one year, every Mark that draws | 1,453,533 | 9,417 | 6,422 | OK |
| 4 | **Level 364, every Mark -- the worst case** | **1,580,070** | 8,840 | 5,995 | OK |

Each token decoded to **its own** URL, not merely to something well-formed --
`verifyToken` fails a token whose code scans cleanly to the wrong id, which is
a failure mode a plain "did it decode" check would pass.

The RPC figures run a little above the Foundry ones because `eth_estimateGas`
includes the 21,000 intrinsic cost and the calldata. Token 4 measured 1,580,070
here against 1,582,582 in `GasBudget.t.sol` -- the two agree to within 0.2%,
which is the useful result: **the test EVM was not flattering the number.**

No provider cap was hit, but a local anvil applies none. That is what Task 10
on Base Sepolia is for.

### What the verifier checks

`tools/verify-tokenuri.mjs`, exercised by `tools/test/verify-tokenuri.test.mjs`
(7 tests, no chain needed) and by the anvil run above:

- `decodeTokenUri(uri)` splits the URI and **parses** the JSON rather than
  regexing it, which is what proves a raw `#` has not truncated the payload.
- The image must be a `data:image/svg+xml;base64,` payload that decodes to a
  complete `<svg>...</svg>`.
- `scanResult` from `tools/test/helpers/decode.mjs` -- the same and only decode
  oracle the rest of the suite uses. Importing it rather than copying it is the
  point: two definitions of "it scans" is exactly the failure this project had
  once, when jsqr and a real phone disagreed.
- The decoded destination must equal `https://<domain>/t/<id>`.
- A PNG of what the chain returned is written to `tools/out/token-<id>.png`,
  for the OpenSea comparison in Task 11 -- their flattened PNG has to be checked
  against ours, not against the SVG.

### The bitmaps are generated, not hand-copied

Each token's code encodes its own URL, so the four bitmaps cannot be shared and
cannot be invented. `tools/spike-bitmaps.mjs` generates
`contracts/script/SpikeBitmaps.sol` from the same generator the renderer tests
use, carrying the `GENERATED` header this project's convention requires. Four
344-character literals pasted into a deploy script by hand would be unreviewable.

| Token | Mask | Heart match |
|---|---|---|
| 1 | 7 | 64.9% |
| 2 | 4 | 64.5% |
| 3 | 1 | 64.5% |
| 4 | 4 | 64.5% |

### Looked at, not only measured

Day one renders as the muted `#70575f` start tier with the frame a pale ghost
outline carrying exactly one lit cell. The heart is fully drawn from day one --
it is the code -- and the frame is the thing that accumulates, which is what
makes a stalled token still look like a finished object.

Token 4 at the other end: gold Crown frame with a single pale notch where it is
one day short of sealing, cream Voice quiet zone, Halo field, Bloom gradient on
the heart. All five drawing Marks are distinguishable at a glance.
