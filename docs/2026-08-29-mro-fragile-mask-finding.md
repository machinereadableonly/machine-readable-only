# The solver has been picking the one fragile code out of eight

Measured 2026-08-29, Phase 1 of Task 10c. **A decision is needed before any fix
is written**, because this touches ground the project marked settled: the QArt
solver and its best-of-8 mask search.

---

## The short version

`bestOfAllMasks` picks the mask with the highest heart match. On two of twelve
tokens tested, that criterion selected a code that **fails to scan at roughly a
fifth of raster sizes**, while seven of the other eight masks for the same token
scan at every size tested -- for about one percentage point of heart fidelity.

The selector is not just failing to avoid fragile codes. On both failing tokens
it actively chose the fragile one, because fragility and fidelity happened to
point the same way.

## How it was found

Task 10c step 2 crossed twelve independent QArt solves against five states and
decoded each at the four raster sizes a third party actually picks (256, 500,
1000, 1080) plus its own exact multiple as a control.

**300 decodes, 3 failures. Every failure at a third-party size. Zero at exact
multiples.**

| | Decodes | Failures |
|---|---|---|
| Third-party sizes (256/500/1000/1080) | 240 | 3 |
| Exact multiples of the canvas | 60 | 0 |

That alone reproduced the token-12 resonance from sweep D and showed it was not
a one-off. But the interesting part came from characterising it.

## It is not a narrow resonance. It is a fragile solve.

Each failing token was then decoded at 31 raster sizes from 300px to 1800px,
alongside two healthy tokens as controls:

| Token | State | QArt match | Decoded |
|---|---|---|---|
| 1 | whole, 1 year | 64.9% | **31/31** |
| 3 | whole, 1 year | 64.5% | **31/31** |
| 12 | whole, 10 years | 65.4% | 29/31 |
| 55 | whole, 1 year | 64.2% | **25/31 (81%)** |

Token 55 fails at 350, 500, 1000, 1150, 1300 and 1550px. That is not the narrow
resonance sweep D described at one-in-130; it is close to **one raster size in
five**. And the match rates are all within 1.2 points of each other, so **heart
match does not predict robustness at all** -- there is no signal in the number
the solver is currently optimising.

## The cause: mask 4, chosen for fidelity

Solving each token against all eight masks and scoring both fidelity and
robustness over nine raster sizes:

**Token 55** -- the solver chose mask 4.

| Mask | Match | Decodes | |
|---|---|---|---|
| 0 | 62.5% | 9/9 | robust |
| 1 | 63.3% | 9/9 | robust |
| 2 | 62.5% | 9/9 | robust |
| 3 | 62.2% | 9/9 | robust |
| **4** | **64.2%** | **3/9** | **chosen -- fails at 350, 500, 1000, 1150, 1300, 1550** |
| 5 | 61.4% | 9/9 | robust |
| 6 | 60.6% | 9/9 | robust |
| 7 | 62.7% | 9/9 | robust |

**Token 12** -- the solver chose mask 4.

| Mask | Match | Decodes | |
|---|---|---|---|
| 0 | 62.7% | 9/9 | robust |
| 1 | 63.3% | 9/9 | robust |
| 2 | 62.0% | 9/9 | robust |
| 3 | 62.9% | 9/9 | robust |
| **4** | **65.4%** | **8/9** | **chosen -- fails at 700** |
| 5 | 59.9% | 9/9 | robust |
| 6 | 60.3% | 9/9 | robust |
| 7 | 63.9% | 9/9 | robust |

**Token 1** (control) -- chose mask 7, and all eight masks are robust anyway.

The pattern is consistent: where a token is fragile, mask 4 is the culprit and
it wins on match by about a point. Mask 4 is the horizontal-bands pattern, which
produces long uniform runs -- plausible under fractional sampling, though the
mechanism was not chased further because the fix does not depend on it.

**The cost of avoiding it is 0.9 points of heart match on token 55, and 1.5 on
token 12.**

## Two hypotheses tested and rejected

- **Antialiasing does not fix it.** Removing `shape-rendering="crispEdges"` so
  module edges blur was tested on all three failures. All three still failed.
  Worth having ruled out, since a real camera's optical blur was thought to work
  against this artefact.
- **Controlling our own raster size does not fix it either** -- not on its own.
  It helps only consumers that honour the SVG's intrinsic size, and a CDN asked
  for a 500px image will still produce 500px. It remains worth doing (see the
  options), but it is mitigation, not a cure.

## Why this matters more than the numbers suggest

The bitmap is solved **off chain**, by `tools/token-bitmap.mjs`, and the hex is
passed into `mint()`. So a stricter selection criterion costs nothing on chain,
changes no contract, and does not touch the gas budget. But it is also
**permanent per token**: once a fragile code is minted, that token carries it for
the life of the piece. This is not a bug that can be patched later.

Two of twelve tokens is not a rare edge. If it holds, roughly one token in six
would ship a code that fails to scan at a common marketplace image size.

---

## The options

**A. Change the selection criterion to prefer robustness (recommended).**
`bestOfAllMasks` verifies each candidate decodes across a spread of raster
sizes, and picks the highest-match mask among those that survive. Measured cost:
about one point of heart fidelity on affected tokens, none on unaffected ones.
Costs solve time -- roughly 8 masks x N sizes of decoding per token, offline and
once per token, reducible by testing masks in match order and stopping at the
first robust one. No contract change, no gas change.

**B. Ban mask 4 outright.** Simpler and faster: drop 4 from `MASKS`. But it is a
guess dressed as a rule -- mask 4 was fine on token 1, and nothing proves another
mask cannot be fragile on some other payload. It also gives up fidelity on every
token, including the ones that were never at risk.

**C. Do A, and also give the SVG an intrinsic pixel size** (the original Task 10c
step 3). Belt and braces: A removes the fragility, the declared size keeps
consumers that honour it on an exact multiple anyway. About 30 extra bytes in
the tokenURI.

**D. Accept it and move on.** Defensible only if one-in-six tokens carrying a
code that misses at some sizes is acceptable for the piece. Recording it as a
known limitation rather than pretending it is not there.

## What I need from the operator

Which option, and if A or C, what counts as "robust" -- the spread of raster
sizes a solve must clear before it is accepted. My suggestion is the nine sizes
used above plus the exact multiple, which caught every known failure, but a
wider net costs only solve time.

## Evidence

Probes are in the session scratchpad and are throwaway:
`/tmp/claude-1001/-home-tj-projects-machine-readable-only/422be5f6-3d7c-4268-b6b2-27572b513830/scratchpad/`
-- `probe-aa.mjs` (antialiasing), `probe-spread.mjs` (31 sizes),
`probe-masks.mjs` (all eight masks), `cross-sweep.log` (the 300 decodes).

Repo changes made so far in Phase 1, both committed-ready and green:
- `tools/state-matrix.mjs` -- `DECODE_SIZES` extended to 1600px; the cross sweep
  added (`THIRD_PARTY_SIZES`, `CROSS_TOKEN_IDS`, `crossStates`, `crossCases`).
- `tools/soak-offline.mjs` -- `--cross` mode, one solve cached per token id.
- `tools/soak-offline.sh` -- runs the cross sweep, five per process.

The extended extremes sweep passed 72/72 to 1600px, so the palette fix from
sweep C holds where the bug it fixed actually lived. That blind spot is closed.
