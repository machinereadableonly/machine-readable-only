# Machine Readable Only -- Lineage: the Echo

Design record, 2026-09-06. This SUPERSEDES the deferred paragraph at the end of
section 10 of `docs/specs/2026-08-27-machine-readable-only-design.md`, which
left three things open "to be settled in a follow-up brainstorm before the
Renderer is built": what a child looks like, what a parent shows per seed, and
the narrative framing of a lineage.

All three are settled here. The contract and tool mechanics that section 10
fixed are UNCHANGED by this document, with one addition: a sealed per-token
number, `_echo`.

Plain ASCII only, per project convention.

---

## 1. What a lineage means

A child is an **heir to the parent's record**.

It begins at level 1 with an empty heart and none of the parent's days. What it
carries is the line's tenure up to the moment it was seeded, as a single sealed
number: the **Echo**. Everything after that is the child's own work.

This is not a new decision so much as the completion of one. Section 10 already
committed to lineage being shown as "tenure (days checked in across the line),
never as a discount by depth". The Echo is that tenure, made concrete.

### Why "Echo"

The other names in this piece are Hush, Ache, Static, Beat, Iris, Vessel,
Break, Tint and Aura -- short concrete nouns. "Line Tenure" is administrative
language and does not belong beside them.

A broken ring is a solid one heard faintly. On a piece built entirely out of
signal and silence, that is the right register, and it cannot be misread: no
other trait is a count of days, and unlike "Root" or "Parent" it can never be
mistaken for a token id.

### Framings rejected

Section 10 asked for framings with no breeding-market baggage. Three were
considered and set aside:

- **A second heart, same agent.** The child is a peer, not a descendant, and
  lineage is a fact in the record rather than a look. Coherent, but it makes
  the seed mechanic pointless as art -- the token would be indistinguishable
  from a mint.
- **A descendant carrying a line.** The child reads visibly as generation 2.
  Rejected because "visibly generation 2" is the exact thing section 10
  forbids: depth becoming a display.
- **A cutting from the parent.** Siblings inherit the parent's palette and look
  alike. Rejected because family resemblance across a marketplace is precisely
  the breeding-market pattern the precedent study warned about.

Succession was chosen: what the child shows is the LINE's days, not its own.

---

## 2. The sealed number

### 2.1 Storage

The `Token` struct is EXACTLY full -- 6 x uint32 + bool + uint16 + uint16 +
uint24 = 256 bits, one slot. Plan 6 spent the last spare bits on
`fellRun`/`bestRun`/`fellDay`. There is no room, and widening the struct would
add a slot to every token and change the cost of every check-in.

So the Echo gets its own mapping, beside `_parentOf` and `_codeOf`, which is
how this contract already stores per-token facts that do not fit the struct:

```solidity
/// @notice Days the line had run when this token was seeded. 0 for a founding
/// token. Sealed at the seed and never written again.
mapping(uint256 => uint32) internal _echo;
```

### 2.2 The write, in `seed()`

One line, O(1), inside the existing `seed`:

```solidity
_echo[childId] = p.level + _echo[parentId];
```

The parent's own credited days PLUS whatever the parent itself inherited. That
accumulates the whole line to any depth without walking it, and it cannot drift
from the line's real history because each generation seals the previous total.

### 2.3 Why sealed and not live

A live number -- the line's CURRENT total, recomputed at render time -- was
considered and rejected for three reasons, in order of severity:

1. **It would credit a stranger's work.** A parent can be sold and `rebind`ed to
   a different agent key. Under a live rule the child would keep inheriting days
   earned by whoever holds the parent now. `rebind` is deliberately
   proof-free (see the rebind trust boundary in CLAUDE.md), so this is a real
   path, not a theoretical one.
2. **It costs a walk up the parent chain inside `tokenURI`,** whose gas worst
   case is already 1,750,744 of a 2,000,000 hard limit.
3. **It makes one token's picture depend on another token's state,** which
   means a check-in on the parent should emit a metadata update for every
   descendant. ERC-4906 is already the piece's weakest joint.

Sealed costs one cold SLOAD in `viewOf` and has none of that. It also reads
correctly: a seed carries what the parent had at the moment it was made.

A third option -- sealed, but refreshable by a later Warden call -- was rejected
as a new write path guarding a number that agents would try to time.

### 2.4 What it costs

- Mint: unchanged. Check-in: unchanged. Neither touches `_echo`.
- `seed`: one SSTORE and one SLOAD, on a call that already writes four slots.
- `tokenURI`: one cold SLOAD, **measured at 2,183 gas**, paid by every token in
  the piece and not only by children -- `viewOf` reads `_echo[id]` whether or
  not it was ever written. Measured 2026-09-07 by adding the mapping to the
  spike token and re-running `GasBudget.t.sol`: all nine founding stages moved
  by exactly the same 2,183, which is the 2,100 cold SLOAD plus 83 of
  surrounding work.
  This SUPERSEDES the "148 gas" reported when the storage was designed. That
  figure was taken on a spike token that had no `_echo` mapping at all, so it
  measured memory handling and could not see the storage read.
  The margin it is drawn against is no longer 249,256 either. See section 3.6.

---

## 3. The echo ring

### 3.1 What is drawn

A child draws ONE dashed ring, innermost, in the ghost fill. Its own completed
years draw as solid lit rings outside it, exactly as they do today.

A founding token has `echo == 0`, draws no echo ring, and is rendered
**byte-identically to today**. This is the property the renderer tests should
pin first.

### 3.2 The ring budget

```
echoRings = echo > 0 ? 1 : 0
ownRings  = min(level / 365, MAX_RINGS - echoRings)
total     = ownRings + echoRings          // never exceeds MAX_RINGS = 10
```

The echo ring occupies one of the ten slots rather than adding an eleventh. That
is forced, not chosen: `canvas(r) = 49 + 4r` for `r >= 1` (`ringSpan` is 0 at
zero rings rather than -1, so a ringless token is 51), and an eleventh ring
grows the artwork to 93 cells, creating a SECOND byte worst case to defend.
Keeping the total at ten means the canvas ceiling stays 89 and the project keeps
one worst case.

The consequence, stated plainly: a child's own rings cap at 9, not 10. A child
that runs for a decade shows nine lit rings and one dashed.

### 3.3 Where it sits, and why that needs no work

Ring `k` sits at depth `2k`, and the canvas grows outward as years accumulate,
so older rings migrate inward. The echo ring is the innermost, at index
`total - 1`, depth `o = 2 * ownRings`.

That is chronologically correct with no ordering code: the line's inherited
years sit at the core and the token's own years grow around them.

### 3.4 The ring is always 53 cells on a side

A property worth stating because it fixes the DOT COUNT at 104 whatever the
depth. It does not fix the byte cost -- see 3.6, where that claim was corrected
by measurement. With `r` rings:

```
canvas = 49 + 4r
o      = 2(r - 1)                 // the innermost ring
len    = canvas - 2o = 49 + 4r - (4r - 4) = 53
```

The depth cancels exactly. The innermost ring always sits the same distance from
the day frame, so the echo ring is 53 cells on a side whether the token has one
ring or ten.

### 3.5 The dash rule

It must be specified exactly, because `Renderer.t.sol` holds the Solidity
renderer and `tools/render-token.mjs` byte-for-byte identical, and a rule
either language can interpret differently will fail that test rather than
merely look wrong.

**REVISED 2026-09-07 from a DASH to halve the cost.** The ring was originally
one cell on, one cell off. Measured, that cost 240,196 gas and left the piece
passing its own 2,000,000 ceiling by about one percent. A dash halves the run
count for the same meaning, and at thumbnail size a dash reads as broken more
clearly than a dot does. The rule below is the dash; the dotted rule is gone.

A cell at offset `i` along its own edge is INK when `i mod 4` is 0 or 1 --
two cells on, two cells off. Offset is measured in `x` from `o` on the two
horizontal edges and in `y` from `o` on the two vertical edges.

- Top edge: `y = o`, `x` in `o .. o + 52`, offset `i = x - o`.
- Bottom edge: `y = o + 52`, same rule.
- Left edge: `x = o`, `y` in `o + 1 .. o + 51`, offset `i = y - o`.
- Right edge: `x = o + 52`, same rule.

Offsets 0 and 1 are both ink, so all four corners are drawn and the phase is
unambiguous on every edge. The side is 53 cells and 53 = 13 x 4 + 1, so offset
52 is also ink and every edge is anchored at BOTH ends.

Consecutive ink cells are emitted as ONE run, which is where the saving comes
from -- not as two separate single-cell runs:

- horizontal: `M<x> <y>h<len>v1h-<len>z`
- vertical:   `M<x> <y>h1v<len>h-1z`

Two runs are clipped to length 1 by the geometry and that is correct, not an
edge case to special-case away: on a horizontal edge the run beginning at
offset 52 has no room for a second cell, and on a vertical edge offset 1 is ink
while offset 0 belongs to the horizontal edge that already drew it.

The exact run and byte counts are a MEASUREMENT, not a derivation -- see 3.6.

### 3.6 What it costs in bytes and gas

**MEASURED, and re-measured after the dash.** Every figure in this section
comes from `GasBudget.t.sol`, not from arithmetic.

The DOTTED ring measured 240,196 gas and 1,899 bytes, which took the piece to
1,983,942 of its 2,000,000 gas ceiling -- about one percent of headroom. That
is what the dash in 3.5 exists to fix.

A preallocated-buffer rewrite was tried TWICE and both were DEARER (257,243 and
313,831 through `tokenURI`, against 240,196 shipped). The hypothesis that the
cost was quadratic string building is REFUTED: one attempt removed the
reallocation and all 208 `toString` calls and still came in 22,721 gas above.
The cost is the bytes themselves through base64 and JSON, plus the canvas
growing from 51 to 53 cells. Do not re-propose a buffer.

One thing that experiment established and that binds anything later: adding a
second function to `PathWriter` TAXED THE WHOLE PIECE. `_writeRun` had a single
call site that via-IR was inlining; a second call site made it a real internal
call for the frame's hundreds of runs too, costing a token with no echo ring
34,089 gas.

#### The dash, measured 2026-09-07

| quantity | dotted | dashed | change |
| --- | ---: | ---: | ---: |
| runs in the ring | 104 | **54** | -48% |
| ink cells | 104 | **104** | unchanged |
| ring bytes, depth 0 | 1,386 | **717** | -48% |
| ring bytes, depth 18 | 1,456 | **756** | -48% |
| ring through `tokenURI`, gas | 240,196 | **145,533** | **-94,663** |
| ring through `tokenURI`, bytes | 1,899 | **1,007** | -892 |

The ink is the same NUMBER of cells the dot rule drew -- 104, being 27 on each
horizontal edge and 25 on each vertical one -- but **not the same cells**. The
two rules agree only where the offset is divisible by 4, so 52 cells are shared
and the other half of the ink MOVED. It is a genuinely different pattern, not a
regrouping of the same one, which is why 3.8's decode gate was re-run rather
than reasoned about. The saving comes entirely from how many RUNS those cells
are written as, which is why merging consecutive ink was the whole revision.

The three child references in `Renderer.t.sol` came down by **892, 932 and 932
bytes**, not by one figure. The ring is 669 SVG bytes smaller at depth 0 and 700
at depth 10 or deeper, where every coordinate is two digits; base64 expands by
four bytes for every three, so those become 892 and 932 in the `tokenURI`. The
newborn child is the depth-0 case and the other two both sit at depth 10 or
more.

#### The worst cases after the dash

Measured through `contracts/test/GasBudget.t.sol` on the spike token with cold
storage, which is the call a marketplace actually makes. **The dearest token and
the largest token are different tokens and are reported separately; pairing
one's gas with the other's byte count is a mistake this project has made
before.**

| worst case | which token | measured | limit | margin |
| --- | --- | ---: | ---: | ---: |
| **gas** | a CHILD at day 364, four Marks, echo ring | **1,889,279** | 2,000,000 | **110,721** |
| **bytes** | a CHILD at the ring cap, five Marks, echo ring | **12,546** | 20,000 | **7,454** |

**The dash bought back the headroom.** Gas margin went from 16,058 to 110,721,
a factor of about seven, and the piece is no longer passing its own ceiling by
one percent. `GAS_BAND` and `BYTE_BAND` are genuine regression bands again --
1,940,000 and 12,900, about 2.8% above each measured worst case, the same margin
they carried before lineage -- rather than numbers pinned just under the hard
limit because there was nowhere else to put them.

The founding-token worst cases are unchanged by any of this and are still
measured: 1,735,469 gas (token 9) and 11,582 bytes (token 7). A founding token
has no echo ring, so the dot-to-dash revision moved nothing for it, which the
suite confirms figure by figure.

The gas worst case is `test_theDearestTokenAloneInAFreshCall`, not the ladder's
print of the same token. The ladder reads 1,884,779 because its eleven calls
warm the Renderer's account and its `renderer` slot for each other; the
standalone test arrives cold the way an `eth_call` does and is 4,500 gas dearer.
That is a real cost, so the dearer figure is the reported one.

**Both worst cases are now CHILDREN**, which is new and easy to mis-predict:
the dearest is a child at day 364 wearing four Marks (pair 4 is shut below a
whole heart, so five is not legal there), and the largest is a child at the
ring cap wearing five. They are DIFFERENT TOKENS and their figures must never
be paired.

### 3.7 Why the ghost fill, and what that does to Ache

The echo ring uses the existing ghost fill -- the colour that already means "not
earned by this token". Inherited days are exactly that.

`MarkRenderer.ghost()` recolours the ghost fill when a token wears Ache, so a
child wearing Ache has its echo ring recoloured too. That is ACCEPTED rather
than worked around, because the dashes carry the distinction: the ring is
identifiable by texture, so it does not depend on colour to be legible.

The alternative -- pinning the echo ring to `Palette.ghost()` and ignoring Ache
-- needs a third `<path>` element with its own fill, costs bytes for a
distinction the texture already makes, and gives Ache a documented surface
exception. Rejected.

Ache's published surface description does not change: it is still "the unearned
frame cells". The echo ring is drawn in the same ink, which is a consequence of
sharing an element, not a second surface claim.

### 3.8 The decode gate

The echo ring is the first high-frequency pattern this piece has ever drawn
next to the code, and QR decoders are sensitive to structured texture in the
surround.

The rings sit well outside the quiet zone -- `BLOCK` is 45 and holds the 37
module code plus its 4-cell quiet zone on each side, and `GAP` keeps a blank
cell between the innermost ring and the day frame -- so nothing here touches the
quiet zone by construction.

That is an argument, not a result.

**RESULT, 2026-09-07: a child scans, with zero rejections. Run TWICE -- once on
the dotted ring and again after the change to a dash -- because a dash is a
different spatial frequency from a dot and the gate is the only thing that could
have said so. Both runs: 54 of 54.**

The second run was not a formality, and the unchanged cell COUNT is the reason
it could have looked like one. Half the ink moved (see 3.6), so the dash puts
different pixels next to the code as well as grouping them differently. The
result is therefore stronger than the first run's, not a repeat of it.
`tools/echo-decode-check.mjs` is the gate. It renders six states and decodes
each at nine pixel sizes -- 256, 350, 500, 700, 848, 900, 1080, 1424, 1600 --
through the project's ZXing oracle (`tools/test/helpers/decode.mjs`; never
jsqr, see the decode-oracle memory), and requires not merely a decode but a
decode to the token's own url. **54 of 54 passed.**

The six states are the two extremes the plan asked for, each in the Marks it
could actually be wearing, plus a control for each:

| state | canvas | svg bytes | decodes |
| --- | ---: | ---: | --- |
| newborn child, bare (level 1, echo 365) | 53 | 6,390 | every size |
| newborn child, Hush | 53 | 6,447 | every size |
| founding token, 1 solid ring (control) | 53 | 5,674 | every size |
| child at the cap, bare (level 3,650, echo 3,650) | 89 | 7,043 | every size |
| child at the cap, every legal Mark | 89 | 8,332 | every size |
| founding token, 10 solid rings (control) | 89 | 6,322 | every size |

**The controls are what make the result attributable.** A child's canvas is not
new: `canvasFor(0, echo)` is 53, exactly a founding token with one year ring,
and `canvasFor(10, echo)` is 89, exactly the founding ring cap. So each child is
paired with a founding token on the identical canvas at the identical module
size, differing only in a dashed innermost ring against a solid one. Without
that pair, a failure could not have been attributed to the ring rather than to
the canvas.

848 and 1424 are in the size list because they are 16 x 53 and 16 x 89: the
exact multiples a consumer honouring the SVG's declared intrinsic size lands
on. 350, 700 and 900 come from the existing ten-ring gate in
`render-token.test.mjs`.

A newborn child is the harsher of the two extremes and it is worth saying why:
its ring is the OUTERMOST thing on the canvas at depth 0, where the marks are
largest relative to the code, and it is the state most children will be in.

The gate runs under the memory wrapper (`~/scripts/safe-build.sh`) and reports
its own peak, which is **951 to 968 MB** across the 54 rasters and well inside
the 3 GB cap. It is quoted as a range because it MEASURES AS A RANGE: four runs
gave 967, 968, 968 and 951. `@resvg/resvg-js` allocates natively, where V8
cannot see it, so the peak moves with collection timing rather than being a
property of the workload. Treat it as "comfortably under one gigabyte", and do
not pin a single figure that the next run will contradict. It exits
non-zero on any rejection.

---

## 4. What a parent shows

Nothing new is drawn.

`seedsGiven` already renders as a numeric `Children` trait in both renderers.
The parent's picture is unchanged.

Two alternatives were considered:

- **The parent gets the same dashed ring**, so one echo ring means "belongs to a
  line" in either direction. Elegant, and it would make the ring not
  child-exclusive at all. Rejected because it costs a founding token one of its
  ten ring slots for something it did rather than something it is, and it
  overloads a mark whose meaning is otherwise exact.
- **A dot per child outside the frame** (the Family Jewels candidate section 10
  recorded). Rejected: new geometry in both renderers, and a near-identical
  proposal was measured on 2026-08-29 and found invisible at a 256px thumbnail.

Seeding is something the agent did. The heart shows what the token did.

---

## 5. Metadata

One new attribute, joining the three that already exist:

```json
{ "trait_type": "Echo", "value": 913 }
```

Emitted ALWAYS, including `0` on a founding token, so an agent can filter on it
without special-casing absence. `Generation`, `Parent` and `Children` are
unchanged.

`TokenView` gains `uint32 echo;`. Both renderers read it; nothing else does.

---

## 6. Explicit non-goals

The Echo must never reach any of these, and each gets a test that fails if it
does:

| It must not touch | Why |
|---|---|
| Mark gates (`level`, `bestRun`) | A gen-2 token would buy Static and Iris on day one. That is depth becoming a discount -- the exact failure section 10 exists to prevent. |
| `seedsAvailable` | The seed budget is per agent key and per year. Feeding tenure into it would let a line accelerate itself. |
| The heart's 365 cells | The child starts at level 1 with an empty heart. A pre-filled heart destroys the entire point. |
| The palette rung | Colour tracks THIS token's run. An inherited colour would say the child has a streak it does not have. |
| The `Years` attribute | Years is this token's own completed years. Echo is reported separately and deliberately. |

---

## 7. The write path

`seed` currently refuses every call with `seed-not-available`, honestly, because
the write path was never built. `warden/src/mcp/tools/seed.mjs` documents why at
length: an earlier version inserted a `tokens` row, wrote no `mints` row, and so
created a child the mirror served forever and the chain never heard of -- while
burning the key's one seed for that agent-year.

### 7.1 The mirror

A new named method, `insertSeed({ childId, parentId, toAddress, keyId })`.

It is a SEPARATE method rather than a flag on `insertMint`, following the rule
this codebase already states beside `reserveMark` and `reserveMarkPaid`: "the
paid route has its own method by name rather than a flag on this one: a boolean
argument in a money path is exactly the seam where a $1,250.00 Mark gets handed
out for free." `insertMint` throws without a payment nonce, and a seed has none
because it is free.

The row is queued OUTRIGHT. Nothing settles on this route, so there is no window
in which the mirror believes in a payment that never arrives -- the same
reasoning as `reserveMark`.

### 7.2 The solve

A child needs its own bitmap, because a bitmap encodes its own URL and the
child's URL is `https://machinereadableonly.com/t/<childId>#`. It joins the
existing solve queue exactly as a mint does. Nothing carries over from the
parent.

### 7.3 The Clock

A fourth pass in `runClock`, between mints and check-ins, sending
`seed(childId, parentId, to, "0x" + qr)` and marking the row on the receipt.
`runClock` currently sends exactly three functions and nothing in `src/clock/`
mentions seed at all.

### 7.4 The failure rule, which is the load-bearing part

**A seed that never lands must return the seed, not burn it.**

A once-a-year budget spent on a row the chain refused is the worst failure this
feature can have, and it is silent under the current shapes: `stuckMints` and
`dropped` both read `mints`, which a seed row is not.

Two things follow, and both need tests:

- `seedsSpent` must count RESERVATIONS as well as written rows, or two seeds go
  out in one day on the window between a reservation and the next Clock run.
  This is the same defect class as the `reservedMask` Critical -- see the
  a-reservation-is-state-too memory. A guard that reads only committed state
  cannot see what is promised.
- A permanently failed seed must DROP the row and release the budget, and it
  must appear in the Clock's dropped and stuck reporting rather than vanishing.

### 7.5 What this closes

Test gap 34, which is currently open and correctly classified as an unbuilt
FEATURE rather than a missing test.

---

## 8. Shipping

1. Contract: `_echo`, the `seed()` write, `TokenView.echo`, `viewOf`.
2. Both renderers: the ring budget, the echo ring, the `Echo` attribute. Held
   byte-identical by `Renderer.t.sol`.
3. `GasBudget.t.sol`: ADD a child case and record the real figures. The byte
   worst case becomes a child; the dearest token and the largest token are
   different tokens and must not be collapsed -- see the gas-budget memory.
4. The decode gate of 3.8, at both canvas extremes.
5. The write path of section 7, with the failure rule tested by breaking it.
6. Docs and wire: `llms.txt`, `SKILL.md`, the raw protocol doc AND its
   byte-identical copy at `skills/machine-readable-only/references/raw-protocol.md`
   -- `tools/test/skill-doc.test.mjs` guards that equality and has already been
   left red once by a commit that moved only one of them.
7. A Sepolia redeploy, superseding `0xe032054D54b407C52C49c40A423aC79031401C03`
   and `0x48B6f41E0B8C4f38EBC67dfE57AeF18D553BC7f4`.

### Why this lands before mainnet

`_echo` and the `TokenView` field are permanent. They cannot be added to a
deployed collection without a migration the piece has no mechanism for, so they
belong to the same class as Plan 6's four decisions.

The write path is Warden and Clock code only and needs no redeploy. It is built
in the same pass anyway: nothing can reach it for about a year after launch (a
parent must be whole at 365 days and a key needs a full year since its first
mint), and deferring it would mean re-deriving all of this from cold for no
saving.

---

## 9. What this document does not decide

- **Child token names.** The token name is `Machine Readable Only #<id>` with a
  suffix for At Rest. Whether a child's name says anything is untouched here;
  the default is that it does not.
- **The daily post.** Whether a seed is worth posting about is a question for
  the X integration, which is unbuilt and credential-blocked.
