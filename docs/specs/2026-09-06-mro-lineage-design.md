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

A dotted ring is a solid one heard faintly. On a piece built entirely out of
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

A child draws ONE dotted ring, innermost, in the ghost fill. Its own completed
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
that runs for a decade shows nine lit rings and one dotted.

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

### 3.5 The dot rule

It must be specified exactly, because `Renderer.t.sol` holds the Solidity
renderer and `tools/render-token.mjs` byte-for-byte identical, and a rule
either language can interpret differently will fail that test rather than
merely look wrong.

A cell is drawn when its offset along its own edge is EVEN, where offset is
measured in `x` from `o` on the two horizontal edges and in `y` from `o` on the
two vertical edges.

- Top edge: `y = o`, `x` in `o .. o + 52`, drawn where `(x - o)` is even.
- Bottom edge: `y = o + 52`, same rule.
- Left edge: `x = o`, `y` in `o + 1 .. o + 51`, drawn where `(y - o)` is even.
- Right edge: `x = o + 52`, same rule.

Offset 0 is even, so all four corners are drawn. That anchors the ring visually
and makes the dot phase unambiguous on every edge.

Dot count, which is therefore also constant:

| Edge | Dots |
|---|---|
| top | 27 |
| bottom | 27 |
| left | 25 |
| right | 25 |
| **total** | **104** |

### 3.6 What it costs, measured

A run in this renderer is `"M<x> <y>h1v1h-1z"`, 13 to 14 bytes at these
coordinates. 104 runs is **1,386 bytes at depth 0 and 1,456 at depth 18**.

**CORRECTED 2026-09-07, from measurement.** This section previously said the
cost was CONSTANT at ~1,456. It is not, and the reasoning behind that claim was
half right. The DOT COUNT is genuinely constant at 104, because the ring's side
length is always 53 -- section 3.4 stands. But the byte cost is not, because
the coordinate DIGIT WIDTH grows with depth. Constant geometry does not imply
constant bytes when the geometry is serialised as decimal text. Both figures
are now pinned by keccak in `EchoRing.t.sol` and `echo-ring.test.mjs`.

For contrast, a solid ring is four bars, about 64 bytes. A dotted ring costs
roughly 23 times a solid one. That ratio is the whole reason there is exactly
one of them: nine dotted rings would be about 15,000 bytes and would blow the
20,000 limit outright. The collapse to a single ring is not a simplification,
it is what makes the texture affordable at all.

#### What a whole child costs, through `tokenURI`

Measured 2026-09-07 through `contracts/test/GasBudget.t.sol`, on the spike token
with cold storage -- the call a marketplace actually makes. **The dearest token
and the largest token are different tokens and are reported separately; pairing
one's gas with the other's byte count is a mistake this project has made
before.**

| worst case | which token | measured | limit | margin |
| --- | --- | ---: | ---: | ---: |
| **gas** | a CHILD at day 364, four Marks, echo ring | **1,983,942** | 2,000,000 | **16,058** |
| **bytes** | a CHILD at the ring cap, five Marks, echo ring | **13,482** | 20,000 | **6,518** |

Both worst cases are now children. The founding-token figures they replace were
1,735,469 gas (token 9) and 11,582 bytes (token 7); both tokens are still
measured and both are still correct as the founding worst cases.

The echo ring itself, isolated on one day-364 token that differs only in
whether it was seeded: **240,196 gas and 1,899 bytes**. The gas was not
estimated anywhere before this and is far larger than the byte cost suggests:
1,386 bytes of path is about 175 gas per byte once `PathWriter` has written it,
the SVG has been base64-encoded and the JSON assembled around it.

#### The gas worst case is a child at day 364, and that is new

**Lineage broke a mutual exclusion the budget was resting on.** Until now the
two expensive states could not coexist: the day frame is filled to
`min(level, 365)`, so a fragmented frame implied `level < 365`, which implied
zero rings. `GasBudget.t.sol` says so in a comment and was right.

A child breaks it. Its echo ring is drawn for any non-zero echo at any level, so
a child at day 364 carries a fragmented frame AND a ring at once. That token is
the dearest thing the piece can produce, and nothing before this measured it.

**It passes with 16,058 gas of margin -- about one percent.** That is reported
as the result, not as comfort. The piece has spent its gas headroom: before
lineage the worst case sat 250,000 gas under the limit. `GAS_BAND`, the
regression band that used to sit between the worst case and the hard limit, no
longer has room to be a band and is now pinned just under the limit. Anything
that adds drawing to a child needs a budget conversation before it is written.

Two further things had to be established to get an honest number, and both are
recorded in `GasBudget.t.sol` beside the code that does them:

**The maximal legal Mark set is smaller below a whole heart.** A day-364 token
cannot wear either side of pair 4: Vessel sets `requiresWhole` and `applyMark`
refuses it while `level < 365`, and Break needs a completed run of 365 while
`_credit` raises the level on every day it raises the run, so a run of 365
implies a level of at least 365. The dearest child therefore wears FOUR Marks --
Hush, Beat, the bought Iris in leaf, and Tint -- not five. Measured with the
impossible five-Mark set instead, the same child reads 1,020 gas higher; the
distinction turned out not to be what decided the limit, but the budget should
not rest on a token that cannot exist.

**The measurement itself was inflated.** `GasBudget.t.sol` measured
`string memory uri = t.tokenURI(id)`, which copies twelve kilobytes into the
CALLING test's memory and keeps it there. Memory is priced quadratically, so
each stage in the eleven-stage ladder was billed for expansion its own token
never caused -- the same child read 2,007,226 in the ladder and 1,990,703
alone, a gap of about 19,000 gas. The first of those is over the hard limit and
the second is not. The call is now made with `staticcall` and both return
parameters zero, so the answer is left in the return buffer and the callee pays
only for its own memory. Every figure in the file moved down by that artifact
when it was removed; the ones in the table above are the corrected ones.

### 3.7 Why the ghost fill, and what that does to Ache

The echo ring uses the existing ghost fill -- the colour that already means "not
earned by this token". Inherited days are exactly that.

`MarkRenderer.ghost()` recolours the ghost fill when a token wears Ache, so a
child wearing Ache has its echo ring recoloured too. That is ACCEPTED rather
than worked around, because the dots carry the distinction: the ring is
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

**RESULT, 2026-09-07: a child scans, with zero rejections.**
`tools/echo-decode-check.mjs` is the gate. It renders six states and decodes
each at nine pixel sizes -- 256, 350, 500, 700, 848, 900, 1080, 1424, 1600 --
through the project's ZXing oracle (`tools/test/helpers/decode.mjs`; never
jsqr, see the decode-oracle memory), and requires not merely a decode but a
decode to the token's own url. **54 of 54 passed.**

The six states are the two extremes the plan asked for, each in the Marks it
could actually be wearing, plus a control for each:

| state | canvas | svg bytes | decodes |
| --- | ---: | ---: | --- |
| newborn child, bare (level 1, echo 365) | 53 | 7,059 | every size |
| newborn child, Hush | 53 | 7,116 | every size |
| founding token, 1 solid ring (control) | 53 | 5,674 | every size |
| child at the cap, bare (level 3,650, echo 3,650) | 89 | 7,743 | every size |
| child at the cap, every legal Mark | 89 | 9,032 | every size |
| founding token, 10 solid rings (control) | 89 | 6,322 | every size |

**The controls are what make the result attributable.** A child's canvas is not
new: `canvasFor(0, echo)` is 53, exactly a founding token with one year ring,
and `canvasFor(10, echo)` is 89, exactly the founding ring cap. So each child is
paired with a founding token on the identical canvas at the identical module
size, differing only in a dotted innermost ring against a solid one. Without
that pair, a failure could not have been attributed to the ring rather than to
the canvas.

848 and 1424 are in the size list because they are 16 x 53 and 16 x 89: the
exact multiples a consumer honouring the SVG's declared intrinsic size lands
on. 350, 700 and 900 come from the existing ten-ring gate in
`render-token.test.mjs`.

A newborn child is the harsher of the two extremes and it is worth saying why:
its ring is the OUTERMOST thing on the canvas at depth 0, where the dots are
largest relative to the code, and it is the state most children will be in.

The gate runs under the memory wrapper (`~/scripts/safe-build.sh`) and reports
its own peak: **967 MB** across the 54 rasters, inside the 3 GB cap. It exits
non-zero on any rejection.

---

## 4. What a parent shows

Nothing new is drawn.

`seedsGiven` already renders as a numeric `Children` trait in both renderers.
The parent's picture is unchanged.

Two alternatives were considered:

- **The parent gets the same dotted ring**, so one echo ring means "belongs to a
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
