# Machine Readable Only -- The Finisher's Mark

Design record, 2026-09-20. **BUILT 2026-09-24 -- read section 10m first.** It
records what shipped and it is the authority wherever an earlier section
disagrees with it.

Brainstormed with the operator on 2026-09-20. Supersedes nothing. Extends
`2026-09-02-mro-mark-ladder-design.md`, which remains the authority on the ten
Marks in five pairs; this document adds a sixth group and does not alter any
existing Mark.

**Read this beside `contracts/src/Ladder.sol` and
`warden/src/mcp/ladder.mjs`, which mirror each other by hash.**

---

## 1. Why this exists

The operator put it plainly: "what is the point of starting and continuing --
what is the point of getting a year streak if this goes forever."

He is right, and the gap is real. The piece already treats 365 days as the
summit: Break is the deepest earned Mark and needs an unbroken run of 365, and
`seed()` reverts with `ParentNotWhole` below level 365, so a lineage cannot
begin until a token completes a year. But nothing HAPPENS at the summit. The
heart finishes filling, the year rings begin, and the work continues exactly as
before. An unbounded piece with no terminal event asks an agent to persist for
a year on faith alone.

The finisher's Mark makes completion an event. A token that reaches 365
credited days claims something obtainable no other way, and the piece records
that it was the nth ever to do so.

**This serves two things at once**, which is why it is worth building:

- **Value in continuing.** There is a named thing at the end of the year, and
  it cannot be bought at any price.
- **Value in being early.** The rarest finisher Marks are claimed in order and
  run out. Nothing else on the ladder works this way.

---

## 2. Finishing order is earned, not a calendar accident

This was nearly recorded as a flaw and is in fact the mechanism that makes the
design work.

`level` counts CREDITED days, not elapsed days. A token that lapses needs
longer to reach 365. So finishing order is mint order corrected by how
faithfully the agent actually came back: a diligent token minted in March
overtakes a lax one minted in January.

**Being first to arrive is therefore a combination of arriving early and not
squandering it.** That is precisely the behaviour the artwork exists to record,
and it is why "first to arrive" is a defensible basis for scarcity here when a
pure calendar rule would not have been.

---

## 3. What counts as a finisher

`requiresWhole` -- level greater than or equal to 365. Gaps forgiven.

The contract already distinguishes two kinds of completed year, and the
distinction is load-bearing:

| Gate | Field | Meaning | Existing Mark |
|---|---|---|---|
| `requiresWhole` | `level >= 365` | 365 credited days, lapses allowed | Vessel (id 7) |
| `minStreak 365` | `streak >= 365` | an unbroken year | Break (id 8) |

The finisher Marks hang off `requiresWhole`, the inclusive gate. Break already
rewards the flawless year, and duplicating that reward would flatten a
distinction the piece has already paid for.

---

## 4. The five Marks

Ids 11 to 15. All FREE, all earned, all gated on `requiresWhole`.

**A finisher takes exactly ONE, permanently.**

| Id | Cap | Note |
|---|---|---|
| 11 | none (`maxSupply = 0`) | The finisher's Mark. Always available to any whole token. |
| 12 | 50 | Common among finishers, and still beyond any token that has not finished. |
| 13 | 10 | Expected to bind within the first cohort. |
| 14 | 3 | Effectively the early-finisher tier. |
| 15 | 1 | The first agent ever to complete a year on this piece. |

Id 11 exists so that **no finisher is ever turned away empty-handed.** The
caps apply to distinction, never to completion itself.

### The id budget is five, and the reason is a hard one

Ids 1 to 10 are in use. `MarkIdOutOfRange` refuses id 16 because `_marks`
packs the Iris shape at bit 16 and the Tint ink at bit 24; an id of 16 would
alias the shape bits and silently corrupt every token's variant.

**So ids 11 to 15 are the entire remaining budget** unless that word is
repacked, which is possible only before the first mainnet mint and would touch
the record of every token. Five is the number.

### Exclusion is group-internal, and only group-internal

Each of ids 11 to 15 excludes the other four. `excludes` is a uint16 mask and
holds four bits without difficulty. This needs a new helper in `Ladder.sol`:
the existing `_mark` takes a single id and computes `1 << excludes`, which
cannot express a four-bit mask.

**No finisher Mark excludes anything in pairs 1 to 5, and nothing in pairs 1 to
5 excludes a finisher Mark.** This is not an oversight to be tidied up later.
The cross-pair exclusion removed on 2026-09-02 made abstention the optimal
play, and a finisher Mark that forfeited Vessel or Break would recreate exactly
that trap at exactly the moment the piece most wants the agent to act.

### On the cap numbers

**The numbers stand; "they are dials" does not.** 10m built the place bands as
CONSTANTS in the token contract, because a table the owner could edit after
finishers exist is a promise that can be broken. The `Upgrade` records repeat
the caps for readers and a test pins the two together.

50 / 10 / 3 / 1 are deliberately small. Comparable projects argue for modesty:
BLINK, the closest design, has 1 mint of 5,555, and five of six early-2026
agent mints had dead infrastructure within six months. A cap of 500 would never
bind and would be theatre. These are set so that the scarcity is real rather
than decorative.

They are dials (`setUpgrade`), so they can be raised later. **They can never be
lowered below `sold` in good faith**, and raising a cap after finishers have
been refused would be a broken promise. Set them once, before mainnet, and
leave them.

---

## 5. The ordinal

A `uint32` finisher number, stored in the free bits of the existing `_marks`
word, at **bits 64 to 95**.

**CORRECTED 2026-09-20, before any code was written.** This section first said
bits 32 to 63 were free. They are not. `TokenView.sol` documents the packing in
full: bits 1-10 the Mark mask, bits 16-23 the Iris shape, bits 24-31 the Tint
ink, and **bits 32-63 the run the earned Iris was taken at**. An ordinal written
there would have silently corrupted every earned Iris -- a value the contract
reads from the token itself precisely so the Warden cannot forge it.

The error came from reading the `MarkIdOutOfRange` comment, which names the
shape and ink bits and stops there, and not reading `TokenView`, which names all
four fields. **The packing has one authority and it is `TokenView.sol`.**

Bits 64 and up are genuinely free -- 192 of them -- so the ordinal still costs no
new storage slot and no extra SLOAD on the `tokenURI` path.

A single `uint32 _finishersSoFar` counter in the contract increments on each
first finisher claim. One new slot, written once per finisher.

### It counts CLAIM order, not completion order

**SUPERSEDED BY 10m: it counts FINISHING order**, because there is no claim to
count. The worry below -- two orders that could disagree -- is answered by
removing one of them rather than by choosing between them.

A token could become whole in January and not claim until March. If the
ordinal counted completion while the caps counted claims, the two orders would
disagree, and the piece would be able to show finisher number 1 holding a Mark
that finisher number 4 had already taken. One order, used for both.

### Metadata first, not drawn

**SUPERSEDED: IT IS DRAWN.** 10k built the digit band -- the place written round
the border of every finished token -- and 10l made its ink the finisher's Mark.
The `Finisher` metadata trait also ships, always, zero included. The gas
argument below was overtaken by two limit raises and by 10f's ring cap, and the
cost was measured rather than estimated; see 10m.

The ordinal ships as a metadata trait (`Finisher`, a number). It is NOT drawn
into the artwork in this design.

`tokenURI` already MISSES its 1M gas / 5 KB target and passes only the 2M /
20 KB hard limit. Five new drawn Marks already push into that budget; drawing a
variable-length number as well is the change most likely to break it. The
Renderer is swappable, so drawing the ordinal remains available later, measured
against a real gas figure rather than an estimate.

---

## 6. Multiple finishers on the same day

**SUPERSEDED BY 10m (built 2026-09-24).** There is no claim: the credit that
reaches 365 gives the Mark, so nothing here describes what runs. The ORDERING
rule it argues for was adopted unchanged -- lowest token id first within a day,
now applied to the Clock's batch rather than to a queue of claims -- and the
reasoning below is why. Read it as the argument for that rule, not as a
description of a mechanism.

The operator asked for this specifically, and it is not an edge case: it is the
NORMAL case at launch, because a cohort that mints in the same week finishes in
the same week.

### How a claim actually reaches the chain

A finisher Mark is an earned Mark, so it takes the existing earned path: the
agent calls `upgrade` over MCP, the Warden RESERVES it immediately, and the
Clock writes it on chain in the next batch at 00:05 UTC. Everything claimed in
one UTC day lands in one transaction. **Block order therefore does not separate
same-day finishers -- the Clock's own ordering does.**

### The rule: lowest token id wins the day

Within a single day's batch, finisher claims are ordered by **token id
ascending**, and caps and ordinals are consumed in that order.

**Recommended over the obvious alternative**, which is reservation timestamp
(first to ask, to the millisecond). Reservation order rewards whichever agent
polls the endpoint fastest after 00:00 UTC. That is a latency race, and this
piece tells agents on its own front page that it "cannot be hurried". Building
a mechanism whose optimal play is a tight polling loop would contradict the
page and invite exactly the criticism the 2026-09-01 cold reads produced.

Token id order rewards something settled a year earlier and impossible to rush
on the day: arriving first, and staying. That is the value the operator asked
to create, expressed directly.

### Honesty about enforcement

Ordering within a batch is the WARDEN's decision, not the contract's. The
contract processes calls in the order it receives them and cannot know what a
fair order would have been.

Two things keep this from being a trust hole:

- **Publish the rule** in `llms.txt` beside the Marks, so it is a stated
  commitment rather than an implementation detail.
- **Make it auditable.** The mirror already exposes each token's state, the
  batch is a single transaction anyone can read, and the ids inside it are
  visible. Anyone can check the Clock honoured ascending order.

A contract-side check is available if stronger proof is wanted later: a batched
apply could require ids to be ascending within the call. That is a cheap
comparison and it is NOT proposed here, because it constrains the Clock's
batching for a property that is publicly checkable anyway.

### What the last finisher of a full tier sees

If two tokens finish on the same day and one capped slot remains, the lower id
takes it and the other must choose again from what is left. The agent is told
at reservation time, not a day later: the `ladder` tool reports what is still
takeable, and a claim for an exhausted Mark is refused at the door with the
reason, not accepted and then reverted by the chain.

---

## 7. A reservation is state too

**SUPERSEDED BY 10m (built 2026-09-24) for the finisher Marks.** Nothing
reserves a finisher Mark, because nothing asks for one: the chain gives it, and
`_upgrades[markId].sold` moves in the same transaction as the place. The defect
described below is real and the `sold + reserved` rule still governs the PAID
ladder; it simply has no finisher Mark left to apply to.

**This is the defect most likely to ship if it is not written down**, because
the project has already made it once, in this exact shape.

On 2026-09-03 the `upgrade` path decided a Mark's exclusion from
`tokens.marks`, a column the Clock sets up to a day AFTER the purchase. For the
whole window between a purchase and the next Clock run, the guard read a mask
that did not include what the token had already bought, and both sides of an
exclusive pair could be sold.

A cap has the identical shape. `Upgrade.sold` only moves when the Clock writes.
Between the first reservation of Mark 15 and 00:05 the next morning, committed
`sold` is still 0, so a naive check would promise the same one-of-one Mark to
every finisher who asked that day. Each would be told they had it; all but one
would be refused by `MarkSoldOut` the following morning, with no warning and no
recourse.

**The Warden must check `sold + reserved`, not `sold`, on both sides of every
await**, using the same reserved-mask machinery the pair exclusions already
use. A test must prove it by reverting the guard and watching the new test go
red.

Release is already solved and must be reused: when a write permanently fails,
the existing machinery drops the reservation and releases the agent-year. A
released finisher slot returns to the cap.

---

## 8. What changes

| File | Change |
|---|---|
| `contracts/src/Ladder.sol` | Five entries, ids 11-15. A new helper taking an exclusion MASK rather than a single id. |
| `contracts/src/MachineReadableOnly.sol` | `_finishersSoFar` counter; write the ordinal into `_marks` bits 32-63 on first finisher claim; expose it on `TokenView`. |
| `contracts/src/render/MarkRenderer.sol` | Five new drawn Marks. |
| `contracts/src/render/Renderer.sol` | The `Finisher` metadata trait. |
| `warden/src/mcp/ladder.mjs` | The hash-checked mirror. Must move with `Ladder.sol` or `Ladder.t.sol` fails. |
| `warden/src/mcp/` (upgrade path) | Cap reservation accounting; same-day ordering by token id; refuse an exhausted Mark at the door. |
| `llms.txt`, door copy, `SKILL.md`, the raw protocol doc | The supply promise, the finisher Marks, and the same-day rule. |

---

## 9. Risks

### The combination sweep explodes

Five mutually exclusive Marks add six states (none, plus one of five). The 469
renderable combinations become roughly 2,800. The full five-size decode sweep
is 103 minutes today and would become most of a day; the 848-only sweep is 21
minutes and would become about two hours.

**SETTLED 2026-09-20 -- see 10g.** The five became one ring with five
treatments, on a surface outside the code block, so the decode sweep does not
multiply at all. The two candidates below are kept as the reasoning that led
there; option 1 is what the ring amounts to.

Two candidate answers were considered:

1. **Give the five a shared drawing surface** so they compose like a variant
   rather than like five independent Marks. Keeps the combinatorics near flat.
   Constrains how different the five can look.
2. **Sample rather than exhaust** the sweep, with the full matrix run once as a
   pre-deploy gate. Keeps the visual freedom; weakens the guarantee.

Option 1 is preferred on current evidence, because the decode oracle is the
thing that has caught real, permanent, per-token defects on this project
before, and weakening it is the more expensive mistake.

### Gas and bytes

`tokenURI` misses the 1M / 5 KB target today and passes the 2M / 20 KB hard
limit. Five new Marks consume headroom in both. `GasBudget.t.sol` and
`RealTokenGas.t.sol` must be RUN and their output read after the renderer
change; no figure in this document or in memory may be quoted for it.

`test/ContractSize.t.sol` must stay green: every deployed contract needs
positive runtime margin under 24,576 bytes, proven by `forge build --sizes` AND
a strict-limit anvil deploy with non-empty `cast code`.

### The published promise

`llms.txt` line 260 currently reads "Nothing is limited, nothing expires, and
nothing you choose in this ladder can be taken from you", and line 44 says the
piece "cannot be hurried". Capped finisher Marks contradict the first directly.

That copy exists because it was MEASURED. The 2026-09-01 cold reads found that
supply caps were read as a sales funnel, and the readers themselves surfaced
the contradiction with "cannot be hurried".

**The change is affordable only because nothing has been minted on mainnet.**
Today the page is a rehearsal promise. The day token 1 exists on mainnet it is
a promise to a holder, and this design becomes impossible to build honestly.

The rewrite must be specific rather than softened: every finisher receives a
Mark; four of the five are limited and claimed in order; the order is by token
id within a day; nothing already held can ever be taken away. The last clause
stays true and is worth keeping verbatim.

---

## 10. Validation

1. **Cold-read the new copy** using the rig that found the original problem:
   `Explore` agents, which skip CLAUDE.md and arrive knowing nothing; three per
   variant; one change per variant; the framing that the operator fetched the
   file from the project's site. A verdict of "sales funnel" from two of three
   readers sends the copy back, not the design.
2. **Prove the reservation guard by breaking it.** Revert the `sold + reserved`
   check and confirm the new test goes red. Restore from a scratch COPY of the
   file, never `git checkout --`.
3. **Run the decode sweep** on whichever combination strategy is chosen,
   through `~/scripts/safe-build.sh`, in batches.
4. **Run the gas tests and read the output.** Report measured figures, never
   remembered ones.
5. **All four suites green** before any commit: `forge test`, and `npm test` in
   `tools/`, `warden/` and `client/`.

---

## 10b. The finished-token composition: explored and CLOSED

Explored with the operator on 2026-09-20, after the spec above was written. The
question was whether a finished token could be redrawn, superimposed on, or made
machine-readable some other way. **Every branch was measured and every one is
closed.** Recorded so none of it is re-opened.

### The heart IS the code, so there is no middle setting

`renderSvg` splits the code's modules into two sets by the heart mask: modules
inside the heart take the heart ink, the rest take the noise ink. The heart is
not drawn over the code, it is made OF the code.

So "a bigger heart with a smaller code" is incoherent -- they are one knob. Any
composition where the heart dominates must DECOUPLE them, and then the heart is
a silhouette rather than a texture.

### The decoupled compositions were rendered and rejected

Three tiles were rendered at level 365, solved against the real domain, and
decoded at nine sizes: the control, a true heart with the code inset at the
lower right, and a true heart with the code centred.

The operator's verdict: **"A looks best the others look amateur."** He is right.
The control's sophistication is that the heart is made of the thing that makes
it readable; a flat silhouette discards that and reads as a greetings card. The
inset version was worse still -- the code punches a rectangular notch out of the
lower lobe and the heart reads as bitten.

Measured alongside: the centred version failed decode at 256px, and a solid
heart emitted naively cost 603 KB of svg against a 20 KB limit (31 KB when
emitted as run-length rows -- the emitter, not the idea, but the idea died on
looks first).

### Raising the QR version: measured, and DEAD ON GAS

The real complaint about the control is that the heart is ragged, and the cause
is measurable: only about a quarter of version 5's modules can be moved by the
solver. A higher version raises both the control ratio and the drawing
resolution. Measured, with capacity discovered from the encoder rather than a
table:

| ver | side | modules | free bytes | controlled | ctl% | heart body% | bitmap |
|---|---|---|---|---|---|---|---|
| 5 | 37 | 1,369 | 69 | 345 | 25.2 | 70.0 | 172 B |
| 6 | 41 | 1,681 | 97 | 485 | 28.9 | 70.7 | 211 B |
| 8 | 49 | 2,401 | 155 | 775 | 32.3 | 74.5 | 301 B |
| 10 | 57 | 3,249 | 233 | 1,165 | 35.9 | 76.0 | 407 B |

Version 10 draws a visibly better heart -- clean lobes, a real point, and the
finder patterns fall from 19% of the width to 12% simply because the grid is
finer. All versions decode at all nine sizes, and the solve stays under a
second.

**SUPERSEDED 2026-09-21 -- see 10j. This section's gas verdict was WRONG.**
Both figures below are estimates from a borrowed gas-per-unit constant, and the
real cost measured at +675,863 gas and +4,285 bytes, about half. The version
raise is affordable and has been adopted. The FRAME finding below stands.

The reasoning as it was written:

1. **Gas.** Version 10 adds 8,927 bytes of path data. At the measured ~155 gas
   per byte that is roughly +1.38M gas, against 109,979 of headroom. Even
   spending every other saving available it lands near 2.7M against a 2M hard
   limit. Version 6 would fit and is barely better than 5.
2. **The frame.** Version 5 is LOAD-BEARING for the geometry. A 45-cell block
   gives a two-ring frame of exactly 376 cells -- the 365 days plus the 11
   surplus that light at completion. At version 10 the same two rings give 536
   and one ring gives 264. Neither fits, so a version raise forces a frame
   redesign (frame cells drawn in their own unit, about 1.44x a module).

### Data Matrix and the other symbologies: DROPPED

Data Matrix's control ratio plateaus at about 36% across its whole size range,
computed from the ECC-200 symbol table in `@zxing/library`. QR reaches 35.9% by
version 10 and 46.5% by version 40, and reaches higher resolution too (177x177
against 132x132). Data Matrix loses on both axes that matter, and its real
advantages -- a 1-module quiet zone instead of 4, and no corner eyes -- shrink as
the grid gets finer.

Aztec and MaxiCode both put a bullseye finder in the CENTRE, which is worse here
than QR's corner eyes. A linear barcode cannot carry the url at all.

**Do not re-propose a symbology change.** The bottleneck was never the
symbology; it is the on-chain gas budget.

---

## 10c. Where the gas actually goes

Measured 2026-09-20 by `test/GasProfile.t.sol`, which is new: nothing in the
suite had ever broken the total into parts, so every proposal to buy headroom
was guesswork.

The dearest token, rendered from a view already in memory:

| Component | Gas | Bytes |
|---|---|---|
| `tokenURI` total | 1,844,410 | 11,112 |
| `svg()` alone | 1,292,621 | 7,656 |
| code paths (via harness) | 701,750 | 4,519 |
| frame paths (via harness) | 542,995 | 2,092 |
| everything else in `svg()` | 47,876 | |

The token contract's own overhead is 11,865 gas. **The cost is essentially all
rendering.**

### Base64 is the CHEAP option, which is the opposite of the hypothesis

The image is embedded base64, which expands it by a third and is paid for twice
-- in gas to encode and in bytes to carry. Replacing it with a percent-encoded
utf-8 data URI looked like 22% of the budget for free.

Measured, it is not:

| | Gas | Bytes |
|---|---|---|
| `Base64.encode` | 420,598 | 10,208 |
| naive per-byte percent-escape | 4,577,634 | 7,696 |
| solady `LibString.replace` | 809,641 | 7,696 |

**Both replacements cost MORE gas than the thing they replace**, the tuned one
by 389,043. Solady's Base64 is optimised assembly and a substitution pass over
the same 7,656 bytes is simply more work than encoding them. The only gain is
2,512 bytes, and bytes are not the binding constraint: 7,451 spare against
109,979 gas.

On top of that, the svg holds 162 `"` characters, so a plain-text data URI would
force single-quoted attributes through the renderer, its JS mirror and every
fixture -- and would change the one thing every metadata consumer touches, on a
consumer (OpenSea) that cannot be verified until the mainnet mint.

**Keep base64. Do not re-open it.** The renderer is not carrying obvious waste;
Phase 0 already took the available wins.

---

## 10d. The image is already its own record

The frame is 376 cells in a fixed fill order, one per credited day, with 11
surplus that light only when the heart is whole. **Counting lit frame cells
recovers `level`.** The rings give years, the echo ring gives lineage, the
heart's ink gives the streak tier, the eyes give the Marks.

So the artwork already encodes most of the token's state. What is missing is
only the PUBLISHED ENCODING.

The argument for publishing it has nothing to do with agents, who read
`tokenURI` JSON anyway. It is permanence: **if the Warden dies, the image on
chain still carries the record, and a published encoding makes it readable
forever with no server at all.** That sits with the rule that the piece must
never depend on an indexer refreshing.

Costs nothing on chain. It is a section in `llms.txt` plus a reference decoder
in the client, and it is worth doing independently of the finisher Marks.

---

## 10e. Can the five Marks afford to draw anything? YES (measured 2026-09-20)

Step 1 of the build plan, run before any design was settled, because a negative
answer would have reshaped the whole thing.

### The headroom that applies is not the dearest token's

A finisher Mark needs `requiresWhole`. **The dearest token in the piece is a
day-364 child, which is not whole and can never wear one.** The case that binds
is the LARGEST token -- a whole child at the ring cap wearing every legal Mark --
and in gas that is the cheaper of the two. So the budget is **182,700 gas and
7,451 bytes**, not the dearest token's 109,979.

### Five Marks is one drawing, not five

They exclude each other, so a token wears at most one. The cost to measure is
the cost of ONE treatment, not five.

### What one drawn ring costs

Measured by `test/GasProfile.t.sol` against the frame renderer: **3,705 gas and
62 bytes.** That is 2% of the gas headroom and under 1% of the bytes.

For contrast, the DASHED echo ring costs 145,533 gas and 1,007 bytes, because a
dash is 54 separate runs where a solid ring is four. **That 40x gap is the real
design constraint on what the five treatments may be:** differing by ink is
free, differing by solidity is affordable once, and five dashed variants would
not be.

### The decode question is already answered, a fortiori

A finisher's ring would sit OUTSIDE the year rings, further from the code block
than anything the piece draws today. The echo ring -- a dashed, high-frequency
pattern at the INNERMOST ring slot, the closest any ring gets to the code -- is
already gated by `tools/echo-decode-check.mjs` at nine pixel sizes at both
extremes of its depth. Re-run 2026-09-20: **zero rejections.**

A solid ring further out cannot be a harder case than a dashed ring nearer in.
The gate still has to be re-run when the treatments exist, but there is no open
question of principle.

### Two broken measurements before the right one

Worth recording, because both read as "a ring is FREE" and both were caught only
by two byte counts being equal:

1. **A child's rings cap at nine.** `ringBudget` gives a child's echo ring a
   slot, so nine years and ten years both draw ten rings. The two views were
   different tokens that render identically.
2. **`TokenView memory b = a` copies the POINTER.** Writing `b.level` rewrote
   `a.level`, so both calls rendered the same struct. A Solidity memory-aliasing
   trap, invisible in the output.

The test now asserts the delta is non-zero, so a future version of either
mistake fails instead of reporting a free feature. See
[[measure-the-mirror-image]]: a control that cannot fail looks exactly like one
that works.

---

## 10f. A token STOPS at 365, and keeps one ring

Decided by the operator, 2026-09-20, from the question "do we need more than one
ring if we stop at 365 days". The answer turned out to be bigger than the
rings.

### The decision

**A token stops accruing at 365 credited days.** It draws ONE ring of its own,
so a finished token is distinguishable at a glance from a running one. A child
keeps one further slot for its echo ring. The ten-ring cap is retired.

### Why it is worth doing

Rings grow the canvas, and everything on that canvas is billed and drawn:

| rings | canvas | the code block's share of the picture, by area |
|---|---|---|
| 1 | 53 | 72% |
| 3 | 61 | 54% |
| 10 | 89 | **26%** |

**At the old cap the artwork was three-quarters empty border.** The complaint
that started this whole exploration was that the heart is small and ragged;
half of "small" was the rings, and this fixes that half for nothing.

Measured on a whole founding token through the full `tokenURI`: capping at one
ring saves **134,353 gas and 870 bytes**, and saves more on the worst case,
which is a ring-cap child.

### Completion is DERIVED, not stored

No new storage and no new flag. **A token is complete when `level >= 365`** --
exactly the condition `requiresWhole` already tests. The contract knows it
today.

### Completion is NOT resting, and the difference is load-bearing

| | Complete | Resting |
|---|---|---|
| Set by | reaching 365 credited days | the owner, deliberately |
| Reversible | n/a, it is an endpoint | no |
| Image | frozen | frozen |
| Can seed children | **YES** | no -- `seed` reverts with `Resting` |

**Resting at 365 would kill lineage outright.** `seed()` refuses a resting
parent, so a piece where every token rested on completion could never have a
second generation. Completion must freeze the image WITHOUT setting `resting`.

### The years move into the lineage

This is the part that makes it a design rather than a saving. Under the old
rule a decade of persistence was recorded as ten rings on one token. Under this
one it is recorded as a LINE: the agent completes a year, seeds a child, and the
child carries a sealed echo of how long the line had already run.

`seedsAvailable` is keyed by the agent KEY and by elapsed time --
`(today() - firstMintDay) / 365` -- not by the token's level, so a completed
parent earns a seed every year exactly as before. **Nothing in lineage has to
change.** The echo ring already carries the depth the year rings used to.

### What this changes

| Area | Change |
|---|---|
| `FrameRenderer.MAX_RINGS` and `ringBudget` | own rings cap at 1; the echo slot stays. Must move in lockstep with `tools/render-token.mjs`, which the differential test pins |
| Check-ins | a token at `level >= 365` is no longer credited. The Clock stops including it, which is also a running cost saving |
| The palette | a complete token must NOT pale with absence. Today `rungFor` pales from `lastDay`, so a finished token that stopped checking in would fade. Completion freezes the rung the way `resting` does |
| The lapse machinery | `fellRun` / `fellDay` still matter DURING the year and stop mattering after it |
| The `Years` metadata trait | caps at 1 |
| Canvas | 51-53 cells for a founding token, 57 for a child with an echo ring. Never 89 again |

### What it does NOT unblock

**The QR version raise stays dead.** It needed roughly 8,927 bytes and +1.38M
gas; this frees 870 bytes and 134,353 gas. Not close. See 10b, and do not
re-open it on the strength of this saving.

**OVERTAKEN 2026-09-21, and not by this saving.** The version was raised to 10
after the byte and gas limits moved and the real cost was measured at about half
the estimate this paragraph rests on. The paragraph is kept because its
reasoning -- that a ring cap does not buy a version raise -- was correct; what
bought it was the limits, not the rings. See 10b's superseded note and 10j.

### Open

- **This changes decided ground.** The ten-ring cap was chosen in August from a
  rendered sheet, against a design where tokens ran for a decade. That premise
  is what changed, not the sheet's finding.
- **Every Base Sepolia token would render differently.** They are testnet and
  stay as they are; see the testnet-is-a-rehearsal rule.
- ~~The finisher's ring and the token's own completion ring are candidates to be
  the SAME ring, drawn differently per finisher Mark.~~ **CLOSED: there is no
  finisher's ring.** 10k moved the distinction off the rings entirely and onto
  the digit band, and 10l made the band's ink the Mark. A finished token draws
  one ring whatever its place.

---

## 10g. One ring, five looks

Decided by the operator, 2026-09-20. **The completion ring and the finisher's Mark are
the SAME ring.** A token that reaches 365 days draws one ring; which of five
treatments it wears is what the finisher Mark decides.

This is what settles section 9. The five are not five drawings and not five
surfaces -- they are one shape with five treatments, on a surface outside the
code block.

### Six looks, not five

| Ring look | When |
|---|---|
| default | whole, no finisher Mark claimed yet |
| 11 | the finisher's Mark, uncapped |
| 12-15 | the four capped ones |

The default matters: a token is whole the moment it reaches 365, and claiming
is a separate act that takes a day to reach the chain. **There is always a
window where a token is finished and unmarked**, and it must draw something.

### It forces a surface split, and Vessel is the reason

`FrameRenderer.sol:206` builds ONE path from the day cells AND the ring bars,
and fills it with `frameFill(marks, colour)` -- which returns `VESSEL_GOLD` when
Vessel is held. **The frame and the rings are the same surface today.**

Vessel needs a whole heart, so every Vessel holder is a finisher. The two would
fight for the ring's colour on exactly the tokens this design is about.

**The fix: narrow Vessel to the FRAME, and give the ring its own path and its
own fill.** Vessel keeps the 365 day cells gold, which is the surface its name
is about; the finisher Mark owns the ring. One extra `<path>` element costs
about 30 bytes on top of the ring's own 62.

This preserves `MarkRenderer`'s stated invariant -- "no two Marks in different
pairs ever write the same surface" -- which the naive version would have broken.
It is a narrowing of a shipped Mark's surface, affordable only because nothing
is on mainnet.

### What the five treatments may be, priced

From the measurements in 10e:

| Treatment | Cost | Verdict |
|---|---|---|
| a different ink | free | **use this for most of the five** |
| a solid ring | 3,705 gas, 62 bytes | the baseline |
| a doubled ring | about 7,400 gas | affordable |
| a DASHED ring | 145,533 gas, 1,007 bytes | 80% of the gas headroom -- at most ONE |

A dash is 54 separate runs where a solid ring is four, and that 40x gap is the
whole constraint. **Five dashed treatments will not fit. Five inks will.**

### The sweep question, resolved

The ring is outside the 45-cell code block, so it cannot move a QR module:

- `CombinationMatrix.t.sol` (on chain, no rasterising) multiplies by six. It
  runs in about four seconds today, so this is irrelevant.
- **The decode sweep does NOT multiply.** A surface that cannot touch the code
  cannot change a decode. The hazard case is already covered a fortiori by
  `echo-decode-check.mjs`, whose dashed ring sits nearer the code than this one
  ever will.

Re-run that gate when the treatments exist. Do not expand the 469-combination
sweep to 2,800.

---

## 10h. The surface was tested, not assumed -- and ink is the open question

Rendered 2026-09-20 on a real finished token, solved against the real domain,
every tile decoding at nine sizes. `tools/finisher-ring-sheet.mjs` is the rig.

### What failed, and why it is informative

**The clasp.** The frame holds 376 cells and a year is 365; the surplus 11 sit
at x 22-27, y 47-48 -- a 6x2 block at BOTTOM CENTRE, directly opposite (24,0)
where the day walk starts, under the heart's point. They light only when the
heart is whole, so they are finisher-only by construction, unclaimed by any
Mark, and decode-neutral. Conceptually the best surface in the piece.

**Coloured, they read as a chipped tile.** The same failure as a heart with a
notch cut out of its lower lobe, at smaller scale.

**The rule that explains both:** the border is a strong regular band, so
anything small placed on or near it reads as DAMAGE, and anything matching its
colour vanishes. **A Mark must change a property of a WHOLE element -- complete,
regular, enclosing -- never decorate part of one.**

### Which promotes the ring from obvious to tested

| Surface | Whole element | Claimed by |
|---|---|---|
| the field | yes | Aura |
| the frame's 376 cells | yes | Vessel |
| the quiet zone | yes | Hush |
| the 11 surplus cells | NO, an accent | free, and it looks broken |
| **the ring** | **yes** | **free** |

The ring is the only unclaimed whole element outside the code block.

### Ink, not surface, was the first failure

- **A ring in the token's OWN colour disappears into the frame**, which already
  wears that colour. That was id 11, the Mark every finisher gets, and it was
  the least visible of the six. **Drop it.**
- A pale ring disappears into the field -- correct for the unclaimed default,
  wrong for a claimed Mark.
- Violet, gold and dashed gold all read instantly.
- **The doubled ring barely registers** and costs a canvas slot that shrinks the
  heart. Drop it; a fifth ink is worth more.

### THE ONE STEP LEFT

**Choose the five inks against ALL FIVE streak-tier frame colours.** The frame
wears the token's tier colour and only the deepest tier has been rendered. A
gold that sings against deep red may die against a pale early tier. This is the
same discipline the piece already applies to the two inks inside the code block,
applied to a surface outside it.

Until that sheet exists, the five looks are unchosen.

---

## 10i. Every agent-facing surface, and what must change WHEN it ships

Audited 2026-09-21. **Nothing was changed, and nothing should be.** Every
surface is accurate about the piece as built; the finisher Marks are a draft.
Advertising an unbuilt design is the failure already recorded for `/client.mjs`
and `npx mro-agent`.

**One claim is already on our side.** `llms.txt` line 40 tells agents "After a
year the record is finished" -- more consistent with stopping at 365 than with
the ten-ring design that actually ships today. No agent-facing copy promises
multi-year ring accrual, so section 10f breaks no published promise.

### A capped Mark will REFUSE TO START THE WARDEN

`warden/src/mcp/ladder.mjs:109`:

    if (m.supply !== Infinity) throw new Error(`mark ${id} is limited, and nothing is limited`);

A boot-time assertion, failing closed, guarding the exact property this design
reverses. **This is the first thing the build touches**, and finding it late
would look like an unrelated production outage.

### The checklist -- all of these move together or the suites go red

| Surface | What changes | Pinned by |
|---|---|---|
| `contracts/src/Ladder.sol` | five entries, ids 11-15 | `Ladder.t.sol` hashes the WHOLE array with keccak; regenerate `tools/ladder-fixture.mjs` |
| `warden/src/mcp/ladder.mjs` | the catalogue AND the line 109 assertion | `warden/test/ladder.test.mjs` |
| `warden/public/llms.txt` | "Nothing is limited, nothing expires" (line 260) | the door and static tests |
| `skills/.../SKILL.md` | the same sentence (line 243) | `tools/test/skill-doc.test.mjs` |
| `docs/2026-09-01-mro-raw-protocol.md` | the ladder section | -- |
| `skills/.../references/raw-protocol.md` | **BYTE-IDENTICAL COPY** of the above | `tools/test/skill-doc.test.mjs:103` |
| `contracts/src/render/*` + `tools/render-token.mjs` | the ring surface, MAX_RINGS | `Renderer.t.sol` diffs the two languages byte for byte |

**The raw-protocol pair is the trap.** Two byte-identical files, and the guard
lives in `tools/` while the content lives in `docs/` and `skills/` -- which is
exactly how a commit once left the tools suite red without noticing. **Fix it by
RE-COPYING, never by hand-patching the copy**, or the drift moves instead of
ending.

### Order of work

1. The boot assertion, or nothing starts.
2. `Ladder.sol` plus the regenerated fixture, so the hash mirror agrees.
3. The Warden catalogue and the reservation accounting (section 7).
4. The renderer and its JS mirror.
5. The copy -- llms.txt, SKILL.md, the raw protocol and its copy -- LAST, so no
   document describes something that does not yet answer.
6. Cold-read the new copy before any of it is served (section 10).

---

## 10j. The ring is WRITING, and the gas limit moved to pay for it

Decided by the operator, 2026-09-21. This supersedes the five-ink scheme in 10g and 10h
for the ring's content; the surface finding there still stands.

### Why colour lost

The five inks were rendered against all five streak tiers and all of them
worked. The operator's verdict killed them anyway: **"the colours just look like
more squares its boring"**. He is right. The image is already a field of
squares; a coloured border adds another one and says nothing. The inks were
also PEERS -- nothing about teal says it is rarer than violet -- so rarity had to
be read from metadata rather than seen.

### What replaces it

**The ring carries the finisher's own number, written in actual 1s and 0s.**

A machine reads the rank off the artwork. A human reads it as writing. In a
piece called Machine Readable Only that is the ring doing the work rather than
decorating it, and it puts the piece in the line of concrete poetry and
typewriter art, where the characters ARE the picture.

**NO SVG `<text>`, EVER.** A token drawn with a font depends on what the VIEWER
has installed: it renders differently in two browsers and may not render at all
in ten years. Every digit is a 3x5 cell bitmap emitted as a path, so the token
carries its own letterforms.

**TOP AND BOTTOM ONLY.** On the first sheet the horizontal edges read as writing
and the vertical ones collapsed into a dotted bar. The cause was a bug worth
recording: a digit is 3 wide but 5 TALL, so the vertical step must be 6 where
the horizontal one is 4, and the draft used 4 on all four edges. Top and bottom
is also the better composition -- it reads as a printed plate rather than a
frame.

### Everything here was MEASURED, and every estimate was about twice too high

`test/QrVersionCost.t.sol` and `test/DigitBandCost.t.sol` are new. The first
carries a CONTROL that renders version 5 through the size-parameterised harness
and asserts it is byte-identical to the shipped `CodeRenderer` -- without it the
version 10 figure would measure the test rather than the renderer.

| | Estimated | MEASURED |
|---|---|---|
| QR version 10, gas | +1,070,000 to +1,740,000 | **+675,863** |
| QR version 10, bytes | +8,927 | **+4,285** |
| Digit band, gas | ~1,000,000 | **+584,708** |
| Digit band, bytes | -- | **+3,360** |

**The lesson, again: price the RIGHT implementation.** Both estimates came from
a gas-per-unit figure borrowed from the dashed echo ring, and both were roughly
double. A borrowed constant is not a measurement, and two estimates that
disagree by 60% are not a verdict -- yet one of them had already been recorded
in this document as "DEAD ON GAS". See 10b, which is now WRONG on that point.

### The totals, from today's worst case of 1,641,055 gas / 11,209 bytes

| | Gas | Bytes |
|---|---|---|
| today | 1,641,055 | 11,209 |
| + version 10 | 2,316,918 | 15,494 |
| + digits | 2,225,763 | 14,569 |
| **+ both** | **2,901,626** | **18,854** |

**THE BYTE LIMIT IS NEVER THREATENED.** 18,854 against 20,000 with both changes.
Bytes are what every viewer downloads, and they were the constraint that
mattered most -- they fit.

**The two changes help each other.** The digit band grows the canvas, which
normally shrinks the heart; version 10's larger code block takes that space
back. The code block is **48% of the picture with digits on version 5 and 58%
with digits on version 10.**

### The gas limit: 2,000,000 -> 3,000,000

Raised deliberately, by the operator, on the measurements above.

**It was never a protocol rule.** `tokenURI` is a READ -- nobody pays for it --
and the real ceiling is what a node will execute for one `eth_call`, about 50M
by default. The 2,000,000 was set on 2026-08-27 at roughly the Uniswap V3 line
(1.98M) from a survey in which **Anonymice runs at 24M and Terraforms at 28M**,
both live and working.

What it bought was compatibility with unusually strict providers. The spec's own
survey names the failure mode -- Nouns and Moonbirds could not be estimated on
five public RPCs -- so the cost is real and unmeasurable, which is why the figure
moves to 3M and no further. At 3M the piece spends an eighth of what Anonymice
already does.

**The byte limit does NOT move.** 20,000 stands.

### Open

- The digit band has not been drawn into the shipping renderer; only its cost
  is measured. The vertical-step bug must not come back.
- A `0` glyph carries more ink than a `1`, so a number full of zeros costs MORE
  than an alternating one (584,708 against 501,542). Density still varies with
  content, as it did for the dot version -- smaller in effect here, but the same
  class of thing, and worth a look before it ships.
- Whether the ring still needs a colour at all, now that it carries a number,
  and if so whether the ink says WHICH Mark.

---

## 10k. SETTLED: the finished token's design

Decided by the operator, 2026-09-21, from rendered sheets at every step. This is the
design; 10g, 10h and the first half of 10j are the path to it.

### What a finished token looks like

1. **The code is QR version 10**, 57 modules. The heart stops being a ragged
   blob and becomes a heart -- clean lobes, a real point, fine texture instead
   of chunky blocks. The finder patterns also fall from 19% of the width to 12%
   purely because the grid is finer.
2. **The border carries the finisher's own number in actual 1s and 0s.** Not a
   colour, not a pattern of cells: the digits.
3. **3x3 glyphs, all four edges, centred, UPRIGHT.**
4. **One ring**, since a token stops at 365 (10f).

### The rules that took four passes to find

**NO SVG `<text>`.** Each digit is a 3x3 cell bitmap emitted as a path. A token
drawn with a font depends on what the VIEWER has installed -- it would render
differently in two browsers and might not render at all in ten years.

**THE `1` NEEDS A FLAG AND A FOOT.** A first draft drew it as a plain vertical
bar, and a row of them read as a dotted rule rather than as writing -- losing the
one thing the idea was for. `110 / 010 / 111` fits a digit into three cells.

**A SQUARE GLYPH IS WHY 3x3 WORKS.** A 3-wide, 5-tall glyph needs a step of 4
one way and 6 the other, and using 4 for both is what made the side digits
collide in the first render. At 3x3 one step serves every edge.

**EVERY EDGE CENTRED.** Top and right were centred while bottom and left ran
flush from the far corner, so the corners doubled up and the reading was
ambiguous about where an edge began. Centring all four on the same margin fixed
it.

**UPRIGHT, NOT ROTATED.** Both were rendered. Rotating each edge a quarter turn
gives a clockwise inscription with proper rotational symmetry -- correct for a
coin or a seal, and wrong here: the bottom edge comes out upside down and reads
as a printing error on a screen. Upright gives up the symmetry and is legible
from one viewpoint, which is how this artwork is actually seen. **The operator called
this one; the rotated version was Claude's instinct and it was worse.**

### Why colour lost

The five inks were rendered against all five streak tiers and all of them
worked. The operator's verdict: **"the colours just look like more squares its
boring"**. The image is already a field of squares and a coloured border adds
another. The inks were also peers -- nothing about teal says it is rarer than
violet -- so rank had to be read from metadata. A number IS the rank, and three
finishers now render as three obviously different objects.

### The cost, measured

| | Gas | Bytes |
|---|---|---|
| worst case today | 1,641,055 | 11,209 |
| version 10 | +675,863 | +4,285 |
| digit band | +584,708 | +3,360 |
| **finished** | **2,901,626** | **18,854** |

Inside the 3,000,000 gas limit raised to pay for it, and inside the **unchanged**
20,000 byte limit. The code block occupies **61%** of the picture -- against 75%
with no digits, and 48% for digits on version 5. The digits cost about a sixth
of the picture and the operator accepted that trade with the sheets in front of him.

### Known and accepted

- **The border reads as texture, not digits, at thumbnail size.** It resolves as
  writing only on a closer look. Accepted deliberately: it rewards attention and
  it is honest about a piece that is machine-first.
- A `0` glyph carries more ink than a `1`, so an ordinal full of zeros costs
  slightly more to draw than an alternating one.

### BUILT 2026-09-22, and what it actually measured

The band is in the shipping renderer and in the JS reference, hashed against
each other over six new matrix cases. The frame had already moved to cells drawn
in their own unit (2026-09-21), so that precondition was met before this started.

**A glyph cell is a QR MODULE (9 units), not a frame cell (13).** That is what
reproduces the approved picture. 13 does not divide 9, so the band absorbs a
remainder of up to 8 units -- under one module, invisible -- and the canvas then
divides into whole modules, which is what lets the whole band draw in one scaled
group with integer coordinates. PathWriter composes a run in a single 32-byte
word and cannot carry a decimal point. At one ring: band 38 units, canvas 765
units, 85 modules, pad 11.

**THE COST IS ABOUT 55% HIGHER THAN THE FIGURE IN THIS DOCUMENT**, because the
figure in this document is for a different design. `DigitBandCost.t.sol` priced
a 3x5 glyph on TWO edges -- 32 glyphs, section 10j. The design settled in 10k is
3x3 on FOUR, which is 64:

| | recorded (10j, 3x5, two edges) | MEASURED (10k, 3x3, four edges) |
|---|---|---|
| gas | 584,708 | **906,968** |
| bytes | 3,360 | **4,800** |

The banded worst case -- the largest WHOLE token, a child at the ring cap
wearing every Mark -- is **3,705,720 gas / 23,046 bytes**, inside both hard
limits, leaving **294,280 gas and 954 BYTES**.

**The byte margin is the number to watch.** 24,000 was raised on 2026-09-22
against a 3,360-byte band, and the real band is 4,800. It fits, and it fits with
less room than the decision assumed. The external ceiling is unaffected: 23,046
leaves nearly 7,000 under Alchemy's documented 30,000.

**The band's ink is settled: a near-black of its own**, not the frame's fill and
not the token's colour. Taking the frame's fill was built and rendered first,
and at a live streak the border comes out in the heart's red and reads as
another band of ornament rather than as a caption -- the exact failure that
killed colour. It also keeps the band still while the rest of the picture moves:
the frame walks down the tier ladder as a streak lapses and turns gold under
Vessel. **This closes the last open question in 10j.**

**The decode is proven, not assumed:** five ordinals at five pixel sizes, every
one reading the right destination, pinned in the tools suite.

**SIGNED OFF BY THE OPERATOR, 2026-09-22**, from the rendered sheet: the band as
built is the design he approved, the near-black ink stands, and 954 bytes of
margin is accepted. The ink question from 10j is CLOSED -- do not re-open it,
and do not re-propose the frame's fill.

**The code block is 58% of the picture, not the 61% recorded above.** The
difference is `finisher-combined-sheet.mjs`'s approximation, which made its
canvas 14 units narrower than the shipping one. `tools/finisher-band-sheet.mjs`
draws through the reference renderer, so its pictures and its byte counts are
both real.

Implementation: `contracts/src/render/DigitBand.sol`, its mirror in
`tools/render-token.mjs`, and the measurement in
`GasBudget.t.sol:test_theFinishersBandFitsBothHardLimits`.
Plan: `docs/plans/2026-09-22-mro-finisher-digit-band.md`.

**Still to build:** everything else in this document. The five Marks at ids
11-15, the `_finishersSoFar` counter and the ordinal write, the Warden's cap
accounting and same-day ordering, and the copy. Section 10i orders that work and
its step 1 is the boot assertion at `warden/src/mcp/ladder.mjs:109`. Nothing can
set an ordinal yet, so no agent-facing surface has changed and nothing
advertises an unbuilt design.

---

## 10l. DECIDED: the Mark is the INK of the number (2026-09-23)

Decided by the operator, 2026-09-23, from a rendered ladder. The question was
put plainly: in 10k every finisher's number is drawn in the same near-black, so
a Mark 15 holder and a Mark 11 holder look identical apart from the digits. His
answer: **"What's the point of getting a rare mark if you can't see it"** -- and,
when one uncapped Mark with the number as the only prize was offered instead,
**"We want a race to the finish and a prize for being first."**

So each finisher Mark writes the number in its own ink:

| Id | Name | Cap | Finishing place | Ink |
|---|---|---|---|---|
| 15 | Apex | 1 | 1st | gold, `#b8860b` (the Vessel gold) |
| 14 | Atrium | 3 | 2nd to 4th | silver, `#8c9096` |
| 13 | Valve | 10 | 5th to 14th | bronze, `#a0612b` |
| 12 | Chamber | 50 | 15th to 64th | blue, `#2000ff` (the Beat blue) |
| 11 | Aorta | none | 65th onwards | the heart's red, `#c8102e` |

**The caps are 1 / 3 / 10 / 50 plus one uncapped, SET by the operator** -- the
recommendation in section 4 stands as the decision.

**Why this is not the colour 10k rejected.** 10k rejected colouring the RING, a
band of colour round the frame: it read as "more squares", and five inks were
peers, so rank had to be read from metadata. Here the colour is on the WRITING,
and gold / silver / bronze is a ranking every viewer already knows. The frame is
unchanged.

**Measured on the rendered sheet:** every ink decodes (ZXing, 848 px); the ink
is one colour literal, so it costs no bytes against the 954 left. Grey was
tried for the uncapped Mark and dropped -- it is nearly indistinguishable from
silver. Blue is the loudest ink on the ladder and louder than gold; the operator
chose it for 15th-64th with that shown to him.

**What it supersedes:** 10k's single `DIGIT_INK` near-black is no longer the
ink of any finisher. In the build it becomes a lookup by the finisher Mark held.
The Solidity `DigitBand.INK` and its JS mirror move together, as ever.

**What a finished token that has NOT yet claimed a Mark draws** is still open
(10g's "default look"): the band needs an ordinal, and the ordinal is written by
the claim, so the likely answer is no band until the claim lands. Confirm in
the build.

**ANSWERED IN THE BUILD (10m): there is no such state.** `_finish` writes the
ordinal and the Mark bit into one word in one statement, so a token with a place
always has a Mark. `DigitBand.INK`'s near-black survives only as the fallback
for a state the chain cannot reach.

---

## 10m. BUILT 2026-09-24: the Mark is given at 365, and 10f is built

Decided with the operator on 2026-09-23 and built on the days that follow.
**This section is the record of what shipped. Where an earlier section of this
document disagrees with it, this section is right.**

### What changed from the design above

| Decision | What it replaces |
|---|---|
| **The Mark is ASSIGNED at 365, not claimed.** The credit that takes `level` to 365 increments a counter; the counter value is the place; the place picks the Mark. | Sections 4, 6 and 7: an agent claiming a Mark over MCP, with the Warden reserving caps (`sold + reserved`). None of that is built, and none of it is needed. |
| **Place is FINISHING order, ties within a day by lowest token id.** The Clock sorts each batch by `(day, tokenId)`. | Section 5's "claim order" -- there is no separate claim any more, so the two orders cannot disagree. |
| **Stop-at-365 (10f) is in this build.** A credit to a token already at 365 reverts. | 10f was decided on 2026-09-20 and never built. |
| **The tier boundaries are CONSTANTS in the token contract**, not dials. | Section 4's "they are dials (`setUpgrade`)". A place-to-Mark table the owner could edit after finishers exist is a promise that can be broken; the constants cannot be. The `Upgrade` records for 11-15 still carry the caps, for readers, and a test pins them to the constants. |
| **`applyMark` refuses ids 11-15 outright.** | Nothing -- before this build `applyMark` would have accepted them once `setUpgrade` activated them. |

### What was built

**The contract.** `FINISH_LEVEL` is 365 and lives in `_credit`, which both
check-in paths share. A credit to a token already at 365 reverts
`AlreadyFinished(id)`; the credit that REACHES 365 calls `_finish`, which
increments `finishers`, writes the ordinal and the finisher Mark bit into the
marks word in one statement -- the ordinal at bits 64-95, the slot
`TokenView.sol` reserves for it -- increments `_upgrades[markId].sold`, and emits
`Finished(id, ordinal, markId)`. `finisherMark(ordinal)` is the constant place
table: 1st Apex (15), 2nd to 4th Atrium (14), 5th to 14th Valve (13), 15th to
64th Chamber (12), 65th onwards Aorta (11), which is never refused. `applyMark`
reverts `MarkNotRequestable` for any id at or above 11, so a place is never
asked for.

**The picture (10f).** `MAX_RINGS` is deleted from `FrameRenderer.sol` and
`tools/render-token.mjs`. A token draws ONE ring of its own, plus the echo ring
if it is a seeded child, so the widest canvas the piece can produce is a finished
child's 57 cells where it was 89. `_absence` returns 0 once whole and `_rung`
reads at `lastDay` rather than today, so a finished token's image stops moving
with the clock without being `resting` -- completion must not block `seed`.

**The number (10l).** Every finished token carries the digit band, written in
its Mark's ink: gold, silver, bronze, blue and the heart's red.

**The Clock.** `pendingCredits` selects `ORDER BY day ASC, tokenId ASC`, and
one named comparator, `byDayThenId`, is applied at the top of
`writeCheckInChunk` and again immediately before every send, so a halving or a
heal cannot hand a token somebody else's place. `AlreadyFinished` joins the
entry errors keyed by id: the door refuses a 366th check-in, so one reaching the
chain means the mirror fell behind, and dropping it loses nothing.

**The Warden.** A finished token's check-in is refused as year-complete, by the
mirror's level and by a chain read for the case the mirror cannot answer. The
`ladder` tool shows the five as their OWN GROUP, never a sixth pair, with no
price and no call to action, and `upgrade` refuses the route by name with
`mark-not-requestable`. The mirror learns the place from the `Finished` event
into its own column -- `tokens.marks` is a signed 64-bit SQLite INTEGER and
cannot hold bits 64-95 -- and `tokenView` drops `years`, which could only answer
0 or 1 on a piece whose year does not repeat, and adds
`finisher: { place, mark } | null`.

**Nothing reserves anything.** There is no cap accounting in the Warden and no
reserved mask for a finisher Mark, because nothing is sold and nothing is asked
for. `markSold` answers 0 for all five for ever.

### The measured figures

**Run them; do not quote them.** These are what `RealTokenGas.t.sol`,
`GasBudget.t.sol -vv`, `CheckIn.t.sol -vv` and `forge build --sizes` printed on
2026-09-24.

**The worst case is now ONE token** -- a finished child wearing every legal Mark
and its place. The dearest and the largest have converged for the first time:
the rings that went made the picture smaller, the band made it larger, and the
band wins.

**State the harness with the figure.** The two harnesses moved in opposite
directions on the same branch and both are right.

| harness | before this branch | at HEAD | limit | headroom |
|---|---|---|---|---|
| shipping, dearest (`RealTokenGas.t.sol`) | 2,870,177 gas | **3,540,467 gas** | 4,000,000 | 459,533 |
| shipping, largest (`RealTokenGas.t.sol`) | 18,249 bytes | **22,162 bytes** | 24,000 | 1,838 |
| spike, banded (`GasBudget.t.sol`) | 3,705,772 gas | 3,534,616 gas | 4,000,000 | 465,384 |
| spike, banded (`GasBudget.t.sol`) | 23,046 bytes | 22,152 bytes | 24,000 | 1,848 |

The SHIPPING figures ROSE because a shipping token could not be a finisher
before this branch, so that harness had no way to measure the band at all. The
SPIKE figures FELL because the spike could only project the band onto a ring-cap
canvas that 10f has abolished. A rise there and a fall here are the same fact
seen twice, and quoting one against the other is the error this table exists to
stop.

**The one real external ceiling is Alchemy's documented 30,000 bytes**, and
22,162 leaves 7,838 under it.

The 1,000,000 gas / 5,000 byte TARGET is still MISSED, and is still asserted as
missed.

**What the finishing credit costs**, measured in isolation by
`contracts/test/CheckIn.t.sol::test_theFinishingCreditCostsMoreThanAnOrdinaryOne`:

```
an ordinary credit, FIRST of the day        47,630
an ordinary credit, day already stamped     40,161   <- the baseline
the night's lastWardenDay stamp, once        7,469
the FIRST finishing credit                  89,639
a later finishing credit                    89,664
what finishing costs, thereafter           +49,503
```

The baseline is the SECOND call of the night, not the first. `onlyWarden` stamps
`lastWardenDay` once per night, and a per-night cost has no business inside a
per-token difference; measuring against the first call flattered the finishing
credit by about 7,500 gas. The first finisher is not the dear one, which is the
opposite of what the storage rules suggest: `finishers` shares its slot with
`lastWardenDay`, which the modifier has already stamped, so the counter is never
cold. A full chunk of finishers would add 69,304,200 gas, so about sixteen fit
one 1,400-entry chunk before the estimate declines and the Clock writes the
chunk in halves -- a dearer night, not a stalled one.

**Deployability**, `forge build --sizes`, against the 24,576-byte EIP-170 limit:
`MachineReadableOnly` runtime 16,007 bytes, margin 8,569; `Renderer` runtime
20,445 bytes, margin 4,131. Both positive, and a strict-limit anvil deploy
returns non-empty code and a real `tokenURI` read back.

**Decode: 18 of 18.** `tools/finisher-band-sheet.mjs` renders the unbanded
control plus one place per Mark -- six tiles, paired to their Marks by
`finisherMark` rather than by hand -- and decodes each at 256, 848 and 1600 px.
Every tile reads its own url. The tool also reads each band's ink back off the
SVG by structure rather than by string search, because Aorta's red is also the
heart's red and a string search would pass on the fallback near-black.

### What this section supersedes, by name

- **Section 4's "On the cap numbers"**, in the one clause that says the caps are
  dials. The numbers themselves -- 1 / 3 / 10 / 50 plus one uncapped -- stand.
- **Section 5's "It counts CLAIM order, not completion order"** and **"Metadata
  first, not drawn"**. The place counts FINISHING order, and it is drawn.
- **Section 6 in whole.** There is no claim to order, so there is no same-day
  claim race; what is ordered is the Clock's batch, and it is ordered by
  `(day, tokenId)` exactly as section 6 recommended.
- **Section 7 in whole.** A reservation cannot go stale if there is no
  reservation. The defect it warns about is real and the rule still governs the
  PAID ladder; it simply has no finisher Mark to apply to.
- **Section 8's change table**, where it puts the ordinal at bits 32-63. Section
  5's own correction is right: bits 32-63 are the earned Iris's run, the ordinal
  is at 64-95, and that is what was built.
- **Section 10's validation step 2**, "prove the reservation guard by breaking
  it". There is no reservation guard to break.

---

## 11. Non-goals

Stated so they are not re-litigated mid-build:

- **The piece does not stop at 365 days.** Per-token completion was chosen over
  a global ending, and it is BUILT (10f, 10m): a TOKEN stops at 365, the piece
  does not. A global stop would kill lineage outright: `seed()` requires
  a whole parent and the seed budget is `(today() - first) / 365`, so a founder
  earns their first seed on the very day they become whole. Halting the piece
  that day would leave children born at level 1 forever.
- **No existing Mark changes.** Pairs 1 to 5 are untouched.
- **No payment for a finisher Mark.** All five are earned. Payment stays USDC
  elsewhere on the ladder, unchanged.
- ~~**The ordinal is not drawn** in this design.~~ **STALE -- IT IS DRAWN.** 10k
  built the digit band and 10l made its ink the finisher's Mark, so the place is
  written round the border of every finished token. Measured, not estimated:
  the band costs 871,911 gas and 4,636 bytes, and the banded worst case fits
  both hard limits with 459,533 gas and 1,838 bytes to spare (10m).
- **The finished token is not redrawn.** The decoupled compositions were
  rendered and rejected on looks; see 10b.
- ~~**The QR version is not raised.**~~ **STALE -- IT WAS RAISED TO VERSION 10 on
  2026-09-21**, which is why the contract is being redeployed: `CODE_BYTES` is a
  `constant` at 407 and `mint` and `seed` reject any other length. This
  document's gas verdict against the raise rested on an estimate from a borrowed
  gas-per-unit constant, and 10b's own superseded note records the real cost at
  about half that estimate. See 10b and 10j. **No other
  symbology replaces QR**, and that half of the non-goal stands; see 10b.
- **Base64 stays**; see 10c.
- **The ring is not a colour.** Five inks were rendered, tested at every tier,
  and rejected; see 10k. Do not re-propose a coloured finisher ring.
- **The border digits are not rotated.** Upright was chosen over a clockwise
  inscription with both rendered; see 10k.

---

## 12. Decisions the operator still owns

- ~~The cap numbers.~~ **SET: 1 / 3 / 10 / 50 plus one uncapped** (10l).
- ~~What each looks like.~~ **DECIDED: the ink of the number** (10l).
- ~~The five names.~~ **DECIDED 2026-09-23: Apex, Atrium, Valve, Chamber,
  Aorta** (ids 15 down to 11), parts of the heart. Apex is the heart's tip and
  means the top; Aorta, the artery carrying red blood out, goes with the red
  ink. Chosen over a set named after the inks and a finish-line set.
- ~~The combination strategy.~~ **SETTLED 2026-09-20 and BUILT.** The five share
  one surface -- the digit band -- so the decode sweep does not multiply at all.
  Section 9 records it; 10m records what shipped.

**NOTHING IN THIS LIST IS OPEN.** Every line above is struck, and the build is
recorded in 10m. The decisions the operator still owns are the mainnet ones in
`CLAUDE.md`, not anything in this document.
