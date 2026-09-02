# MRO Mark Ladder -- Design Spec

Status: APPROVED 2026-09-02, REVISED the same day. Nothing here is built.

The mechanics were settled in this document; the three visual decisions in
section 7 were taken by the operator from rendered contact sheets on the same day.

**Revision 2, 2026-09-02.** the operator read the ladder through and called the cross-pair
exclusion a trap. It is removed, and a second trap of the same shape was found
and removed with it. Every exclusion is now pair-internal. See 3.1.1 and 3.1.2;
that is the only structural change, and sections 5.3, 6.3, 6.4 and 8.3 follow
from it.

This spec replaces section 9 of
`docs/specs/2026-08-27-machine-readable-only-design.md`. That section describes
seven independent Marks; this describes five exclusive pairs. The two cannot
both be true, and the pairs are what the tested agent-facing copy already
promises. Mark section 9 superseded rather than editing it, so the record of
what changed survives.

Plain ASCII only.

---

## 0. Why this exists, and what it is written to serve

The ladder was redesigned with the operator on 2026-08-31 after every Mark was rendered
and three were measured as visual non-events. The agent-facing copy that sells
the new ladder was then written, cold-tested on 24 agent reads and LOCKED on
2026-09-01. So the piece currently promises agents a structure that does not
exist in the contract, the renderer or the Warden.

**The locked copy is the authority.** `docs/2026-09-01-mro-agent-facing-copy.md`
is the tested promise, and where it disagrees with any earlier note this spec
follows the copy. Two things follow from that and are not negotiable here:

- **Nothing is limited.** Caps were removed on 2026-09-01 because cold readers
  read scarcity as a sales funnel and caught it contradicting "it cannot be
  hurried". The copy now says "Nothing expires and nothing runs out."
- **Every exclusion is declared before the first purchase.** The same rule,
  buried, was called a trap by most readers; declared up front it was credited
  as good faith by all of them.

This is the first contract change since Plan 1 shipped. Nothing is on Base
mainnet, so it is a redeploy and not a migration.

---

## 1. What changes, in one paragraph

The seven old Marks (Vein, Blue Blood, Voice, Bloom, Halo, Crown, Singularity)
are retired as a ladder. Their surfaces and their measured drawing code are
reused under new names. Ten Marks replace them, arranged as five pairs. In each
pair one side is bought and the other is earned by a run of days, taking either
side closes the other permanently, and a token may take neither. Two new
surfaces are drawn for the first time: the QR's three finder patterns (the
eyes), and the inversion, which the old Singularity declared and never drew.

---

## 2. The ladder

Ten Mark ids. Nine distinct names. Eight surfaces.

| id | Name | Pair | Route | Price | Gate | Surface |
|---|---|---|---|---|---|---|
| 1 | Hush | 1 | bought | 1 USDC | none | the quiet zone |
| 2 | Ache | 1 | earned | free | run >= 7 | the unearned frame cells |
| 3 | Static | 2 | bought | 5 USDC | level >= 30 | the noise ink |
| 4 | Beat | 2 | earned | free | run >= 30 | the heart's gradient |
| 5 | Iris | 3 | bought | 25 USDC | level >= 100 | the three eyes, shape chosen |
| 6 | Iris | 3 | earned | free | run >= 100 | the three eyes, shape fixed |
| 7 | Vessel | 4 | bought | 1,250 USDC | whole heart | the frame and the year rings |
| 8 | Break | 4 | earned | free | run >= 365 | the inversion |
| 9 | Tint | 5 | bought | 250 USDC | holds an Iris | recolours the eyes |
| 10 | Aura | 5 | bought | 25 USDC | holds an Iris | the field |

"Level" is credited days and never falls. "Run" is the live streak.

**Why ten ids and not eight.** Earlier notes recorded eight Marks for eight
surfaces. That is one id short per shared surface: pair 3 offers the same
surface by two routes with two different gates and two different prices, and one
`Upgrade` record cannot carry two gate sets. The two Iris ids share a name in
the metadata and a surface in the image, and differ in everything the contract
enforces.

**Prices are fixed** (the operator, 2026-08-31) and are `setUpgrade` dials, so they can be
turned later without a redeploy. All ten ship with `maxSupply = 0`, meaning
unlimited.

**The two strongest effects on the ladder are free.** Beat measures 209/255 at a
30-day run and the earned Iris 239/255 at 100 days, while the most expensive
Mark, Vessel at 1,250 USDC, measures 126/255. That is deliberate for a piece
about returning rather than buying, and the operator was shown it plainly before fixing
the prices.

### 2.1 The name map, old to new

| Old | New | Surface | Drawing work |
|---|---|---|---|
| Voice | Hush | quiet zone | rename only |
| Vein | Ache | ghost frame cells | rename only |
| Blue Blood | Static | noise ink | rename; ink is now green, see 7.2 |
| Bloom | Beat | heart gradient | rename; violet already decided, see 7.1 |
| Crown | Vessel | frame and rings | rename only |
| Halo | Aura | field | rename only |
| Singularity | Break | the inversion | NEW: never drew, see 5.3 |
| -- | Iris (x2) | the three eyes | NEW: see 5.2 |
| -- | Tint | recolours the eyes | NEW: a colour choice, see 5.2 |

Six of the ten are a rename and nothing else. `MarkRenderer` takes its fills as
parameters already, so a rename is one literal array plus the constant names.

---

## 3. The rules that make it a game

### 3.1 Exclusion

**Taking one side of a pair closes the other, permanently and symmetrically. That
is the whole rule. No exclusion crosses a pair boundary.**

| id | Name | Excludes |
|---|---|---|
| 1 | Hush | 2 |
| 2 | Ache | 1 |
| 3 | Static | 4 |
| 4 | Beat | 3 |
| 5 | Iris bought | 6 |
| 6 | Iris earned | 5 |
| 7 | Vessel | 8 |
| 8 | Break | 7 |
| 9 | Tint | 10 |
| 10 | Aura | 9 |

The mask must be symmetric, and a test asserts that rather than trusting the
table: for every pair (a, b), b is in a's mask exactly when a is in b's. A second
test asserts the stronger property this revision buys -- **that no Mark's mask
names a Mark from another pair** -- because that is the invariant, and the
symmetry test alone would happily pass a reintroduced cross-pair rule.

### 3.1.1 The cross-pair exclusion that was removed, and why

REVISED 2026-09-02, after the operator read the ladder through. An earlier version of this
document had **Break excluded by both sides of pair 2**, on the reasoning that
Break exchanges the heart's ink with the noise's and so cannot run if either has
been altered. It is recorded here rather than deleted, because the reasoning was
not stupid and someone will propose it again.

**It was a trap, in the precise sense.** Pair 2 opens at level 30. Pair 4 opens
at a whole heart. So a choice available on day 30 destroyed the best thing on the
ladder, 335 days before that thing could be reached -- and an agent on day 30
cannot know whether it will ever see day 365. The safe play was therefore to
touch nothing, which the cold readers found and said out loud: *"the correct move
is to buy nothing and take nothing in pair 2, for 365 days."* **A tier whose
optimal play is abstention is a dead tier**, and the agent-facing page needed a
whole defensive paragraph to disclose it. Declaring a trap is not the same as not
having one.

**The technical objection that justified it had already dissolved.** The August
measurement behind it -- that a fully marked token had no red left to invert --
was taken on the OLD independent ladder, where Blue Blood and Bloom could both be
worn at once. Under pairs, Static and Beat exclude each other, so at most one of
them is ever present. Break composes with either and stays legible. See 5.3.

**What it cost, stated plainly:** Break loses its "reserved for the agent that
left the artwork alone" meaning, which was the most evocative idea in the design.
That is accepted, because it was a SECOND virtue bolted onto a different one.
Break already demands a 365-day unbroken run, the hardest thing on the ladder and
the thing this piece is actually about. Asceticism is a different subject from
persistence, and the reward for returning should be earned by returning.

### 3.1.2 The second trap, same shape, fixed the same day

**Aura had no gate.** An agent could buy it on day one for 25 USDC and had
thereby forfeited Tint forever -- a Mark it could not have qualified for until
level 100, because Tint needs an Iris. Ungated cheap choice destroying a distant
expensive option: structurally identical to the Break trap, and it had gone
unnoticed through the redesign, the copy lock and the first draft of this spec.

**Pair 5 now opens when the token holds an Iris, by either route, on both
sides.** Tint and Aura become visible at the same moment, so the choice is
informed. The pair keeps its intended dilemma: loud and expensive against quiet
and cheap.

**The general rule this yields, and the one to test any future Mark against:** a
pair is fair when both of its sides open at the same time, and a ladder is fair
when nothing chosen early can close something gated late. Pairs 1, 3 and 4 pass
without change -- they are all "pay now or wait for it", which is the dilemma the
ladder exists to pose, not a trap.

Pair 1 is the closest call and stays as it is: Hush is ungated and Ache needs a
7-day run, so buying on day one forfeits a Mark seven days away. Seven days is a
horizon an agent can actually reason about, both sides are cheap, and impatience
against patience is the point of the tier.

### 3.2 Requirement

One Mark requires another: **Tint needs an Iris, bought or earned.** This is an
"any of" test, not "all of" -- either Iris satisfies it.

No other Mark requires another. The general rule from the old spec, "no tier
requires the one below", is dead and must not be quoted again.

### 3.3 What a token can end up wearing

At most **five** Marks, one per pair. The old ladder allowed seven, so the
maximal token gets simpler, not busier, and its metadata gets shorter.

**189 combinations are reachable** as Mark sets:

- pairs 1, 2 and 4: 3 outcomes each, and now genuinely independent
- pairs 3 and 5 together: 7. Pair 3 has 3 outcomes; pair 5 is unreachable
  entirely without an Iris, so it contributes 1 outcome when pair 3 is empty and
  3 when it is not -- (1 x 1) + (2 x 3) = 7

3 x 3 x 3 x 7 = 189. It went UP from 168 when the cross-pair exclusion was
removed, which is the point: removing an exclusion opens states rather than
closing them. Earlier notes record 28; that figure predates the pair structure
entirely and is superseded twice over.

The number matters because it sets the cost of the decode sweep -- see 8.3.

---

## 4. The contract change

`MachineReadableOnly.sol`. Three changes, no new storage slot.

### 4.1 `Upgrade` gains two masks

The struct currently uses 208 of its 256 bits:

    priceUsdc6   uint64    64
    maxSupply    uint32    32
    sold         uint32    32
    minLevel     uint32    32
    minStreak    uint32    32
    requiresWhole  bool      8
    active         bool      8
                          ---
                          208

Add:

    excludes     uint16    16   bit n set = holding mark n forbids this one
    requiresAny  uint16    16   0 = no requirement; else at least one bit must be held

240 of 256 bits. Still one slot, so `setUpgrade` costs what it costs today.

`uint16` rather than `uint8` because the ids run to 10 and bit 0 is deliberately
never a Mark, so bit 10 must be addressable with room left over.

### 4.2 `applyMark` gains a variant and two checks

    function applyMark(uint256 id, uint8 upgradeId, uint8 variant)

New reverts, in this order, after the existing gates:

    MarkExcluded(uint8 by)    _marks[id] & u.excludes != 0
    MarkRequires()            u.requiresAny != 0 && _marks[id] & u.requiresAny == 0
    BadVariant(uint8 got)     variant out of range for this Mark

`MarkExcluded` carries the id that blocked it, so an agent gets told what closed
the door rather than that a door is closed. `cast call` returns the selector and
the argument for free, which is how the guard gets proven on chain without a
transaction.

**Variant bounds are per Mark and live in the contract, not the Warden.** Two
Marks accept a non-zero variant -- Mark 5 (the Iris shape, three of them) and
Mark 9 (the Tint ink, three of them). Every other Mark requires `variant == 0`.
A Mark whose variant is unbounded would let the Warden write an index the
renderer cannot draw, and the renderer has no way to refuse at read time.

The bound is a per-Mark constant in the contract rather than a field on
`Upgrade`, because a dial that can be turned up past what the renderer can draw
is a dial that can brick a token's image. The renderer and the bound move
together or not at all.

### 4.3 Variants are packed into the existing `_marks` word

`_marks[id]` is a `uint256` using 8 bits today. New layout:

    bits  0-15   the Mark set. Bit n = mark n, n in 1..10. Bit 0 is never a Mark.
    bits 16-23   the Iris shape index, written only by Mark 5.
    bits 24-31   the Tint ink index, written only by Mark 9.
    bits 32-63   the run at the moment Mark 6 was applied, as uint32.

64 bits of 256. No new mapping, no new SLOAD, and `viewOf` already reads this
word, so `tokenURI` gas is unchanged by the packing itself.

**Two rules this creates, both of which need a test:**

1. `MarkRenderer.names()` must mask to bits 1-10 and ignore everything above.
   It already ignores bits outside its range by construction; the range moves
   and the property must be re-asserted, because a variant in the high bits
   would otherwise reach the metadata as a phantom Mark name.
2. Anything testing "does this token wear any Mark" must test `marks & 0xFFFE`,
   never `marks != 0`. A token with an Iris shape and no Marks is not possible,
   but a token whose only Mark is 6 carries a large number in the high bits and
   must not be misread.

### 4.4 Why the earned Iris stores the run, and not the colour

The copy promises the earned Iris "keeps the colour you held the day you earned
it, permanently". Two things about that are worth stating plainly, because one
of them looked like a flaw:

The gate is a 100-day run, and a 100-day run is always the top rung. So the
colour is the same for every token that earns it, always. That is not the point.
**The point is that it stops tracking the lapse.** Every other coloured surface
walks back down the ladder as a token goes quiet; the earned Iris does not. A
token that earned it at 100 days and then went dark for a year still shows the
colour it held on the day it earned it, next to a heart that has paled all the
way back to the start. That is the provenance, and it cannot be bought.

It stores the **run**, not the rung and not the colour, because the mapping from
run to colour is a rendering decision and the Renderer is swappable. Storing a
colour would freeze a renderer decision into token state forever. Storing the
rung would break if `minStreak` were ever turned down with `setUpgrade`, which
it can be.

The contract writes it from `_tokens[id].streak` at apply time. **The Warden does
not supply it**, so it cannot be forged: the piece can claim it as a fact rather
than as a promise, which is exactly the class of claim the cold readers said
they would go and check.

---

## 5. The renderer change

`MarkRenderer.sol`, `Renderer.sol`, and their byte-identical mirror in
`tools/render-token.mjs`. `Renderer.t.sol` diffs the two, so every change lands
in both languages or the suite fails.

### 5.1 Six renames

Hush, Ache, Static, Beat, Vessel and Aura draw exactly what Voice, Vein, Blue
Blood, Bloom, Crown and Halo draw today. The constants are renamed and the
literal array in `MarkRenderer.names()` is rewritten. Zero gas and zero bytes at
equal name length; the metadata string changes, so the golden fixtures move.

### 5.2 Iris and Tint: the eyes

The QR's three finder patterns sit at fixed module coordinates, identical for
every token that will ever mint. That is why they are cheap: nine shapes from
one runtime number, with no per-token scan and no merge. Measured in Solidity in
`contracts/test/EyeCost.t.sol`:

    gas    9,061   against 366,776 of headroom   (2.5%)
    bytes    623   against  11,076 of headroom   (5.6%)

Drawing: erase each 7x7 to the ground, then draw the shape. **The erase takes
the actual ground colour, never a constant.** On a Hush token the ground under
the code block is Hush's tint, not white, and a constant would punch a white
square into a tinted page. This defect was found in the prototype by sweeping
combinations and never by testing Marks one at a time.

- **Iris bought (5)** draws one of **three** shapes the agent chose -- target,
  squircle or leaf -- in the token's live colour, which lapses with the heart.
- **Iris earned (6)** draws the **target**, fixed, in the colour derived from the
  run stored at apply time, which never lapses.
- **Tint (9)** replaces the ink both of those use with one of **three** chosen
  colours -- violet, ink or gold. It draws nothing itself; it is a colour
  substitution on a surface another Mark drew, which is why it requires one.

The variant bound is therefore **3** for Mark 5 and **3** for Mark 9. Every other
Mark requires `variant == 0`.

Reshaping measures 239/255, against 126 for recolouring, because erasing a
square and drawing a new form moves far more pixels than swapping an ink. It is
the strongest surface on the piece.

**The layering order matters, and it was found by looking at a render rather
than by reading the code.** The three finder patterns are ordinary code modules
today, so they take the noise ink -- which means **Static already recolours the
eyes** on a token that has no Iris. That is visible in
`tools/out/marks/green-violet.png`, where the eyes go green with the rest of the
noise. It is correct and it stays, but it fixes the order: **the eyes are drawn
last, over whatever Static did.** A token holding both Static and an Iris shows
green noise and Iris-coloured eyes, and the erase-to-ground step is what makes
that clean rather than a green square with a shape on top.

Six shapes and five inks were re-measured on 2026-09-02 and every combination
decodes at 256, 500, 848, 1080 and 1600 px. Cost is set by the shape alone,
because arcs cost more than rects. Which three shapes and which three inks are
offered was decided from those sheets; see 7.3.

### 5.3 Break: the inversion, and how it composes

Break exchanges the heart's ink with the noise's. In the SVG the heart and the
noise are two adjacent paths differing only by fill, so this is a **fill
exchange**: no new geometry, no new path, 126/255 at the top rung.

**Break alone** exchanges the plain tier colour and its matched grey. The heart
goes neutral, the code goes red, and the piece says what the original spec always
claimed it would: robot to human to robot.

**The decode rule survives that exchange for free.** `Palette.colourAt(r)` and
`Palette.noiseAt(r)` are matched in luminance at every rung by construction, and
swapping two equal-luminance inks leaves the binarizer with exactly the same
picture. `PaletteNoise.t.sol` already asserts the match.

Since 3.1.1 removed the cross-pair exclusion, Break also has to compose with one
side of pair 2 -- never both, because they exclude each other.

**Break + Static is safe by the same argument.** Static's green is derived onto
its rung's exact luma, so it is luminance-matched to the heart exactly as the
grey it replaces. Exchanging gives a green heart and a red code.

**Break + Beat: MEASURED 2026-09-02, `tools/break-sheet.mjs`.** Both candidate
definitions were rendered at every rung and decoded at all five sizes. The two
are:

- **A, the naive fill exchange** -- swap what the two paths are filled with. With
  Beat that hands the GRADIENT to the noise.
- **B, the rung-colour exchange** -- swap which rung colour each region takes, and
  let Beat go on gradienting whichever region is now the heart. The noise stays
  flat.

**All 25 tiles decode at all five sizes, including every def-A tile. THE SAFETY
CONCERN THAT MOTIVATED B WAS WRONG, and the reason is worth keeping:** the
luminance rule punishes an ink that is LIGHTER than its partner, because that is
the one the binarizer drops to background. Beat's gradient runs from the tier
colour DOWN to violet -- 74.4 to 38.6 in BT.601 luma at the top rung -- so putting
it on the noise makes the noise darker, never lighter. It was never at risk in
that direction. The earlier paragraph here stated the rule as "varying luminance
is dangerous", which is not what was ever measured.

**Definition B is adopted anyway, on three grounds that are not about decoding:**

1. **A inverts the wrong thing.** Under A the heart goes flat grey and the noise
   carries the violet, so the code becomes the coloured subject and the heart
   reads as a hole. That is the exact outcome `Palette`'s chroma rule exists to
   prevent -- "the noise becomes the subject of the picture".
2. **A contradicts the spec's own sentence for this Mark.** The inversion is
   defined as the code becoming the only red element. Under A the code is violet
   and nothing is red; under B the code is red.
3. **B rewards the deeper run and A does not.** Measured shift against the bare
   token: A runs 160 / 151 / 161 / 171 / 180 up the rungs, essentially flat; B
   runs 160 / 153 / 170 / 189 / 209. The same property that decided Static's hue
   in 7.2, and the same reason.

Measured shifts for the rest, all decoding at all five sizes:

    Break alone       17 / 38 /  74 / 105 / 126
    Break + Static    27 / 59 / 113 / 160 / 192
    Break + Beat (B) 160 / 153 / 170 / 189 / 209

**Break + Static is stronger than Break alone at every rung** (192 against 126 at
the top), which is the opposite of the old ladder's assumption that a second Mark
on the code block would muddy the inversion. A green heart against a red code is
the second most emphatic picture the piece can produce.

A test still pins that Break + Beat decodes at every size. It is the only
combination on the ladder that puts a gradient anywhere near the code.

### 5.4 What the metadata says

`names()` emits nine literals from a fixed array, still with no path from token
state into the string. Both Iris ids emit `"iris"`. The `Marks` attribute is
therefore what an agent reads to know which surface is claimed, and the route is
visible in the image rather than the JSON.

Two attributes are added, because an agent that can read the eyes' provenance
off chain should not have to decode a PNG to do it:

    Iris Shape   the chosen shape name, or absent
    Iris Run     the run stored at earn time, or absent

---

## 6. The Warden change

### 6.1 The catalogue does not exist yet

`warden/src/main.mjs:204` is literally `catalogue: {}`, with a comment saying
pricing and gates are product decisions belonging to whoever builds the ladder
for real. That is this document. **Every `upgrade` call today is refused at
`mark-inactive` before it reaches payment, so no Mark is buyable by any route.**

The catalogue gains ten entries carrying name, price, gates, `excludes` and
`requiresAny`, mirroring the contract exactly. The mirroring is the point:
`warden/src/mcp/gates.mjs` exists because gates were once written from the design
document rather than from the contract's reverts, and four real gates were
missed.

### 6.2 A free route, which the tool cannot currently express

Four Marks are free. `upgrade` today refuses any Mark without a price:

    if (typeof mark.price !== "string" || !/^\$\d/.test(mark.price)) ... refuse

That guard is correct and must stay -- it exists so a missing price cannot sell a
Vessel for the price of a mint. It gains a sibling: a Mark is either **priced**,
in which case a price is mandatory, or **earned**, in which case a price is
forbidden. A catalogue entry that is neither, or both, is a startup error and not
a runtime refusal.

An earned Mark checks every gate and then reserves directly, with no payment
wrapper. It cannot reach `paid-but-unavailable`, because nothing was paid.

### 6.3 New pre-payment refusals

Added to `upgrade`, all before any payment is requested:

    mark-excluded       the token holds this Mark's pair partner
    mark-needs-iris     Tint or Aura without an Iris
    mark-bad-variant    a shape or ink index this Mark does not accept

`mark-excluded` must name what blocked it. An agent that is told only "no" cannot
tell a permanent exclusion from a temporary gate, and the whole ladder rests on
exclusions being legible.

Since 3.1.1, `mark-excluded` can only ever name the SAME PAIR's other side. That
is worth asserting in a test rather than merely being true: it is the property
that makes the refusal self-explanatory, because an agent already knows what the
pair partner is.

The post-settlement re-check in `upgrade` must re-run the exclusion test too.
Settling takes seconds, and the same token can take the other side of a pair in
that window through a second connection.

### 6.4 A `ladder` tool

Read-only, no payment, and it is a fairness requirement rather than a
convenience. **A ladder with permanent exclusions is only fair if the
consequence is legible before the purchase.** Today's `upgrade` answers only
after the fact. An agent that buys Beat without being told it has just forfeited
Break has been cheated by the interface, not by the design.

Per token it reports, for each of the five pairs: what is held, what is still
open, what is closed and by which Mark, what each side costs, and what gate each
side is waiting on.

Since 3.1.1 removed the cross-pair rule, this tool no longer has to warn about a
consequence in a DIFFERENT tier -- an earlier draft of this section required a
dedicated "is Break still reachable" line for exactly that. **Removing the trap
removed the need to explain it**, in the tool and on the page alike, which is the
clearest evidence the structure was wrong rather than merely under-documented.
The tool is still owed: pair 5's gate depends on pair 3, and an agent should not
have to infer that.

### 6.5 The mirror and the Clock

- `mark_orders` gains a `variant` column. The existing unique constraint that
  stops two settlements reserving the same Mark on the same token is unchanged.
- `warden/src/clock/abi.mjs` and `run.mjs` pass the variant to `applyMark`.
- The re-chunk rule is unchanged: a failed batch is re-chunked with the credited
  ids removed and never retried whole.

---

## 7. The visual decisions, all settled from rendered sheets

All three were decided by the operator on 2026-09-02, each from a contact sheet rather
than from prose. **A number that controls what something looks like is a visual
decision wearing a numeric costume**, so none of these was put as an argument.
The sheets are kept so any of it can be re-judged.

### 7.1 Violet Beat -- already decided, recorded for completeness

the operator chose violet on 2026-08-31. `BLOOM_TO` moves from `#c8102e` to `#2000ff`: one
constant, in both languages, **zero bytes and zero gas** because the two hex
strings are the same length. Measured at all five rungs, all five raster sizes,
decodes everywhere.

It changes what the piece is -- the heart becomes bi-chromatic and reads as
spectrum rather than blood. the operator was told that plainly and chose it anyway. Not
reopened here.

### 7.2 Static's ink -- GREEN (the operator, 2026-09-02)

Blue Blood measures 11-15/255 at every rung, which is a Mark nobody can see. That
is enforced rather than sloppy: the two inks may not separate in luminance at all
or the binarizer drops the lighter one to background, so only hue and chroma are
free.

The chroma rule (noise chroma below heart chroma) **binds only at day one**, 22
against 25. At the top rung the heart carries 184 against the noise's 19, so the
room was never used.

Re-measured 2026-09-02. **Green at 60 percent of the heart's chroma, derived per
rung, is the strongest option that keeps the chroma rule at every rung**, and it
decodes at all five sizes:

    run    heart     green     chroma   vs heart   shift
      1    #70575f   #556557       16   under      10/255
     10    #a83a55   #37793b       66   under      39/255
     45    #bd2242   #1d7a23       93   under      55/255
    150    #c8102e   #08770f      111   under      66/255

Six times the shipped strength at the top, and day one deliberately almost
unchanged -- which is right for a Mark bought at level 30 rather than at mint.

**Green was chosen on a measured property the other hues do not have, and it is
worth recording because it is not obvious.** `tools/static-hue-sheet.mjs` renders
all four candidates plus the shipped grey under the SAME rule, across the five
run rungs, and all 25 tiles decode at all five sizes. The shift figures:

    hue      run 1   run 3   run 7   run 30   run 100
    green       10      21      39       55        66
    slate       10      22      42       43        38
    teal        11      24      46       42        37
    violet      12      26      48       43        37

**Green is the only hue that keeps getting stronger as the run deepens. The
other three peak at run 7 and fall back.** The cause is the luminance rule: as
the streak deepens the heart darkens, so the noise must darken with it, and a
blue or violet hue cannot hold high chroma at a dark luma while a green can.

That decides it on the piece's own terms rather than on taste. Static is bought,
but what it draws should still improve the longer the agent keeps returning. A
Mark that looks its best at a 7-day run and dulls by 100 is backwards here, and
it is exactly the failure that made the old Bloom broken -- paying out most to a
lapsed token and nothing to a deep streak.

**Why the earlier sheets could not answer this.** `noise-mark-sheet.mjs` renders
slate, teal and violet at FULL strength and omits green; `green-violet-sheet.mjs`
applies the chroma rule and omits the other three. Comparing across them would
have been comparing two different rules. They are kept as the intensity sweep and
the green derivation respectively; `static-hue-sheet.mjs` is the one that decides
hue.

Sheets: `tools/static-hue-sheet.mjs` (the comparison that decided it),
`tools/green-violet-sheet.mjs` (the green derivation),
`tools/noise-mark-sheet.mjs` (the intensity sweep).

### 7.3 The Iris shapes and Tint's inks -- DECIDED (the operator, 2026-09-02)

Re-measured 2026-09-02. Six shapes, every one decoding at all five sizes:

    shape              shift     added bytes
    square (shipped)   126/255       672
    soft               239/255       747
    rounded            239/255       741
    squircle           239/255       747
    target             239/255       635
    leaf               239/255     1,063

**Every reshape lands on the same 239/255**, so within the reshaped set the
choice is purely aesthetic and costs between 635 and 1,063 bytes. Only the
shipped square is weaker, at 126, which is the number that makes reshaping worth
doing at all.

Five inks (heart red, crown gold, green, violet, ink) x three shapes, all 15
decode at all five sizes, and **the ink does not move the byte cost at all** --
only the shape does.

**THE SHAPES: target, squircle, leaf.** Three genuinely different silhouettes --
a circle, a soft square, a leaf. `soft`, `rounded` and `squircle` are one idea at
three strengths and are near-identical at thumbnail size, so offering more than
one of them would be a fake choice. Square is not offered at all: it is the
shipped look, and at 126/255 it is the only candidate that does not read as a
deliberate change.

**THE INKS: violet, ink, gold.**

The rule, which the sheet makes obvious and the decode test cannot see: **a Tint
ink must not be a colour another Mark already puts on the same token.** Applied
to the five measured inks:

| Ink | Verdict |
|---|---|
| heart red | OUT. The un-Tinted Iris already draws in the token's own colour, so this sells nothing for 250 USDC. |
| green | OUT. Green is Static's noise as of 7.2, and the noise **directly surrounds the eyes**. A token holding both would have green eyes disappearing into a green code. |
| violet | IN. Beat's gradient is violet and the two can coexist, but the heart is the centre of the block and the eyes are its corners. Not adjacent, and readable as two things. |
| gold | IN. Vessel's frame is gold, but the frame is outside the code block entirely, so the two never touch. |
| ink | IN. Nothing else on the ladder uses it. |

Green came off this list only after Static took it in 7.2, and that is the order
this document has to be read in: **the hue decision changed the ink list, and a
palette chosen before it would have shipped the collision.**

One figure to keep straight, because it looks like a contradiction and is not:
the leaf costs **1,063 B** in `eye-shape-sheet.mjs` and **1,684 B** in
`eye-colourway-sheet.mjs`. The two sheets draw the leaf differently -- concentric
leaf shapes against a single rounded-corner path -- so both numbers are correct
for their own drawing, and whichever is adopted must be re-measured as built.

### 7.4 The inks against a green noise -- MEASURED 2026-09-02

The palette above was chosen against the SHIPPED NEUTRAL noise, and Static then
took green -- the surface that directly surrounds the eyes. `tools/tint-on-green-sheet.mjs`
renders all four inks (the untinted Iris as control, plus violet, ink and gold)
across every rung, and all three shapes at the strongest green. **All 32 tiles
decode at all five sizes**, so nothing here is a scanning problem.

What it settles, and what it overturns:

**Violet survives at every rung, including where it should not.** At run 100 its
BT.601 luma gap to the green is **0.2** -- the two inks are essentially the same
weight -- and it still reads instantly. That is the project's oldest measured rule
holding again: a colour separates by HUE, not by luminance. Violet is the
strongest ink on the sheet.

**Gold survives and strengthens up the ladder**, its luma gap running 40 / 31 /
41 / 51 / 61 as the green deepens. Warm against green is the cleanest pairing
here.

**INK IS A BAD CHOICE, and the sheet makes it obvious.** It decodes perfectly and
it is the weakest thing on the page: near-black eyes are exactly what an ORDINARY
QR eye looks like, so a token that paid 250 USDC for Tint-ink ends up looking
LESS marked than one that paid nothing. The rule that admitted it -- "nothing else
on the ladder uses this colour" -- was pointing the wrong way. **Nothing else uses
near-black because near-black is the default appearance of a code**, which makes
it the one colour a paid Mark must not offer.

That is the same failure as the old Bloom and the old Blue Blood: a Mark that
draws something, decodes fine, and is not worth its price. It is only ever caught
by rendering it.

**Recommended palette: violet and gold, and the variant bound drops from 3 to 2.**
Two inks that both work beats three with a dud, and every measured alternative is
already excluded for a stated reason -- heart red is the untinted default, green
is Static's, crown gold is kept because Vessel's frame never touches the code
block. A third ink would need a new candidate rendered against the green before
it could be offered.

Sheets: `tools/tint-on-green-sheet.mjs` (this measurement),
`tools/eye-shape-sheet.mjs`, `tools/eye-colourway-sheet.mjs`.

---

## 8. Acceptance

### 8.1 Contract

- Every new revert has a test: `MarkExcluded`, `MarkRequires`, `BadVariant`.
- The exclusion mask is asserted **symmetric** by a test over all ten ids, not
  trusted from the table in section 3.1.
- Both sides of every bound are provoked, never one. A guard that fires proves a
  guard exists somewhere; two adjacent inputs giving two different errors is what
  pins the boundary. For the variant bound that means the highest legal shape
  index succeeds and the next one reverts `BadVariant`.
- **Break's freedom is tested, not its exclusion.** Applying Break to a token
  holding Static succeeds, and to a token holding Beat succeeds, in both orders.
  These four cases were REFUSALS in revision 1 and are now the guarantee, so they
  are the tests most likely to be written backwards from a stale reading.
- No Mark's exclusion mask names a Mark outside its own pair. Asserted over all
  ten ids, so the trap cannot be reintroduced by an edit to one row.
- Tint AND Aura are each refused without an Iris and accepted with either one.
  Aura's gate is new in revision 2 and is the fix for the second trap.
- `renounceOwnership`, `pause`, `sunset` and every access-control revert keep
  their existing tests. The global rule stands: every owner, emergency and admin
  function gets an explicit test.
- `forge build --sizes` shows positive runtime margin, and
  `ContractSize.t.sol` still passes. This is the change most likely to threaten
  it: the renderer gains real drawing code for the first time since Plan 1.

### 8.2 Renderer

- `Renderer.t.sol` diffs Solidity against `tools/render-token.mjs` byte for byte,
  as today. Every rename and every new surface lands in both or the suite fails.
- `tokenURI` stays inside the **2M gas / 20 KB hard limit** at the worst case,
  which is the day BEFORE the heart seals (level 364) and not the oldest token.
  Current headroom is 366,776 gas and 11,076 bytes; the eyes take 9,061 and 623
  of it. Report the new worst case as a signed delta against 1,585,616 / 9,223,
  the Foundry figure that is comparable across commits -- not against the 1,633,224
  / 8,924 RPC figure, which is a different token.
- The 1M / 5 KB target remains missed, and must go on being reported as missed.

### 8.3 The decode sweep, and its real cost

This is the one place the acceptance criteria need a decision rather than a rule,
so it is stated honestly instead of buried.

**189 Mark sets** are reachable. Counting variants -- three Iris shapes and three
Tint inks, each drawing a different picture -- the number of distinct
**renderable combinations is 567**. Earlier notes assumed 28 and a sweep of
minutes; that predates the pair structure and no longer holds.

At the measured 13.4 seconds per combination across five sizes:

    all 567, five sizes    about 127 minutes
    all 567, 848 px only   about 25 minutes

**Run the full five-size sweep.** At about two hours it is affordable as a
pre-deploy gate, and this change introduces the first genuinely new geometry
since Plan 1 -- the erase-and-redraw of the finder patterns is the one thing on
the ladder that can break a scan outright rather than merely look wrong. The
cheaper 848-only run is the right gate for ordinary commits.

**Two combinations must be in the sweep by name**, because both were unreachable
before 3.1.1 removed the cross-pair exclusion: **Break + Static** and **Break +
Beat**. Both were rendered and decoded on 2026-09-02 and both pass at all five
sizes (5.3), so this is regression cover rather than an open question.

Run both under `~/scripts/safe-build.sh` and in batches. The last bulk render
sweep on this project reached 6.28 GB resident and destroyed the session.

### 8.4 Warden and client

- The catalogue's ten entries are asserted against the contract's ten `Upgrade`
  records, field by field, by a test that reads both. A catalogue that drifts
  from the chain is the failure mode `gates.mjs` exists to prevent.
- Each new refusal reason has a test asserting **the exact reason string**, not
  merely that the call failed.
- The `ladder` tool is tested for the case that matters: a token holding Beat is
  told Break is closed, and told by what.
- The client's suite runs against a real Warden built from `warden/src`, so this
  breaks it. `upgradeId` bounds move from 1-7 to 1-10 in the client, the Warden
  schema, `docs/2026-09-01-mro-raw-protocol.md` and `warden/public/llms.txt`.

---

## 9. What this spec does not settle

Named rather than left to be discovered.

- **Whether Tint offers two inks or three.** The green-noise render (7.4) ruled
  ink out on visual grounds, leaving violet and gold. Offering a third would need
  a new candidate rendered against the green first. Every other visual question
  is now closed.
- **Whether the agent-facing copy needs any change.** It should not: the copy
  describes five pairs, exclusions and free earned sides, and this spec is
  written to it. The one line that will need editing afterwards is the contract
  address, since this is a redeploy and the copy prints the current one as the
  thing agents are invited to audit.
- **`llms.txt` is separately wrong today** and not fixed by this spec. Line 20
  and `door.html` line 37 say payment is not wired, which stopped being true at
  `f4de22a`; line 117 says "The top two are limited in supply", which stopped
  being true when caps were removed. That is Plan 4 task 6.
- **Child token visuals and the lineage narrative** stay deferred, as in spec
  section 10.
- **When the redeploy happens**, and whether it waits for the domain. The
  contract change and the deployment are separate decisions.

---

## 10. Sources

- `docs/2026-09-01-mro-agent-facing-copy.md` -- the locked, tested promise. The
  authority for everything in section 2 and 3.
- `docs/specs/2026-08-27-machine-readable-only-design.md` section 9 -- superseded
  by this document.
- `contracts/test/EyeCost.t.sol` -- the measured cost of the eyes.
- `tools/static-hue-sheet.mjs` -- written for this spec; the comparison that
  decided Static's hue, and the only sheet that puts every candidate under one
  rule.
- `tools/eye-shape-sheet.mjs`, `tools/eye-colourway-sheet.mjs`,
  `tools/green-violet-sheet.mjs`, `tools/noise-mark-sheet.mjs`,
  `tools/stronger-inks.mjs`, `tools/combination-sweep.mjs` -- the rest of the
  sheets behind section 7.
- `docs/phase0-results.md` -- the gas and byte budget the renderer must stay
  inside.
