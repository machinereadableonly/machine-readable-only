# Machine Readable Only -- The Finisher's Mark

Design record, 2026-09-20. DRAFT, not yet approved for build.

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

A token could become whole in January and not claim until March. If the
ordinal counted completion while the caps counted claims, the two orders would
disagree, and the piece would be able to show finisher number 1 holding a Mark
that finisher number 4 had already taken. One order, used for both.

### Metadata first, not drawn

The ordinal ships as a metadata trait (`Finisher`, a number). It is NOT drawn
into the artwork in this design.

`tokenURI` already MISSES its 1M gas / 5 KB target and passes only the 2M /
20 KB hard limit. Five new drawn Marks already push into that budget; drawing a
variable-length number as well is the change most likely to break it. The
Renderer is swappable, so drawing the ordinal remains available later, measured
against a real gas figure rather than an estimate.

---

## 6. Multiple finishers on the same day

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

**This must be settled before building, not after.** Two candidate answers:

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

**It is still dead, on two independent measurements.**

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

## 11. Non-goals

Stated so they are not re-litigated mid-build:

- **The piece does not stop at 365 days.** Per-token completion was chosen over
  a global ending. A global stop would kill lineage outright: `seed()` requires
  a whole parent and the seed budget is `(today() - first) / 365`, so a founder
  earns their first seed on the very day they become whole. Halting the piece
  that day would leave children born at level 1 forever.
- **No existing Mark changes.** Pairs 1 to 5 are untouched.
- **No payment for a finisher Mark.** All five are earned. Payment stays USDC
  elsewhere on the ladder, unchanged.
- **The ordinal is not drawn** in this design.
- **The finished token is not redrawn.** The decoupled compositions were
  rendered and rejected on looks; see 10b.
- **The QR version is not raised**, and no other symbology replaces it; see 10b.
- **Base64 stays**; see 10c.

---

## 12. Decisions the operator still owns

- **The cap numbers.** 50 / 10 / 3 / 1 is a recommendation built on comparable
  project scale, not a measurement.
- **The five names**, and what each looks like. Naming and visual design have
  not been attempted here.
- **The combination strategy** in section 9, if he wants it decided rather than
  recommended.
