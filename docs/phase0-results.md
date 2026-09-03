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

---

## Task 10: Base Sepolia

The one thing a local anvil cannot test is a **provider's `eth_call` gas cap**.
Anvil applies none. A public RPC does, and a `tokenURI` that only works locally
is not proven. That is the whole reason this task exists.

Deployed 2026-08-29 from a throwaway key, both contracts verified on Basescan:

| Contract | Address |
|---|---|
| `Renderer` | [`0x6fD68f65Be17F399cFc1799cA09bE8a765BCabD1`](https://sepolia.basescan.org/address/0x6fd68f65be17f399cfc1799ca09be8a765bcabd1) |
| `MROSpikeToken` | [`0x672a1555A19B4a5E2d12047543f8558C088c7AF8`](https://sepolia.basescan.org/address/0x672a1555a19b4a5e2d12047543f8558c088c7af8) |

### The answer: no cap was hit

All four tokens read back through Alchemy's public Base Sepolia endpoint, each
decoding to its own URL.

| Token | State | Gas via public RPC | On anvil | URI bytes | Scan |
|---|---|---|---|---|---|
| 1 | Day one | 1,405,809 | 1,395,460 | 8,793 | OK |
| 2 | Level 200, Vein + Bloom | 1,507,526 | 1,497,120 | 8,852 | OK |
| 3 | Whole, one year, every drawing Mark | 1,464,458 | 1,453,533 | 9,417 | OK |
| 4 | **Level 364, every Mark -- worst case** | **1,590,476** | 1,580,070 | 8,840 | OK |

The public figures sit about 10,000 gas above the local ones, uniformly -- the
L2's L1 data component, not anything about the contract. **The worst case is
1,590,476 gas against a 2,000,000 budget, and a real provider served it.**

Three claims that are now measured rather than assumed:

1. A provider will return a ~1.59M gas `eth_call`. No cap, no truncation.
2. A ~9,400-byte string comes back over JSON-RPC intact -- the SVG base64-decoded
   to a complete document and ZXing read the code out of every one.
3. The Foundry numbers were honest. Local and public agree to within 0.7%.

### Deployment cost

| Step | Gas | Cost (ETH) |
|---|---|---|
| `Renderer` deploy | 2,596,549 | 0.000016071 |
| `MROSpikeToken` deploy | 1,648,622 | 0.000009899 |
| Four mints | 1,064,480 | 0.000007293 |
| Nine state / mark / parent writes | 304,161 | 0.000002299 |
| **Total** | **5,613,812** | **0.000035562** |

At the Base Sepolia gas price of the day (0.0074 gwei). The useful number for
mainnet planning is the **gas**, not the ETH: deploying the pair costs about
**4.25M gas**, and a mint is **262,000 to 279,000**.

### Notes for whoever repeats this

- `DeploySpike.s.sol` reads `SPIKE_DEPLOYER_KEY` with `vm.envUint` rather than
  taking `--private-key`, so the key never passes through a shell where it would
  land in history. A real environment variable overrides the env file, which is
  how `anvil-verify.sh` substitutes anvil's own account for local runs.
- `cast call ... "(string)"` escapes the inner quotes of a returned string, so
  the naive `sed` that strips the outer pair leaves invalid JSON behind. Use
  `--json` and `jq -r '.[0]'`.
- `verify-tokenuri.mjs --file <path> <id> [domain] [gas]` checks a URI fetched
  by any other means. That exists so a provider URL carrying an API key never
  has to reach the Node process, and it is what Task 11 will use on OpenSea's
  own copy of the metadata.

---

## Task 10b: the accelerated state soak

Ten tasks in, the spike had rendered **four states on chain** out of a design
space with five tiers, four lapse bands, eleven ring counts, 366 heart fills,
five drawing Marks and three lifecycles. Four samples is a demonstration, not a
test, and Task 11 spends real money to ask OpenSea a question.

`tools/state-matrix.mjs` is the single definition of which states matter, shared
by all four sweeps so they cannot drift apart.

### Sweep A -- colour boundaries. 88 pairs. PASSES

Every tier threshold crossed with every lapse threshold, one step either side,
generated into `contracts/test/ColourFixture.sol` and asserted against `Palette`.
All 88 agree between the two renderers. Two properties are asserted rather than
assumed: a lapse can never produce an ink outside the tier ladder, and can never
move a token **up** it.

### Sweep B -- 32-state differential. PASSES

Every tier live and lapsed, seven ring counts including one past the cap, five
heart fills, each drawing Mark alone, all together, and both frozen lifecycles.
All 32 byte-for-byte identical to the JS reference. Widest is the ten-year token
at 9,715 bytes.

### Sweep C -- decode sweep. FAILED, then fixed

**This is what the soak was for.** A bare token stopped decoding at 1200px and a
fully marked one at 900px, while a plain black-on-white control of the same code
passed at every size to 1600.

Root cause: the code carries **two** inks and both must binarize as dark. The
heart ran 74 to 104 in luminance; the noise was a constant `#767676` at 118.
Once a raster is large enough that ZXing's 8x8 blocks fall inside a single
module, a block has no local contrast and resolves against its neighbours -- and
the lighter ink goes to background.

**It is the gap, not the darkness:**

| Heart luma | Noise luma | Gap | 1600px |
|---|---|---|---|
| 74 | 118 | 44 | FAIL |
| 74 | 74 | 0 | OK |
| 17 | 74 | 57 | FAIL |

A *darker* heart made it worse. The fix is a noise ink per rung, matched in
luminance to its tier, so the two separate by **hue alone**:

| Heart | Noise | Luma |
|---|---|---|
| `#70575f` | `#5f5f5f` | 95 |
| `#8e5566` | `#686868` | 104 |
| `#a83a55` | `#5e5e5e` | 94 |
| `#bd2242` | `#545454` | 84 |
| `#c8102e` | `#4a4a4a` | 74 |

The pairing is structural: `Palette` exposes rungs, and `Renderer` derives one
rung per token and takes both inks from it. `PaletteNoise.t.sol` asserts the
luminance match as a property, so adding a tier fails the suite unless its grey
is matched too.

Two consequences. The **start tier is subtler** -- hue alone now separates heart
from noise, which makes chroma load-bearing rather than decorative, and the test
pins chroma >= 20. And the **decode margin widened a long way**: `#f9eaef` used
to fail at 900px and was pinned as proof the quiet-zone tint had no room; it now
passes, as does everything to about `#d4aabb`. `#c294a8` is the new
counter-example.

After the fix: 80 decodes clean, five inks against four ring counts, bare and
fully marked, plus the eight extremes at five raster sizes each.

### Sweep D -- 26 states on Base Sepolia. PASSES, with one caveat

One token per state, all placed in a single broadcast, then every one read back
through the public RPC and decoded. One token per state rather than one token
cycled, because each token's code encodes its **own** url and reusing a bitmap
would weaken the destination check to nothing.

| Contract | Address |
|---|---|
| `Renderer` | `0x5A314CE605b3e6a571f7D89F3Ce14eA388Fd66cd` |
| `MROSpikeToken` | `0xfd8AaAc531b02fCA9Df5dDdAa97a78fF2b102190` |

**25 of 26 decoded. Gas ranged 1,350,279 to 1,630,387; bytes 8,466 to 9,483.**
Every state fits the 2,000,000 / 20,000 hard limit through a real provider.

Sunset was applied last, on its own, because it is piece-wide and irreversible --
inside the batch it would have frozen the other twenty-five and every read after
it would have been wrong. Confirmed: `isSunset` true, the `Sunset` attribute
flips to yes, and the image **changes** as the colour freezes.

### The one failure: a rasteriser resonance, not the artwork

Token 12 failed to decode. Reproduced offline, then bounded:

- It fails at **exactly 700px** and passes at 250, 350, 500 and 900.
- Its QArt match is 65.4%, **better** than its neighbours -- not a weak solve.
- Canvas is 53 cells, so 700px is 13.208 px per module.

**Every exact multiple of the canvas passes** -- 10, 12, 13, 14, 16, 18 and 20
px per module all decode. Failures occur only at fractional ratios, and only at
narrow resonances: 13.208 and 14.151 fail while 13.396, 13.774 and 13.962 pass.
The cause is uneven module sampling when boundaries land on fractional pixels,
not anything about the colours.

Prevalence across all 26 bitmaps at five sizes: **one failure in 130**. The
exact-multiple size was clean for every token.

**What follows from it.** Where we control the raster -- our own PNG output, the
scan sheet, anything handed to a decoder -- render at an integer multiple of the
canvas. Where we do not, the risk is a rare, size-specific miss on a minority of
tokens, and a real camera's optical blur works against the artefact rather than
with it. This is worth re-checking on OpenSea's own flattened PNG in Task 11,
which is the one raster nobody here chooses.

### An operational finding worth keeping

A `tokenURI` read issued immediately after the sunset transaction returned the
**pre-sunset** state, and a read a minute later returned the correct one. A
public RPC load-balances, and a read can hit a node that has not yet processed
the write. Anything that writes and then verifies -- the Clock, the Warden, and
the ERC-4906 refresh timing in Task 11 -- has to poll rather than read once.

---

## Task 10c, Phase 1: the solver was picking the one fragile code out of eight

Task 10c exists because Task 11's premise was checked and found to be half
wrong. OpenSea has had no testnet since 23 July 2025 -- confirmed live,
`testnets.opensea.io` now 307-redirects to a shutdown notice -- but OpenSea is
not the only party that parses a `tokenURI` and rasterises an on-chain SVG at
dimensions it chooses. Alchemy's NFT API does, it runs on Base Sepolia, and it
is free. That reopened a large amount of testable ground before any real money
is spent.

**Corrected 2026-08-30.** This paragraph originally read "Alchemy's NFT API and
Basescan both do". The Basescan half is false: measured with
`tools/basescan-check.mjs`, Basescan ingests no `tokenURI` metadata at all on
Base Sepolia and renders no artwork for any collection there, ours or anyone
else's. Alchemy was the only third-party consumer this phase ever actually had.
See the Basescan section of
`docs/2026-08-29-mro-third-party-raster-finding.md`.

Phase 1 was meant to close a blind spot. It found a defect instead.

### First, the blind spot, which was real

`DECODE_SIZES` stopped at 900px. The palette bug sweep C found on 2026-08-29 did
not appear until **1200px** on a bare token; the diagnosis that pinned it went to
1600px by hand, but the standing sweep never followed. **The sweep that found the
bug could not have seen it come back.**

Extended to 1100, 1200, 1400 and 1600px: **72/72 clean**. The palette fix holds
where the bug it fixed actually lived, and the gap is closed.

### Then the cross sweep, which found the defect

Every previous decode sweep held one of two variables still. The offline sweep
rendered every state with token 1's bitmap; the Sepolia sweep gave each of 27
bitmaps a single state. Each token has its own QArt solve, so the module layout
differs per token -- which is how token 12 reached a live chain before anyone saw
it fail -- and the interaction had never been tested.

Twelve independent solves x five states x four third-party raster sizes, plus
each case at its own exact multiple as a control:

| | Decodes | Failures |
|---|---|---|
| Third-party sizes (256 / 500 / 1000 / 1080) | 240 | 3 |
| Exact multiples of the canvas | 60 | **0** |

Characterising the three failures across 31 raster sizes from 300 to 1800px,
against two healthy tokens as controls:

| Token | State | QArt match | Decoded |
|---|---|---|---|
| 1 | whole, 1 year | 64.9% | **31/31** |
| 3 | whole, 1 year | 64.5% | **31/31** |
| 12 | whole, 10 years | 65.4% | 29/31 |
| 55 | whole, 1 year | 64.2% | **25/31** |

Token 55 fails at 350, 500, 1000, 1150, 1300 and 1550px -- **one raster size in
five**, not the one-in-130 narrow resonance sweep D described. All four match
rates sit within 1.2 points of each other, so **heart match carries no signal
about robustness**: the number the solver was optimising cannot see this.

### The cause: the selector was choosing the fragile one

Solving each token against all eight masks and scoring fidelity and robustness
separately:

**Token 55** -- `bestOfAllMasks` chose mask 4.

| Mask | Match | Decodes | |
|---|---|---|---|
| 1 | 63.3% | 9/9 | robust |
| **4** | **64.2%** | **3/9** | **chosen; fails at 350, 500, 1000, 1150, 1300, 1550** |
| 7 | 62.7% | 9/9 | robust |

Seven of the eight masks were fully robust. **Token 12** was the same story: mask
4 chosen at 65.4%, failing at 700px, with mask 7 robust at 63.9%. Token 1, the
control, had all eight masks robust and was never at risk.

Mask 4 is **not** inherently bad -- it is the chosen, robust mask on 20 of the 27
soak tokens. That is why banning it was rejected as a fix: it would have been a
guess that cost fidelity everywhere to solve a problem in two places.

Two hypotheses were tested and rejected:

- **Antialiasing does not help.** Dropping `shape-rendering="crispEdges"` so
  module edges blur was tried on all three failures. All three still failed.
- **Controlling our own raster size does not cure it.** It only helps consumers
  that honour the SVG's intrinsic size; a CDN asked for 500px still makes 500px.

### The fix: robustness first, heart match second

the operator chose option A on 2026-08-29. `tools/robust-solve.mjs` now selects the
**highest-matching mask that survives a decode gate** -- five states x nine
raster sizes plus each state's exact multiple, 50 decodes per candidate. Masks
are tried in match order and the first survivor wins, so a healthy token pays for
exactly one gate run.

| Token | Was | Now | Cost |
|---|---|---|---|
| 1 | mask 7, 64.9% | mask 7, 64.9% | unchanged |
| 12 | mask 4, 65.4% | mask 7, 63.9% | 1.5 points |
| 55 | mask 4, 64.2% | mask 1, 63.3% | 0.9 points |

Token 1 is unchanged, which is why every generated fixture keyed to it -- the
render, colour, code-path, frame-path and tokenURI fixtures -- is byte-identical
and the 121 Solidity tests needed no regeneration.

**This costs no gas and changes no contract.** The bitmap is solved off chain and
passed into `mint()` as hex. But it is permanent per token: a fragile code, once
minted, is carried for the life of the piece, which is why the gate is stricter
than the failures strictly required.

`robustSolve` throws rather than returning a fragile code if no mask survives.
That has not happened on any payload measured.

### Two operational traps this turned up

- **`safe-build.sh` prints its banner on STDOUT**, not stderr. Appending a
  generator's stdout straight to a file mixes banner text into the data. Sieve by
  shape (`grep '^{'`). Same class of trap as `forge --json` printing "No files
  changed" first.
- **resvg's raster buffers are NATIVE memory.** `--max-old-space-size` does not
  bound them: a 27-token generation in one process sat at 2.0 GB and throttled
  against the memory cap without finishing, with the JS heap capped at 768 MB.
  Process exit is what frees them. `tools/spike-bitmaps.sh` therefore solves one
  token per process, and keeps its rows in `tools/out/spike-rows.jsonl` so a
  failed assembly does not cost the eight-minute solve again.

---

## Task 10c Phase 2: a rasteriser we do not own, and the intrinsic size

2026-08-29. Full write-up in
`docs/2026-08-29-mro-third-party-raster-finding.md`; this is the part that
belongs beside the budget.

### The first third-party limit anyone has measured

Alchemy's NFT API documents that a `tokenURI` response over **30,000 bytes**
returns "Contract returned a broken token URI, do not retry". Measured on the
live contracts, Alchemy stored our SVGs at 7,818 to 8,334 bytes and the whole
`tokenURI` worst case is 8,924. Not close, and the first real number from
outside this project to sit beside the self-imposed 20,000-byte limit.

| Limit | Source | Ours | Headroom |
|---|---|---|---|
| 2,000,000 gas | this project | 1,633,224 | 366,776 |
| 20,000 bytes | this project | 8,924 | 11,076 |
| 30,000 bytes | Alchemy, documented | 8,924 | 21,076 |

### The budget after adopting the intrinsic SVG size

The SVG now declares `width` and `height` at `canvas * 16`. Measured over RPC on
two live Base Sepolia contracts that differ in nothing else:

| Token | Unsized | Sized | Delta |
|---|---|---|---|
| 1, day one | 1,410,174 gas / 8,850 B | 1,411,606 / 8,882 | +1,432 gas, +32 B |
| 16, ten years | 1,501,957 / 9,431 | 1,501,259 / 9,467 | -698 gas, +36 B |
| **21, level 364 worst case** | 1,631,616 / 8,892 | **1,633,224 / 8,924** | +1,608 gas, +32 B |

About 1,600 gas and 32 bytes. The worst case is still the day before the heart
seals, and it still passes the 2,000,000 / 20,000 hard limit while missing the
1,000,000 / 5,000 target -- which must keep being reported as missed.

### Why it was worth 32 bytes

Seven bitmaps x eight widths, decoded off **Alchemy's own flattened PNG** rather
than ours:

| Build | Failures | Rate | `pngUrl` renders at |
|---|---|---|---|
| unsized | 30 / 56 | 54% | 53px |
| sized | 2 / 56 | 3.6% | 848px |

With no declared size their CDN rasterises at the viewBox units -- 53 pixels,
one per cell -- then interpolates that bitmap up, reaching 170 to 208 grey
levels where the artwork has 3. Our own renderer at the identical width decoded
55 of the same 56, so the artwork was never the fault. A declared size moves
their single rasterisation to 848px first, leaving a downscale of a crisp
source.

### The ERC-4906 refresh did not happen

The most serious open item in Phase 0, and no contract change fixes it.

Token 1 was warmed in Alchemy's cache at Level 365, then moved on chain to Level
300. `setState` emits `MetadataUpdate(id)` after the write, in the order the EIP
requires, and a direct `tokenURI` read confirms the new state. Alchemy did not
update through **90 minutes of polling, `refreshCache=true` twice ten minutes
apart, and `invalidateContract`** -- and `timeLastUpdated` stayed frozen at the
pre-write read, so it was not re-reading at all.

This piece is defined as an image that changes as an agent returns. An indexer
that caches day one and will not re-read shows a frozen token. Stated honestly:
one token, one indexer, one window -- not proof that Alchemy never refreshes,
but enough that nobody should assume the refresh path works.

---

## Task 10c Phase 3: the rest of the matrix, a real domain, and Pulse

Phase 2 put seven bitmaps in front of Alchemy and adopted the intrinsic SVG
size on the strength of them. Seven is a demonstration. This phase finishes the
matrix, then answers the two questions Phase 0 had been carrying unbudgeted
since Task 7.

### The remaining 19 bitmaps: 26 of 26, clean

The full soak matrix has 26 states; Phase 2 drove 7 of them (ids 1, 2, 3, 5, 8,
12, 13). The other 19 were run here against
`0x12c82BCE6f64f797358031Caae3c9652bD5Bd209`, the adopted sized design, in five
batches of one process each.

**171 third-party decodes, zero failures.** Every state, at Alchemy's own
thumbnail and `/convert-png` plus eight constructed widths from 256 to 1600,
decoded to its own url, with our own render as the control at each width.

The grey-level column behaves exactly as Phase 2 described: their thumbnail and
`convert-png` come back at 3 levels, matching ours, while every constructed
`w_NNN` resize sits between 141 and 195. That is the CDN interpolating a
downscale of a crisp 848px source -- the harmless version of the mechanism that
broke 54% of decodes when the SVG declared no size. It is now a smoothing
artefact on top of a readable code rather than the code's destruction.

This does not extend to OpenSea, which remains unchecked and must not be
described otherwise.

### A realistic domain costs about 0.8 points of heart

Every bitmap solved on this project encodes `example.com`, which was never
going to be the domain. That is not cosmetic: QR version 5 level L carries 108
data codewords, the payload consumes them first, and the remainder is the
entire budget the QArt solver has for shaping the heart. Free bytes are
`104 - payloadLength`, and only the low five bits of each are usable, so a
longer domain subtracts shaping capacity directly.

Measured with `tools/payload-length-check.mjs`, the same five ids under both
domains so domain length is the only variable:

| payload | chars | free bits | mask | match | gate cost | masks rejected |
|---|---|---|---|---|---|---|
| `example.com/t/1` | 24 | 400 | 7 | 64.9% | 0.0 | 0 |
| `example.com/t/12` | 25 | 395 | 7 | 63.9% | 1.5 | 1 |
| `example.com/t/55` | 25 | 395 | 1 | 63.3% | 0.9 | 1 |
| `example.com/t/1234` | 27 | 385 | 7 | 64.1% | 0.0 | 0 |
| `example.com/t/12345` | 28 | 380 | 4 | 63.3% | 0.0 | 0 |
| `machine-readable.xyz/t/1` | 33 | 355 | 4 | 63.0% | 0.0 | 0 |
| `machine-readable.xyz/t/12` | 34 | 350 | 4 | 63.6% | 0.0 | 0 |
| `machine-readable.xyz/t/55` | 34 | 350 | 4 | 62.5% | 0.0 | 0 |
| `machine-readable.xyz/t/1234` | 36 | 340 | 4 | 63.6% | 0.0 | 0 |
| `machine-readable.xyz/t/12345` | 37 | 335 | 4 | 62.6% | 0.0 | 0 |

`machine-readable.xyz` is a PLACEHOLDER of representative length (20
characters), chosen because the real domain is undecided. Match is scored over
all 1,369 modules in the grid, not over the heart's own cells.

Three findings.

**The cost is 0.84 points of heart match, averaged over the five ids.** Free
bits fall 11.5% and match falls 1.3% relative -- a slope of about 0.065 points
per payload character. The heart is far less sensitive to payload length than
the capacity arithmetic suggests, because the solver is already placing far
fewer bits than the heart has cells.

**Robustness did not degrade -- it improved, on this sample.** Under
`example.com` two of five tokens needed a fallback mask to pass the decode
gate; under the longer payload, none did. Five tokens is a small sample and
this may be chance, so the honest claim is that a realistic domain shows no
robustness penalty, not that it confers a benefit.

**Every realistic-domain solve chose mask 4**, the mask that carried both
fragile codes found in Phase 1, and all five passed the gate. That is further
evidence for the Phase 1 conclusion that mask 4 is not the problem and banning
it would have been the wrong fix.

The script reproduces all three known Phase 1 results exactly -- token 1 at mask
7 and 64.9%, token 12 costing 1.5 points, token 55 costing 0.9 -- which is why
its new numbers can be trusted.

**No action falls out of this.** The domain choice is not constrained by the
artwork at any plausible length, and the codes must be re-solved against the
real domain before minting regardless, since a bitmap encodes its own url.

**NOTE ADDED 2026-09-03: the real domain was chosen and measured, and the
slope above under-predicts it by about half.** The domain is
`machinereadableonly.com`, whose payload is 12 characters longer than
`example.com` rather than the 9 measured here. The linear estimate predicts
roughly 0.8 to 1.1 points; the measured cost is **2.13 points**, averaged over
ids 1, 12 and 55 (64.9 / 63.9 / 63.3 falling to 61.9 / 62.2 / 61.6). So the
slope is not linear out to twelve characters, and 0.065 points per character
should not be quoted as a general figure. Three ids is a small sample and no
better slope is claimed from it.

The conclusion above still holds in both of its parts: 2.13 points did not
change the decision, and robustness again did not degrade -- all three solves
passed the decode gate on their first-choice mask with zero rejections, against
two of five needing a fallback under `example.com`. Full record in
`docs/2026-09-03-mro-domain-decision.md`.

### Pulse: measured at last, and it busts the gas ceiling on one day

Tasks 7, 8 and 9 each recorded the same placeholder -- "`animation_url` is
unbudgeted and unbuilt, it roughly doubles tokenURI bytes". `RendererPulse` is
a variant built to replace that adjective with numbers. It is NOT the shipped
renderer: `Renderer` is untouched, every existing fixture stays byte-identical,
and `test_withoutPulseTheVariantIsByteIdentical` pins that the two differ in
`animation_url` and nothing else.

**HTML is the only workable shape.** Verified against OpenSea's live media
documentation on 2026-08-29: `animation_url` supports GLTF, GLB, WEBM, MP4,
M4V, OGV, OGG, MP3, WAV and OGA, "or it can point to an HTML page". SVG is
supported for `image` only. An `animation_url` holding an SVG data URI would be
a format the marketplace does not claim to render, so the cheap-looking option
is not a workable one.

**The cheapest workable version renders the image once.** The obvious
implementation renders it twice -- once for `image`, once inside the HTML -- and
`svg()` is the expensive half of `tokenURI`. Rendering once and spending the
second copy only on encoding is the difference between a variant that doubles
the call and one that adds 30%. The animation is a CSS rule targeting the last
path in the document, because the draw order is fixed and asserted (ghost,
frame, noise, heart) so the heart is always last; giving the heart path an id
would put bytes on every token to serve the one Mark that uses them.

Cost, on identical state at the day-364 worst case with every Mark:

| | gas | bytes |
|---|---|---|
| shipped renderer | 1,578,380 | 9,219 |
| Pulse variant | 2,047,407 | 17,960 |
| **delta** | **+469,027** | **+8,741** |

Where that lands against the 2,000,000 gas / 20,000 byte hard limit:

| level | Pulse + Vein | all Marks | verdict |
|---|---|---|---|
| 1 | 1,794,631 | 1,829,398 | under |
| 200 | 1,913,021 | 1,952,607 | under |
| **364** | **2,025,331** | **2,065,436** | **OVER** |
| 365 | 1,824,980 | 1,865,349 | under |

**Bytes always fit** -- 17,970 at the worst, inside 20,000. **Gas does not.**
Pulse crosses the hard limit at level 364 only, by 25,331 gas with the minimum
Mark set and 65,436 with every Mark. That is the same day-before-the-seal worst
case Task 8 found, for the same reason: twelve ghost cells threaded through 364
lit ones shatter both frame paths into short runs.

Level 364 is one day in a token's life, but it is a day every token that gets
there will pass through, and `tokenURI` reverting or being refused on that day
is not an acceptable failure mode for a piece whose subject is the record of
returning.

The ceiling is recorded here, not asserted in the suite: Pulse is not adopted,
so a ceiling assertion would fail the build over a variant nobody ships. The
shipped renderer's ceiling stays asserted in `GasBudget.t.sol`.

**This is a decision for the operator, not a defect to fix.** The options are on the
table: drop Pulse, redesign it below the ceiling, raise the ceiling knowing the
measured provider behaviour, or accept a Mark that is unreadable on one day.

---

## Blue Blood: the Mark that replaced Pulse

Pulse was dropped on the measurement above. That left rung 2 of a priced ladder
empty, with Vein at 1 and Voice at 20 and nothing between them.

### The surface argument

The design rule that makes Marks composable is that no two write the same
surface, so a token wearing all seven is one legible image rather than a pile of
effects. The drawn image has exactly seven surfaces and six were already taken:
the field by Halo, the quiet zone by Voice, unearned frame cells by Vein, earned
cells and year rings by Crown, the heart modules by Bloom, and the QArt target
itself by Singularity.

The noise ink was the only one left, and it is the largest of them -- roughly
half the lit modules in the code block. It is also already a parameter of
`CodeRenderer.paths`, so claiming it costs a substituted string rather than a
second document. That is the exact inverse of what made Pulse unaffordable.

The alternative considered was inventing new geometry, a marker cell in the day
frame showing today's position in the year. Rejected: about 40 bytes and no
invariant disturbed, but it needs new drawing code in both languages and is
close to invisible at a 256px thumbnail. A rung-2 Mark that cannot be seen in a
listing is not worth selling.

### The inks are derived, not chosen

The binding constraint is luminance. Heart and noise must MATCH in BT.601 luma,
because once a raster is large enough that ZXing's 8x8 blocks fall inside a
single module the lighter ink resolves to background. A Mark may move the ink in
hue; it may not move it in weight.

So the five inks are computed: a slate direction `[60, 90, 130]` pulled 70%
toward its own grey to set intensity, then scaled so each rung lands on that
rung's exact luma. Hand-picking five values would have been five chances to
break the pairing by eye.

| Rung | Heart | Heart chroma | Neutral noise | Blue Blood | Noise chroma | Luma gap |
|---|---|---|---|---|---|---|
| 4 (streak 100+) | `#c8102e` | 184 | `#4a4a4a` | `#444b55` | 17 | 0.39 |
| 3 (streak 30+) | `#bd2242` | 155 | `#545454` | `#4d5560` | 19 | 0.13 |
| 2 (streak 7+) | `#a83a55` | 110 | `#5e5e5e` | `#565f6c` | 22 | 0.18 |
| 1 (streak 3+) | `#8e5566` | 57 | `#686868` | `#5f6a77` | 24 | 0.21 |
| 0 (day one) | `#70575f` | 25 | `#5f5f5f` | `#57606d` | 22 | 0.60 |

Every gap is inside the existing `<= 1` assertion, in both languages.

### The intensity rule is not about decoding

Every intensity measured decodes, including the boldest. The rule that sets the
number is about which element is the SUBJECT: the start-tier heart carries
chroma 25, the least on the ladder, so a vivid noise out-saturates the heart it
surrounds and the noise becomes the picture. Rendered at chroma 8, 17, 25, 38
and 60, the answer was visible immediately and would not have been reachable by
arithmetic.

That yields an assertion stricter than "it decodes", now pinned in both
languages: **the noise chroma must stay below the heart chroma at the same
tier**, with day one the binding case at 22 against 25.

Sheets: `docs/noise-mark.png` and `docs/noise-mark-intensity.png`, from
`tools/noise-mark-sheet.mjs`.

### Cost: indistinguishable from free

Measured at the day-364 worst case, the same token with and without the Mark:

| | gas | tokenURI bytes |
|---|---|---|
| without Blue Blood | 1,578,029 | 9,212 |
| with Blue Blood | 1,575,624 | 9,224 |
| delta | **-2,405** | **+12** |

The Mark measured 2,405 gas CHEAPER than not wearing it, which at 0.15% of the
call is inside the noise rather than a real saving; it is reported as measured
and no cause is claimed for it. The 12 bytes are `,"blueblood"` in the Marks
attribute -- the ladder's name cost, which every Mark pays. The IMAGE length is
unchanged, asserted directly on `svg()`, because a seven-character hex colour
was swapped for another.

`Renderer` grew 248 bytes of runtime code to 12,411, leaving 12,165 of margin.

### What was removed

`RendererPulse.sol` and `contracts/test/PulseCost.t.sol` were deleted with the operator's
approval once the Pulse numbers above were recorded. The git history keeps them.

### What this does not do

It does not restore what Pulse meant. Pulse made the heart beat; nothing on the
ladder now suggests motion. That was a deliberate call when the rung was
declared open rather than reserved for an aliveness Mark.

---

## ERC-4906 re-tested, and the first finding corrected

The Phase 2 finding said the refresh "did not happen". That was two claims, and
they are not equally supported. Re-tested 2026-08-29 after reading Alchemy's own
documentation, which named three flaws in the original method.

### What was wrong with the first test

- **Ninety minutes of polling without a refresh flag only reads the cache.** It
  never asks for a re-read, so it can only show the cache does not self-expire.
- **Alchemy allows "one refresh per token every 15 minutes, globally for all
  users"** (their SDK documentation). The two `refreshCache=true` calls were TEN
  minutes apart, so at most one was ever enqueued.
- **Refreshes are queued, not synchronous.** The dedicated endpoint returns
  `status: "Queued"` and an `estimatedMsToRefresh`. `invalidateContract` was
  given four minutes.

And `timeLastUpdated` is documented as the LAST REFRESH TIME, so its staying
frozen is consistent with no refresh having run at all. The first test read it
as "it is not re-reading", which does not follow.

### What is now verified rather than assumed

**Our side is correct.** `MetadataUpdate(1)` is on chain at block 46119616 with
topic `0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7`,
exactly as EIP-4906 specifies; 29 such events sit on the contract. This had only
ever been asserted from the source before.

**ERC-4906 obliges nobody.** The EIP's language is that a third party "can"
update the metadata. No requirement, no timing guarantee. Confirmed against the
spec text. So the design rule holds regardless of any measurement: the piece
must never depend on an indexer refreshing.

### The re-test result: still inconclusive, but for a nameable reason

The discriminator is `timeLastUpdated`, not Level. Three outcomes are possible
and only one justifies alarm:

| Observation | Meaning |
|---|---|
| timestamp moves, Level updates | Refresh works. Operational problem only. |
| timestamp moves, Level does not | It re-read and got a stale answer. Serious. |
| timestamp never moves | The refresh never ran. Says nothing about ERC-4906. |

Measured on `0x12C641d5C15DeEc21D71912973Bd8f63967b9bF6` token 1, chain at Level
300 and cache at Level 365:

- **Passive staleness is now 7.4 hours, not 90 minutes.** `timeLastUpdated`
  frozen at `2026-08-29T12:38:35.181Z`, the cached name still reading
  "(Whole)". This part of the original finding is STRONGER than first reported:
  a correctly emitted event produced no passive pickup in that window.
- **One clean refresh, issued well outside the 15-minute window, then polled
  every 3 minutes for 30 minutes: the timestamp never moved.** That is row 3 --
  uninformative about ERC-4906, and it means the refresh did not run.

### The one mechanism still untried

> RESOLVED later the same day, and not in the way this section expected. The
> endpoint is not available on Base Sepolia at all. See the next section.

Both the original test and this one used `getNFTMetadata?refreshCache=true`.
Neither used the DEDICATED `refreshNftMetadata` endpoint, which is the one that
returns `status` and `estimatedMsToRefresh` -- the only variant that reports
whether a refresh was actually accepted. Until that is tried, "explicit refresh
does not work" is not established.

`tools/erc4906-retest.mjs` carries the method and the discriminator table.
Record in `tools/out/erc4906-retest.log` (gitignored).

### Standing caveat

All of this is Base Sepolia. There is no reason to assume an indexer services a
testnet cache with mainnet urgency, and that caveat travels with every number
above.

### Why this is probably smaller than it first looked

If explicit refresh works, it has an obvious home: the Clock already batches
every check-in into one transaction daily at 00:05, so the same job can poke the
indexer for the tokens it just touched. That is a Plan 3 cron step, not a design
change.

The deeper safety net is already in the artwork. The QR encodes
`https://<domain>/t/<id>`, so a stale marketplace thumbnail still scans to the
live record. The token carries the address of its own current truth.

---

## ERC-4906 re-tested again: the untried endpoint does not exist here

The previous section named one outstanding action -- try the dedicated
`refreshNftMetadata` endpoint -- and said the question stayed open until then.
That action is now done, and it cannot answer the question, because the endpoint
is not available on this network.

What follows also corrects a claim made mid-session and reported to the operator before it
had been checked properly: that the refresh "works". One re-read did occur, but
it cannot be attributed to any request, and three isolated attempts since have
each produced nothing.

### The untried endpoint was never going to answer

```
POST https://base-sepolia.g.alchemy.com/nft/v3/<key>/refreshNftMetadata
400 Bad Request
{"error":{"message":"This endpoint isn't enabled for that chain or network just yet - please contact the Alchemy team for support!"}}
```

Alchemy's own page for it lists support as "Ethereum (Mainnet & Sepolia),
Polygon (Mainnet, Mumbai & Amoy), Arbitrum One (mainnet), Optimism (mainnet) &
Base (mainnet)". Base Sepolia is absent and the API agrees. So `status` and
`estimatedMsToRefresh` -- the only fields that would report whether a refresh was
accepted -- are unobtainable on this network. The one mechanism the last write-up
was waiting on has been struck off, not satisfied.

`invalidateContract` and `getNFTMetadata?refreshCache=true` are not gated the
same way; both return 200 here.

### The pipeline is not dead -- it ingests cold entries fine

The original reading, that Alchemy "was not re-reading at all", is contradicted
by this project's own soak data. All 26 tokens on the adopted contract carry
DISTINCT `timeLastUpdated` stamps, each matching the minute Phase 2 or Phase 3
first fetched that token:

| Tokens | timeLastUpdated | Fetched by |
|---|---|---|
| 1, 5 | 12:42:08, 12:42:57 | Phase 2, the seven bitmaps |
| 10, 15, 20, 21, 25, 26 | 14:38:39 - 14:42:47 | Phase 3, the remaining nineteen |

`tools/third-party-check.mjs:63` shows the cause: `metadataWithImage` opens with
`getNftMetadata({ refreshCache: true })`. That call performed the initial ingest
26 times and stamped each one. So the failure is narrower than "refresh is
broken": it is specific to invalidating an entry that is already WARM.

### Three explicit mechanisms, three nulls

A second write put token 1 at Level 200 (block 46134224, `MetadataUpdate(1)`
emitted with the correct topic, confirmed in the receipt). The chain was then
re-read over RPC and genuinely reports Level 200 while the cache reports 300 --
verified directly rather than assumed, because the first pass of this test
asserted the chain state from a hardcoded string in the harness.

Each round ran in isolation, outside the documented one-refresh-per-token-per-15
-minutes window, watching `timeLastUpdated`:

| Round | Request | Window | timeLastUpdated |
|---|---|---|---|
| A | `refreshCache=true` alone | 21:05 - 21:25 | never moved |
| B | `invalidateContract` alone | 21:26 - 21:46 | never moved |
| C | `invalidateContract` then `refreshCache=true` | 21:46 - 22:06 | never moved |

Round C is the sequence that was fired at 20:48, one minute before the only
re-read ever observed. Repeated deliberately against a real divergence, it did
nothing.

### The one re-read, and why it is not credited to us

`timeLastUpdated` moved once, from `2026-08-29T12:38:35.181Z` to
`2026-08-29T20:49:07.916Z`, and the value it picked up was correct for the chain
at that moment. It is tempting to credit the 20:48 calls, and that is what was
reported mid-session. Two things argue against it:

- Round C reproduced those exact calls and produced nothing in 20 minutes.
- The gap between the two stamps is 8.2 hours, and the change it collected was
  itself about eight hours stale.

A slow internal re-crawl explains both; the 20:48 calls explain neither. Alchemy
documents no re-crawl cadence for NFT metadata -- the FAQ covers only floor
price, cached 5 minutes -- so this cannot be settled from documentation. It is
being settled by observation instead: `tools/erc4906-passive-watch.mjs` polls
every 10 minutes for 12 hours and issues NO refresh requests at all. If the
cache moves to Level 200 near 04:50Z untouched, the re-crawl is real and the
explicit calls are what does nothing here.

### What is established, stated exactly

1. `refreshNftMetadata` is unavailable on Base Sepolia. HTTP 400, quoted above.
2. `refreshCache=true` ingests a COLD token. 26 instances, attributed to our own
   code rather than inferred.
3. On a WARM entry with a real divergence, none of the three available
   mechanisms produced a re-read inside 20 minutes each.
4. Passive staleness of at least 8.2 hours is confirmed, with a correctly
   emitted `MetadataUpdate` on chain throughout.
5. Exactly one re-read has been observed and its cause is UNATTRIBUTED.
6. Our own emission side is correct, verified twice: blocks 46119616 and
   46134224, topic
   `0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7`.

### What this does NOT establish

That Alchemy ignores ERC-4906. Nothing here tests that, because no mechanism
that reports acceptance is reachable on this network. It also does not transfer
to mainnet, where the dedicated endpoint DOES exist and where a paying
marketplace's cache is unlikely to be serviced like a testnet's.

### The design rule is unchanged, and so is the mitigation

The piece must never DEPEND on an indexer refreshing -- that was true when the
refresh looked broken and it is true now that it looks merely unreachable. No
contract change is called for; the gap is entirely consumer-side.

The mitigation also survives, with one correction to its shape. The Clock
already batches check-ins into one transaction daily at 00:05, so the same job
can poke an indexer for the tokens it touched. What this round shows is that the
poke cannot be assumed to work: on Base Sepolia none of the three calls did
anything, so the Plan 3 step must verify `timeLastUpdated` moved rather than
fire and forget.

And the artwork keeps its own escape hatch regardless. The QR encodes
`https://<domain>/t/<id>`, so a stale thumbnail still scans to the live record.

## ERC-4906: the decision, and what emitting actually costs

Decided by the operator on 2026-08-30: **keep emitting ERC-4906, and accept that a
consumer ignoring it is not something this project can change.** The three
places a downside could hide were checked before the call, and none of them
argues against it.

### Basescan is disqualified as a witness, not a second opinion

The check proposed as a free second consumer returned outcome C: Basescan
ingests no `tokenURI` metadata on Base Sepolia for anyone. It removes a line of
enquiry rather than answering one. **Alchemy remains the only third-party
metadata consumer testable on this network**, and the one endpoint that would
settle the question there does not exist on it.

### The gas cost, measured

The announcement is a single `LOG1` (one topic, no indexed parameters). The EVM
charges `375 + 375 per topic + 8 per data byte`, verified live 2026-08-30:

| Event | Data | Cost |
|---|---|---|
| `MetadataUpdate(uint256)` | 32 bytes | 1,006 gas |
| `BatchMetadataUpdate(uint256,uint256)` | 64 bytes | 1,262 gas |

Measured against this contract rather than left as arithmetic: `touchRange`,
which validates a range and emits and does nothing else, runs at **23,899 gas**
minimum, of which 21,000 is the base cost any transaction pays. The emit is a
rounding error beside the storage write it accompanies.

This was worth measuring rather than waving through because the site pays for
check-ins forever, so it is a recurring cost and not a one-off.

### The one real decision this leaves for Plan 3

`BatchMetadataUpdate` takes a CONTIGUOUS RANGE, but a day's check-ins touch an
ARBITRARY SUBSET -- whichever agents returned. The ids will be scattered. So the
daily poke must choose:

- **One range spanning min..max id.** Cheap, but it over-claims: it tells
  indexers that untouched tokens changed.
- **One `MetadataUpdate` per token.** Honest, and the cost scales with active
  agents: 1,000 returning agents is about 1,000,000 gas per day in
  announcements alone. Small at Base's fee floor, but no longer invisible.

`MROSpikeToken.touchRange` already refuses the collection-wide catch-all range
`to == type(uint256).max`, on the grounds that indexers treat it as hostile, so
the laziest option is half closed off by design.

### Why the residual risk is smaller than it looks

If consumers cache and never refresh, a piece whose premise is a living record
looks frozen wherever people browse. Emitting does not fix that and nothing on
our side does.

But **this piece's audience is agents, not humans**, and agents call `tokenURI`
or read the chain directly -- they never touch a marketplace cache. The
staleness lands on the human-facing surface this project deliberately does not
serve. That argument is stronger than the ERC-4906 question itself.

### What must not drift

The risk is not the event, it is a later feature quietly assuming freshness.
Two guards stand: the piece must never DEPEND on an indexer refreshing, and the
Plan 3 poke must VERIFY `timeLastUpdated` moved rather than fire and forget.

One consequence to state plainly at sign-off: closing on this judgement call
leaves ERC-4906 behaviour unknown until mainnet, where discovering it costs real
money. The verifying poke is what limits that.

## Phase 0: SIGNED OFF

**the operator signed Phase 0 off on 2026-08-30.**

Every task in plan revision 2 is complete (Tasks 1-10, plus Task 10b, the state
soak, and Task 10c Phases 1-3). Task 11, the throwaway Base mainnet deploy for
the OpenSea check, was dropped on 2026-08-29, so Phase 0 spent no real funds at
all.

The last open item, ERC-4906, closed by DECISION rather than by measurement:
keep emitting it, and accept that a consumer ignoring it is not something this
project can change. See the section above for the costs checked before that
call.

### What is proven, and what is merely decided

Worth separating, because the two age differently.

PROVEN by measurement:

- The worst-case `tokenURI` fits the 2,000,000 gas / 20,000 byte hard limit,
  through a real provider. The 1,000,000 / 5,000 target is MISSED and is
  reported as missed.
- The artwork decodes through a rasteriser we do not own, at eight widths we
  did not choose, across the full 26-state soak matrix.
- Declaring an intrinsic SVG size takes third-party decode failures from 54%
  to 3.6%, measured A/B on Sepolia.
- Our ERC-4906 side is correct: the interface is declared, the events fire
  after the write, and MetadataUpdate is on chain at two verified blocks.
- Every contract is deployable, with positive runtime margin.

DECIDED, not proven:

- That an indexer ignoring ERC-4906 is acceptable. Alchemy's warm-entry
  invalidation did nothing on Base Sepolia across three mechanisms, and the one
  endpoint that reports whether a refresh was accepted does not exist on that
  network. Mainnet behaviour is UNKNOWN.
- That OpenSea's display and refresh behaviour is unverified and stays that way
  until mainnet.

### The standing obligations this hands to later plans

1. The piece must never DEPEND on an indexer refreshing.
2. The Plan 3 daily poke must VERIFY `timeLastUpdated` moved, not fire and
   forget.
3. Plan 3 must choose how to emit for a scattered daily subset.
4. The QR escape hatch stays: it encodes `https://<domain>/t/<id>`, so a stale
   thumbnail still scans to the live record.

---

## Plan 1: `MachineReadableOnly` deployed to Base Sepolia

Not a Phase 0 task -- this is the final task of Plan 1 (the real token
contract, not the spike), deployed and verified 2026-08-30 from the same
throwaway key, `contracts/script/DeployPlan1.s.sol`. The Warden was not set
via `WARDEN_ADDRESS` (still unset in the project's secrets), so the script
fell back to the deployer's own address, which is correct for a testnet smoke
deploy and logged loudly as such.

| Contract | Address |
|---|---|
| `Renderer` | [`0xfBA313941CCaAf08492cE501cF2F73839904fc35`](https://sepolia.basescan.org/address/0xfba313941ccaaf08492ce501cf2f73839904fc35) |
| `MachineReadableOnly` | [`0x29Fd79212D6f7fc61ddF21aFEbe44046F3D1DB65`](https://sepolia.basescan.org/address/0x29fd79212d6f7fc61ddf21afebe44046f3d1db65) |

Both verified on Basescan via the Etherscan V2 API (`forge script ... --verify`
reported `Pass - Verified` for each).

### Deployment cost

| Step | Gas | Cost (ETH, 0.006 gwei) |
|---|---|---|
| `Renderer` deploy | 2,734,775 | 0.0000164087 |
| `MachineReadableOnly` deploy | 3,064,472 | 0.0000183868 |
| **Total** | **5,799,247** | **0.0000347955** |

### End-to-end read-back

Token 1 minted as the Warden (deployer), then read back through Alchemy's
public Base Sepolia RPC, outside Foundry entirely:

| Token | Gas via public RPC | URI bytes | SVG bytes | Scan |
|---|---|---|---|---|
| 1 | 1,411,274 | 8,829 | 6,025 | OK, decoded to its own URL |

Both figures sit well inside the 2,000,000 gas / 20,000 byte hard limit.
Mint itself cost 352,642 gas.

---

## Plan 5: the ten-Mark ladder measured

The measurement gate for Plan 5's mark ladder rewrite (Task 8 of
`docs/plans/2026-09-02-mro-plan5-mark-ladder.md`). Two questions: does the
worst-case `tokenURI` still fit the on-chain budget under the new ladder, and
does every reachable combination still scan. Both answers are yes.

### The worst case, re-measured

The old ladder let a token wear all seven Marks at once. The new one does not:
Marks come in five exclusive pairs -- (1,2) (3,4) (5,6) (7,8) (9,10) -- and a
token can hold at most one side of each, so the ceiling is five Marks, not ten.
The maximal LEGAL token is the pair-by-pair choice that draws the most: Hush,
BEAT, the BOUGHT Iris in its costliest shape (leaf), Vessel, and Tint. Static
and Break sit in the excluded halves of their pairs and are never worn
alongside this set.

**FIX ROUND 1 correction.** The first pass through this task assumed Static was
the pricier side of pair 2 and measured that variant. It is not -- Static is a
same-length ink SWAP (`Palette.staticAt` in place of `Palette.noiseAt`, zero
extra bytes), while Beat replaces the heart's flat fill with a gradient
reference and adds an entire `<defs><linearGradient>...</linearGradient></defs>`
block. The sweep below already showed this (its largest SVG among all 459 is a
Beat combination, not a Static one) and went unreconciled against the assumed
worst case in the first pass. THE RULE THIS ESTABLISHES: the sweep measured
every combination and the worst-case selection by hand is a guess -- when they
disagree, the sweep is right. `tools/combination-sweep.mjs` now asserts this
directly (`crossCheckAgainstMaxLegal`): the maximal legal token's own byte
count must equal the sweep's own computed largest, or the sweep throws.

Measured `contracts/test/GasBudget.t.sol`, day 364 (the worst-case day FOR GAS
-- see the entry above on why level 364 costs more than level 365), through the
real token contract with cold storage. The worst case for BYTES is a different
token, measured in the same run and recorded below the table:

| | Gas | Bytes |
|---|---|---|
| **New worst case (day 364, max marks, Beat)** | **1,749,915** | **10,651** |
| Pre-Plan-5 shipped baseline | 1,585,616 | 9,223 |
| Post-rename baseline (this phase, before the drawing work) | 1,586,533 | 9,213 |
| **Signed delta vs. pre-Plan-5** | **+164,299** | **+1,428** |
| **Signed delta vs. post-rename** | **+163,382** | **+1,438** |

The post-rename baseline isolates the Mark-name rename alone (+917 gas / -10
bytes, purely from Mark names changing length in the metadata). Comparing the
new worst case against IT rather than the pre-Plan-5 figure is what shows the
cost of the new drawing work on its own: about +163,382 gas and +1,438 bytes
for five new Marks (Beat's gradient, the bought Iris's reshaped eyes in its
leaf variant, and Tint's eye ink), on top of the Hush/Vessel pair that was
already in the pre-Plan-5 figure.

**THE DEAREST TOKEN AND THE LARGEST TOKEN ARE NOT THE SAME TOKEN, and each
limit is measured against its own worst case.** `GasBudget.t.sol:119-120` says
so in the code and prints two separate headroom lines; an earlier version of
this paragraph took the byte margin off the GAS worst case and understated the
bytes by 899. Both figures below are real, both come from the same run of the
same test, and neither supersedes the other:

| worst case for | token | state | Gas | Bytes | margin |
|---|---|---|---|---|---|
| **gas** | 9 | level 364, run 400, max marks | **1,749,915** | 10,651 | 250,085 gas (12.5%) |
| **bytes** | 7 | level 3,650 (the ring cap), run 400, max marks | 1,679,943 | **11,550** | 8,450 bytes (42.3%) |

Token 9 is the figure the suite tracks across commits (`worstGas`, and the one
the assertions compare); token 7 is what `maxBytes` collects, and 20,000 -
11,550 = 8,450 is the byte headroom the test itself prints. Both stay inside
the 2,000,000 gas / 20,000 byte HARD limit.

**The 1,000,000 gas / 5,000 byte TARGET was already missed before this change
and is still missed.** Gas exceeds it by 749,915 on token 9, and bytes by 6,550
on token 7. This is reported, not quietly dropped -- see the Phase 0 section
above, where the same target was already missed pre-Plan-5.

### The decode sweep: 459 renderable combinations

The old sweep covered 256 combinations of the retired seven independent Marks.
The new ladder's reachable Mark sets are generated from the same exclusion and
requirement masks `contracts/src/Ladder.sol` encodes (`Upgrade.excludes` /
`Upgrade.requiresAny`), not listed by hand, in `tools/combination-sweep.mjs`:

- **189 reachable Mark sets.** Pairs 1, 2 and 4 -- (Hush, Ache), (Static, Beat),
  (Vessel, Break) -- each contribute 3 independent outcomes (neither side, or
  either one). Pairs 3 and 5 -- Iris, and Tint/Aura, which requires holding an
  Iris -- together contribute 7: `(1 x 1) + (2 x 3)`, one outcome when pair 3 is
  empty (pair 5 must be empty too), three when pair 3 is not empty (pair 5 is
  free to be neither, Tint, or Aura). `3 x 3 x 3 x 7 = 189`.
- **459 renderable combinations**, once the bought Iris's three eye shapes and
  Tint's two inks are expanded per Mark set. Generated the same way, not
  hand-counted, and both counts (189 and 459) are asserted at the top of the
  sweep -- a mismatch would throw rather than silently proceeding.

Three combinations are named explicitly in the sweep, because a stale reading
of an earlier ladder revision would have left them untested: **Break +
Static** and **Break + Beat** were REFUSALS before the cross-pair exclusion was
removed on 2026-09-02, and **Break + Iris** is the case where the eyes sit on
a noise Break has recoloured to the token's own ink (finding 3 in the Plan 5
plan doc). All three are asserted present in the generated set, so a future
ladder edit that makes any of them unreachable again fails loudly rather than
the case quietly vanishing.

**Result, at 848 px (the cheap gate, `node tools/combination-sweep.mjs`):**

- 459 combinations, 848 px each
- **0 decode failures**
- SVG bytes: min 5,970, max 7,243 (the largest: Hush + Beat + the bought Iris
  in its leaf shape)
- Named cases: Break + Static PASS, Break + Beat PASS, Break + Iris PASS, all
  decoded at 848
- **MAX_LEGAL cross-check: confirmed.** `contracts/test/GasBudget.t.sol`'s
  maximal legal token (Hush + Beat + Iris-leaf + Vessel + Tint, 7,243 bytes)
  ties the sweep's own largest byte count exactly. Vessel and Tint are
  same-length hex substitutions (zero extra bytes), so several Mark sets
  legitimately tie for "largest" -- the sweep's `reduce` happens to report the
  3-Mark subset first, but the two figures now assert equal rather than being
  eyeballed as "close enough".

**Fix Round 1, the memory fix for the full five-size gate.** The full gate
(`node tools/combination-sweep.mjs full`, 256/500/848/1080/1600 px, about 103
minutes) was reported as "wired and correct" in the first pass on the strength
of its argv wiring alone -- it had not actually been run to completion, and
when the controller ran it, it was SIGKILLed by `safe-build.sh`'s 3G MemoryMax
after about 150 of 459 combinations (exit 137). Instrumented rather than
patched over: `@resvg/resvg-js` 2.6.2 (the installed version) does not call
napi-rs's `adjust_external_memory()`, so V8 never sees the native memory a
render allocates and never collects it under pressure -- measured, RSS climbed
from 117 MB to 4.2 GB over 200 renders at 1600px in a tight loop, reading
`.pixels` exactly once per render each time (the known resvg-js leak shape on
this project), and explicit `global.gc()` every 10 iterations made no
measurable difference. The fix landed upstream in 2.7.0-alpha.0 (2026-01-22)
but only as an alpha; no stable release carries it, so upgrading was not an
option. The full gate now batches: the orchestrator spawns this same file as a
child process per 30-combination batch (measured ~38 MB RSS growth per
combination across the real 5-size mix; a batch peaks around 1.3 GB), and the
OS reclaims everything when a batch's process exits before the next one
starts. Confirmed live (a bounded smoke test, stopped deliberately rather than
run to completion, per the controller's instruction): a worker's RSS climbed
to ~1.2 GB across one 30-combination batch, then the next batch's worker
started fresh at ~71 MB. 330 of 459 combinations (11 batches) decoded cleanly,
0 failures, before the smoke test was stopped. The controller runs the full
459 to completion separately.

### A comment correction

Two doc comments (`contracts/src/render/Renderer.sol`'s `_eyes`, and the
matching block in `tools/render-token.mjs`) stated a false reason for
computing the earned Iris's eye ink at its frozen stored rung instead of the
token's live rung: that a live-rung lookup would "collide the eye into the
noise it sits on." Checked against the real palette, that is false -- at the
live rung the eye would be `#5f5f5f` (luma 95.0) against a `#70575f` noise
(luma 95.4), luminance-matched and separated by hue, which is this project's
own decode rule; they would read fine together. The real reason: a live-rung
lookup would let the earned Iris's ink walk back down the ladder as the
token's streak fades, starting the one Mark that cannot be bought lapsing
again -- exactly the property it exists to be free of. Both comments are
corrected; no behaviour changed, confirmed by regenerating
`contracts/test/RenderFixture.sol` and `contracts/test/ColourFixture.sol` and
seeing an empty `git status`.
