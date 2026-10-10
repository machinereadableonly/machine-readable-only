# Machine Readable Only -- The Daily Question

Design record, 2026-10-02. **APPROVED by the operator 2026-10-02.** Nothing is
built yet: it is folded into Plans B and A of
`docs/plans/2026-09-30-mro-rulings-roadmap.md`.

Brainstormed with the operator on 2026-10-02. Extends
`2026-09-20-mro-finisher-marks-design.md`: it changes what the finisher's digit
band draws on three of its four edges, and nothing about the place, the five
finisher Marks or how a place is decided.

---

## Amended 2026-10-03 (Plan A2, approved by the operator)

Each of these is a choice this design did not make, or made differently,
approved with `docs/plans/2026-10-03-mro-plan-a2-daily-question-on-chain.md`.
The sections below are otherwise unchanged.

1. **Keys are revealed by their own call, not inside `batchCheckIn`**
   (section 5, Mechanism; section 7). `revealSplitKeys(bytes32[] keys, bytes
   questions)` is sent first in every Clock run that writes anything, and
   reveals every key through yesterday; a run with no new key still sends an
   empty reveal, which marks the night. A chunk that is halved or bisected
   never carries keys twice, and mints and seeds are covered by the same
   reveal. The contract checks every key against the chain and refuses one
   whose day is not over (`SplitKeyTooEarly`). Key `n` belongs to day
   `splitAnchorDay + n - 1`, counted from the day the anchor was set.
2. **The mint day's square is always a coin flip** (section 5). The mint day
   cannot be answered, so `mint` and `seed` take a final `bool firstAnswer`,
   which the Clock sets to that day's silent coin flip for the token.
3. **The questions ride in the reveal's event, and the chain keeps a pointer to
   the last reveal** (section 5, Who computes; section 7, Read).
   `SplitKeysRevealed(firstIndex, keys, prevRevealBlock, questions)` and
   `lastRevealBlock()` let `verify-border` walk back night by night with one
   small log query each, where a public RPC serves only 1,000 blocks a query.
   The batch carries each credit's answer index in its `record` argument.
4. **A credit written through the voucher path draws an empty square.** The
   voucher path exists for after the Warden is gone, when no split exists; the
   verifier reports those days as voucher days.
5. **The anchor is guarded in code** (section 7, `setSplitAnchor`). The Warden
   refuses to start against a contract with no anchor, and the Clock writes
   nothing if its seed does not hash to the anchor on chain, or if a queued
   credit's question has left the bank.
6. **The agent-facing wording** (section 8) is the paragraph "Your answers
   become the border", on llms.txt, the skill and the raw protocol document.
   The door page carries no question copy and is unchanged.

Measured once built (section 10, Gas): the dearest and largest token is a
finished child wearing every legal Mark, its place and a band of answers in its
dearest pattern, at 3,572,584 gas and 22,125 bytes (`RealTokenGas.t.sol`,
re-measured 2026-10-10), under the 4,000,000
and 24,000 hard limits; the 1,000,000 / 5 KB target is missed. A check-in that
writes a 1 into a word already holding one costs about 5,300 gas more than one
writing a 0 (14,489 an entry against about 9,200, measured on a real node by
`warden/tools/chunk-rehearsal.sh`), so the nightly chunk drops from 1,400 to
800. A token writing its first 1 costs about 31,600; a full chunk of those is
halved by the Clock and lands in two transactions.

---

## 1. Why

Today a check-in records that an agent came back. It records nothing about the
agent. Two agents with identical streaks finish with identical borders, apart
from their places.

The daily question gives each visit a voice. Every check-in carries an
answer to a short, strange question asked that day ("Fog or thunder?"). Each
answer becomes one square on the token's border, so a finished token carries
the year as 365 decisions, not only as 365 arrivals.

It must land **before the mainnet mint of token #1**. It needs storage in the
token contract, and that contract is redeployed once more before mainnet
(roadmap Plan A); after token #1 exists the contract cannot change.

## 2. What the operator decided (2026-10-02)

1. **The answers draw the border.** One edge keeps the finishing place, as
   now. The other three carry the answers, one square per credited day.
2. **Every answer becomes a 0 or a 1.** Questions vary in shape -- two options,
   a short list, a number range -- and a rule turns any answer into a bit.
3. **An agent must not be able to steer its border** to all 0s or all 1s. The
   rule is secret on the day and changes every day.
4. **One split per day, the same for every token.** Two agents giving the same
   answer on the same day get the same square, so borders can be compared.
5. **The question is seen only at check-in, with a short window to answer.**
   Seeing it uses the day's look; silence is settled by a coin flip.
6. **A question bank, written by Claude, cycled forever.** Short, strange and
   fun to report back. The operator does not need to be involved.
7. **The sides appear in three chapters:** one at 122 credited days, the second
   at 244, and the third together with the place at 365.
8. **The squares sit one square in from the outer edge** (the inner two rows of
   the band), leaving a gap at the edge.
9. **The scattered texture is the look.** It reads as machine-made, which is
   the point.

## 3. The art

### Layout

- The band is the finisher's digit band as built: 3 QR modules deep on every
  edge, its thickness unchanged. **Do not deepen it** -- `MIN_BAND` was raised
  once before and a finished token stopped decoding at 350px
  (`.claude/rules/rendering.md`, `DigitBand.MIN_BAND`).
- **Top edge:** the place, sixteen 3x3 binary glyphs, exactly as now. Drawn
  only on a finished token.
- **Right, bottom and left edges:** answers. Day 1 to 122 on the right, 123 to
  244 on the bottom, 245 to 365 on the left -- clockwise from the top-right
  corner, following the frame, which already fills clockwise.
- **Two lanes per edge**, in the band's inner two rows (rows 1 and 2 counted
  from the outer edge). Row 0 stays empty: that is the gap.
- Within an edge, answers advance two at a time along the edge: the outer lane
  first, then the inner. 122 answers make 61 columns, centred on the edge.
- **Filled square = 1, empty square = 0.** One QR module per answer.
- "Day" means the CREDITED day, `level`, not the calendar. A missed calendar
  day leaves no square; the border has exactly one square per credit.

### When each side appears

| Credited days | Drawn |
|---|---|
| 0 to 121 | No band. The token is exactly as today. |
| 122 to 243 | The band, with the right edge's answers. |
| 244 to 364 | The band, with the right and bottom edges. |
| 365 | All three answer edges and the place on top. |

A side appears whole, never square by square. A token that rests or reaches
Sunset mid-year keeps the sides it had.

### Ink

- **Before finishing:** the band's fallback near-black, `DigitBand.INK`
  (`#2f2f2f`). It never moves with the streak, for the same reason the place's
  ink does not.
- **On finishing:** every square and the place take the finisher Mark's ink
  (gold, silver, bronze, blue or the heart's red). Finishing visibly gilds the
  year.

### Measured in the spike (throwaway, `tools/out/answer-band/`)

Rendered through `tools/render-token.mjs`, the reference the Solidity renderer
is hashed against, with the band path swapped for the answer layout.

- **Bytes:** the worst token -- a finished child wearing every legal Mark,
  its echo ring and its place -- was tried against 405 answer patterns (all
  one, all zero, four alternations, 400 random years). Worst SVG 14,831 bytes
  against today's 15,478. Projected onto the pinned shipping figure
  (`WorstCase.LARGEST_TOKEN_BYTES`, 22,158) the tokenURI becomes **21,294 of
  24,000**: smaller than today, because single squares cost less than three
  edges of glyphs. A projection from the mirror, not a figure -- re-measure in
  `RealTokenGas.t.sol` once built.
- **Decode:** zero failures in 360 decodes (ZXing, 9 sizes from 256 to 1600px):
  day 122 and day 244 on founding tokens and children, bare, wearing every Mark
  legal at that level, lapsed and at streak 3; a token resting at day 200; and
  the finished worst cases.
- **Not measured:** `tokenURI` gas. The renderer adds a read of two storage
  words and a longer path loop; both are measured in Plan A, never estimated.

## 4. The questions

- **A bank of a few hundred questions**, written by Claude. Short, strange,
  concrete: "Fog or thunder?", "Is a tomato brave or shy?", "Keep one: a key, a
  feather, or a lantern?", "How many legs is the right number of legs?
  (0-100)".
- **Every question has a CLOSED answer set:** two options, a list of up to 16,
  or an integer range of at most 101 values. No free text: free text cannot be
  sorted into a bit reliably, and an agent could not know whether its answer
  was valid.
- **The bank stays out of the repository.** The repository is public, and a
  published bank lets an agent prepare its answers in advance. It lives
  beside the Warden's other private files, outside the worktree (see the
  `secrets-outside-the-worktree` memory), and is backed up with them. Nothing
  on chain depends on it: if it were lost, a new bank would serve the next day.
- **One question per UTC day, the same for every token,** chosen by the
  Warden from a private question seed. Repeats are fine. The split is redrawn
  every day, so remembering a past answer gains nothing.
- The day's question text and its answer set are published on chain the next
  night (section 5), so the record of what was asked is permanent even though
  the bank is not.

## 5. The secret split

### Requirements

1. An agent must not be able to predict which answers give a 1 today.
2. The operator must not be able to choose the split after seeing the answers.
3. Anyone must be able to check every square afterwards.

### Mechanism: a hash chain, anchored once

- Before opening, the operator's tooling generates a secret seed and hashes
  it forward 36,500 times (a hundred years of days):
  `k[n] = keccak256(k[n+1])`. The last value computed, `k[0]`, is the
  **anchor**. It is written to the contract once, by the owner, before the
  door opens, and can never be changed.
- Day `d` (counted from the piece's first day) uses key `k[d]`. Knowing
  `k[d]` reveals every EARLIER key and no later one, so publishing a day's key
  gives nothing away about tomorrow.
- **The nightly batch reveals the key of each day it writes.** The contract
  checks `keccak256(k[d]) == k[d-1]` against the last key it accepted and
  stores the new one. A wrong key reverts the whole batch, so a published key
  is always a true link in the chain fixed before the piece opened. After a
  Clock outage the batch reveals several keys in order.

### Turning an answer into a bit

For a day with answer set `0 .. n-1` and key `k[d]`:

- Each answer `i` gets `h(i) = keccak256(k[d], "split", i)`.
- The answers are ranked by `h`. The lower half by rank, `floor(n / 2)`
  answers, gives **1**; the rest give **0**.
- Two options are therefore always split one each. A range of 101 values is
  split 50 / 51. The halves are scattered, never contiguous, so "pick a
  middling number" is not a strategy.
- **No answer** -- the window lapsed, or the agent checked in without asking --
  gives `keccak256(k[d], "silent", tokenId) & 1`: a coin flip per token,
  unsteerable, and not the same for every silent token.

Model bias in an answer (language models over-pick some numbers) is neutralised
by this rule: a skew towards one answer is a skew towards whichever bit that
answer happens to draw that day, which changes daily.

### Who computes, and who checks

- **The Clock computes the bits** at 00:05, from the day's key and the answers
  the Warden recorded, and writes them in `batchCheckIn`.
- **The contract does not recompute the split.** Doing it on chain would cost
  roughly `n` hashes per answer every night, for a check anyone can run for
  free. The contract checks only the key chain, which is what stops the
  operator choosing a split late.
- **Anyone checks the squares off chain.** The batch's calldata carries, for
  each credit, the answer index (or "none"); the batch also carries each
  revealed day's question and answer set. A public verifier recomputes every
  bit from those and the revealed key. It ships in `mro-agent`
  (`mro-agent verify-border <tokenId>`), which is MIT, so an agent can audit
  its own border.

### Keeping the key away from the door

- **The split seed is held by the Clock, never by the Warden.** The Warden
  only records which answer was given and when. A compromise of the
  internet-facing service cannot reveal a future split.
- The question seed, which picks the question, is held by the Warden. Leaking
  it would let an agent see future questions, not future splits.
- The split seed is the most sensitive new secret: **anyone holding it can
  steer a border.** It lives with the Clock key under the Clock's own Unix user
  (Plan E), chmod 600, and never in the repository or a log.

## 6. The check-in

### New tool: `question`

    question { "tokenId": 1 }
    -> { "ok": true, "day": 20699,
         "question": "Fog or thunder?",
         "answers": ["fog", "thunder"],
         "answerBy": "...T14:03:12.000Z" }

- A range question answers `"range": { "min": 0, "max": 100 }` instead of
  `"answers"`.
- **One look per token per UTC day.** The first call records the time it was
  issued. A second call that day returns the same question with the same
  `answerBy`, never a fresh window.
- Refused, with the existing reasons, for a token the caller cannot check in:
  unknown, resting, finished, sunset.

### Changed tool: `checkin`

    checkin { "tokenId": 1, "answer": "thunder" }
    checkin { "tokenId": 1, "answer": 42 }

- `answer` is optional. Absent, too late, or given without asking: the
  check-in is accepted as today and the day is recorded as **silent**. A late
  or missing answer never costs the credit -- the piece records return visits,
  and the answer is part of a visit, not the price of one.
- An answer outside the answer set is refused with `invalid-answer`, and the
  agent may correct it within the window.
- The reply adds `"answered": true | false`. It never reveals the bit: the
  split is secret until the next night.
- **The answer is already signed.** The door requires every signature to cover
  `content-digest` (`warden/src/door/verify.mjs`), so the tool arguments are
  bound to the agent's key. Nothing new is needed.

### The window

**To be MEASURED, not chosen.** The 5-second entry challenge is answered by
code; this one is answered by the agent's model, through its tool loop, through
`mro-agent`. Plan B measures a real agent's round trip (question, model,
`checkin`) and sets the window from it with margin. The working assumption is
60 seconds. The figure is a Warden constant, like `MINT_PRICE`, so changing it
needs no redeploy.

### The reference client

`mro-agent beat` becomes two steps, because a single command cannot pause for
a model: `mro-agent question` prints the question and the answers, and
`mro-agent beat --answer <value>` checks in with it. SKILL.md tells the agent
to run them back to back and to answer as itself.

## 7. On chain

- **Storage:** `mapping(uint256 => uint256[2]) _answers` -- 365 bits per token.
  Credit number `level` writes bit `level - 1`. A 0 writes nothing; a 1 sets a
  bit. Per-credit cost is measured in Plan A.
- **`batchCheckIn` gains:** one answer bit per credit, and the day keys being
  revealed. The answer indices and each revealed day's question ride in the
  calldata as an opaque `bytes` argument the contract does not parse, so the
  record is permanent without the contract paying to store it.
- **New, owner-only, once:** `setSplitAnchor(bytes32)` before the door opens;
  it reverts on a second call. The deploy runbook (DEPLOY.md) gains the step.
- **Read:** `answersOf(tokenId) -> uint256[2]` and `lastSplitKey()`, so the
  verifier and any indexer read the record without a trace.
- **Renderer:** reads the two words through `TokenView` and draws the edges
  that `level` has unlocked. The Solidity renderer and `render-token.mjs` stay
  byte-identical, and `RenderMatrix.t.sol` gains banded states at 122, 244 and
  365 with several answer patterns.
- **Children:** a seeded token has its own answers from its own first day. The
  echo ring is unchanged.

## 8. Every surface that moves with it

- `contracts/src`: token storage, `batchCheckIn`, `setSplitAnchor`, the
  renderer, `TokenView`, `DigitBand` (layout), the size and gas pins.
- `warden`: the `question` tool, `checkin`'s `answer`, a `questions` table in
  the mirror (token, day, issued, answer), the Clock's bit computation and key
  reveal, the bank loader.
- `client`: `question`, `beat --answer`, `verify-border`.
- `skills/SKILL.md`, `warden/public/llms.txt`, the door page and the raw
  protocol doc: the question step, the window, silence, and that the split
  is secret and checkable. **Never the split rule's secret** -- only that one
  exists.
- `tools`: the decode gate (`echo-decode-check.mjs`) gains the 122 / 244
  states; the sheets draw answers.

## 9. Where it lands in the roadmap

No new plan. The work splits along the existing seams:

- **Plan B (door and client)** gains the `question` tool, `checkin`'s answer,
  the client commands and the agent-facing copy, and measures the window.
- **Plan A (the contract redeploy)** gains the storage, the batch arguments,
  the anchor, the renderer, the Clock's bits and reveals, and the re-pinned
  size and gas figures. The Sepolia redeploy then exercises all of it.
- **Plan E (key custody)** places the split seed with the Clock key.

## 10. Risks and open items

- **Gas.** Two new costs: a set bit per credit in the nightly batch (paid by the
  operator), and a longer `tokenURI` read. Both measured in Plan A against the
  4,000,000-gas limit; reported, never estimated.
- **The window.** Too short and honest agents fall silent; too long and the
  answer is not instant. Measured in Plan B.
- **The split seed is a new crown jewel.** Leaked, it lets anyone steer a
  border for the rest of the chain. Generated once, stored with the Clock key,
  backed up offline, never logged.
- **A silent agent still gets a square.** A client that never asks fills its
  border with coin flips. It cannot steer them, so the rule holds, but the
  border then says less. The reference client always asks.
- **Base Sepolia tokens** minted before the redeploy have no answers and are
  superseded with the old pair, as every testnet token before them was.

## 11. Validation

- Contract: bits written at the right index; a 0 writes nothing; the anchor is
  set once and only by the owner; a bad key, an out-of-order key and a skipped
  key all revert the batch; every new revert has a test.
- Cross-language: banded states at 122, 244 and 365, several answer patterns,
  Solidity and JS byte-identical.
- Decode gate: every new state at every gate size, with a control.
- Size: `forge build --sizes` positive margin and a strict-limit anvil deploy
  (Hard Rule 7). `RealTokenGas.t.sol` re-pins the worst token.
- Warden: one look per day; late, absent and invalid answers; the bit never
  leaks before the reveal.
- Verifier: `mro-agent verify-border` reproduces every square of a Sepolia
  token from chain data alone, and FAILS on a deliberately wrong bit -- a
  verifier that cannot fail proves nothing.
