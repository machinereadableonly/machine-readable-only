# Task 10b: the accelerated state soak

**Goal:** exercise every visual state the piece can reach -- every streak tier,
every lapse step, every ring count, every Mark, and the two frozen lifecycles --
against the contracts on Base Sepolia, in minutes rather than years.

---

## Why this, and why now

Ten tasks in, the spike has rendered **four states on chain**. The design space
is considerably larger:

| Dimension | States |
|---|---|
| Streak tiers | 5 (`0-2`, `3-6`, `7-29`, `30-99`, `100+`) |
| Lapse bands | 4 (`gap<3`, `3-6`, `7-29`, `>=30`) |
| Ring counts | 11 (0 to the cap of 10) |
| Heart fill | 366 (0 to 365) |
| Marks | 128 bit combinations, 5 of which draw |
| Lifecycle | 3 (live, resting, sunset) |

Four samples out of that is a demonstration, not a test. Task 11 spends real
money to ask OpenSea a question, and it would be foolish to spend it before
knowing the contract renders correctly at every state a token can actually
occupy.

**What this task is really hunting.** Because a lapse walks *back down* the same
tier ladder rather than using paler tones, only five inks ever reach the canvas,
and all five are already proven scannable. So decode is the lesser risk. The
real risk is **the two renderers disagreeing at a boundary** -- Solidity and the
JS reference each compute the tier and the lapse independently, and the
differential test currently pins seven states out of hundreds. A boundary-off-by-one
in `lapsed()` would be invisible today and permanent once tokens exist.

It unblocks Task 11 by making the mainnet spend worth making.

---

## Scope: four checks, cheapest first

The cross-product is roughly 800,000 states. Testing it is neither possible nor
useful. These four sweeps cover every axis independently, plus the combinations
where axes actually interact.

### A. Colour boundaries -- exhaustive, no rendering

Every tier boundary against every lapse boundary: `streak` in
`{0, 1, 2, 3, 6, 7, 29, 30, 99, 100, 400}` crossed with `gap` in
`{0, 2, 3, 6, 7, 29, 30, 60}`. **88 pairs**, each one step either side of a
threshold.

This needs no image at all -- it is two pure functions, `Palette.lapsed` in
Solidity and `lapsedColour` in JS. A generated fixture table drives a Solidity
test that asserts all 88 in one run. Cheap enough that there is no argument for
sampling.

**This is the check most likely to find a real bug.**

### B. Full-render differential -- 30 states

The existing seven-stage differential extended to cover: each of the 5 tiers at
rest and lapsed, ring counts 0/1/2/5/9/10/11 (11 proving the cap holds), heart
fills 1/12/200/364/365, each of the 5 drawing Marks alone, all Marks, no Marks,
resting and sunset.

Same mechanism as today -- keccak256 and byte length against
`tools/token-uri-fixture.mjs` -- so a divergence anywhere in the image is caught,
not just in the colour.

### C. Decode sweep -- offline, ~40 renders

Every ink against every ring count, with and without Marks, decoded by ZXing at
700px; the eight visual extremes also at 250, 350, 500 and 900px.

**Memory is the hazard here, not correctness.** A sweep of exactly this shape
took the box to 6.28 GB and destroyed a session on 2026-08-28. This one runs in
batches of ten through `~/scripts/safe-build.sh`, and decodes at one size by
default rather than fourteen.

### D. On-chain soak -- ~30 states, Base Sepolia

The accelerated part. `MROSpikeToken.setState` places a token at any life stage
instantly, so one token can live a decade in a few minutes.

For each state: `setState`, then read `tokenURI` back **over the public RPC**,
decode it, and record gas. This is the only check that covers what B and C
cannot:

1. That a state *transition* is reflected -- the contract has only ever been
   read in its post-deploy state.
2. That ERC-4906 `MetadataUpdate` fires with the right token id, after the write.
3. That **no state exceeds the gas cap over RPC.** Four states were measured
   there; thirty is a different claim.

Existing tokens are reused rather than minted, so no new QArt bitmaps are needed
and the cost is ~30 `setState` calls at 35,000 gas each.

**Estimated cost: about 1.1M gas, roughly 0.000008 ETH.** The deployer holds
0.0088 ETH, so this is 0.1% of the balance.

---

## What this deliberately does not do

- **Not all 366 heart fills.** The frame is drawn by a run-length walk over a
  bitmap; five representative fills plus the measured worst case at 364 covers
  the shapes. Rendering 366 states to prove a loop is theatre.
- **Not all 128 Mark bitmaps.** Five bits draw; `MarkRenderer.names` already has
  a test proving it ignores bits outside 1-7.
- **No OpenSea.** That is Task 11 and needs mainnet.
- **No new contract code.** If a sweep finds a bug, fixing it is a separate
  decision, not something to fold in silently.

## Files

**Create:**

| File | Responsibility |
|---|---|
| `tools/state-matrix.mjs` | The single definition of which states matter, imported by every sweep so they cannot drift |
| `tools/colour-fixture.mjs` | Generates the 88-pair table for the Solidity test |
| `contracts/test/PaletteBoundaries.t.sol` | Sweep A |
| `tools/soak-offline.mjs` | Sweep C, batched and capped |
| `contracts/script/soak-sepolia.sh` | Sweep D |

**Modify:** `tools/token-uri-fixture.mjs` and `contracts/test/Renderer.t.sol`
for sweep B; `docs/phase0-results.md` for the results.

## Order, and where it can stop early

1. Sweep A. If Solidity and JS disagree on a colour, **stop and report** -- that
   is a real bug and everything after it is measuring the wrong thing.
2. Sweep B. Same rule: a differential failure stops the task.
3. Sweep C, batched.
4. Sweep D against Sepolia.
5. Record every count in `docs/phase0-results.md`, render the HTML, commit.

## Trade-offs, stated plainly

- **This delays Task 11 by a session.** That is the point: the mainnet spend
  buys an answer about OpenSea, and it is worth more once the contract is known
  correct.
- **Sweep A is the one that earns its keep.** B, C and D are confirmation. If
  time were short, A alone would be the right subset -- but it is also the
  cheapest, so there is no reason to cut the others.
- **Nothing here is irreversible.** Testnet only, no real funds, no mainnet.
