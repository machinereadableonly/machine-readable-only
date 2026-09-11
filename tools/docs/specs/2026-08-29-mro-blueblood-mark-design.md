# Blue Blood: the rung-2 Mark

Design decided 2026-08-29. Replaces Pulse, which was dropped on measured gas
evidence the same day.

## Why this exists

Pulse was rung 2 of the seven-Mark ladder and it is gone. `RendererPulse`
measured the cheapest workable version of its `animation_url` -- image rendered
once, second copy spent only on encoding, HTML because OpenSea's live media
documentation supports SVG for `image` only -- and it cost +469,027 gas. That
put the day-364 worst case at 2,025,331 gas with the minimum Mark set and
2,065,436 with every Mark, over the 2,000,000 hard limit. Bytes were never the
problem; gas was. The operator dropped it.

That leaves rung 2 empty. The ladder is a priced ladder, so an empty rung is not
a cosmetic gap: Vein at 1 and Voice at 20 have nothing between them.

## The surface

The design rule that makes Marks composable is that no two claim the same
surface, so a token wearing all seven is still one legible image rather than a
pile of effects. The drawn image has exactly seven surfaces and six were already
claimed:

| Surface | Mark |
|---|---|
| the field behind everything | Halo |
| the quiet zone hugging the code | Voice |
| frame cells not yet earned | Vein |
| earned day cells and year rings | Crown |
| the heart modules | Bloom |
| the QArt target picture itself | Singularity |
| **the noise modules' ink** | **unclaimed** |

Blue Blood claims the last one. Three things make it the right choice rather
than merely the only one:

- **It is the largest remaining surface.** The noise is roughly half the lit
  modules in the code block, so the Mark is visible at a thumbnail.
- **It costs almost nothing.** `CodeRenderer.paths` already takes the noise ink
  as a parameter, exactly as it takes the heart fill. The Mark is a substituted
  string, the same shape as Vein, Halo and Crown, which together measure about
  5,000 gas and 206 bytes for all five drawing Marks.
- **It is the opposite of Pulse's failure.** Pulse needed a second document;
  this needs a different four-byte colour.

The alternative considered and rejected was inventing new geometry -- a marker
cell in the day frame showing today's position in the year. It is affordable at
roughly 40 bytes and disturbs no invariant, but it needs new drawing code in
both languages and is close to invisible at a 256px thumbnail. A rung-2 Mark
that cannot be seen in a listing is not worth selling.

## The name

"Blue Blood" carries both meanings the tier needs: aristocracy, for a paid Mark
on a ladder that ends in Crown and Singularity, and literal blue blood in the
vessels, which sits directly beside Vein at rung 1.

The metadata identifier is `blueblood`, one lowercase token, because
`MarkRenderer.names()` emits from a fixed single-word literal array and the
other six entries are single words.

## The colour, and how it is derived

**The binding constraint is luminance, not taste.** The heart ink and the noise
ink must MATCH in BT.601 luminance. Once a raster is large enough that ZXing's
8x8 binarizer blocks fall inside a single module, a block has no local contrast
and resolves against its neighbours, and the LIGHTER of the two inks goes to
background. A constant `#767676` noise against a heart running luma 74 to 104
stopped a bare token decoding at 1200px and a fully marked one at 900px. So a
tinted noise may move in HUE but not in WEIGHT.

The inks are therefore **derived, not chosen**. A slate hue direction
`[60, 90, 130]` is pulled 70% toward its own grey to set the intensity, then
scaled so each tier lands on that tier's exact luma. Hand-picking five hex
values would have been five chances to break the invariant by eye.

| Tier | Heart | Heart chroma | Noise today | Blue Blood noise | Noise chroma | Luma gap |
|---|---|---|---|---|---|---|
| 0 (streak 100+) | `#c8102e` | 184 | `#4a4a4a` | `#444b55` | 17 | 0.39 |
| 1 (streak 30+) | `#bd2242` | 155 | `#545454` | `#4d5560` | 19 | 0.13 |
| 2 (streak 7+) | `#a83a55` | 110 | `#5e5e5e` | `#565f6c` | 22 | 0.18 |
| 3 (streak 3+) | `#8e5566` | 57 | `#686868` | `#5f6a77` | 24 | 0.21 |
| 4 (day one) | `#70575f` | 25 | `#5f5f5f` | `#57606d` | 22 | 0.60 |

Every gap is inside the existing `gap <= 1` assertion.

### Why this intensity and not a bolder one

Chroma is a constant that governs what the token LOOKS like, so it was rendered
at every value rather than argued. At chroma 60 to 77 the Mark decodes perfectly
well and still looks wrong: the day-one heart carries chroma 25, so a vivid
noise **out-saturates the heart it surrounds** and the noise becomes the subject
of the picture. At chroma 8 to 11 it is indistinguishable from the shipped
neutral grey, which cannot be sold as a Mark.

That yields the rule, and it is stricter than "it decodes":

> The noise chroma must stay below the heart's chroma at the same tier.

Day one is the binding case, because the start-tier heart is the least saturated
colour on the ladder. At 22 against 25 the rule holds at every tier with the
narrowest margin exactly where it should be tested.

Sheets: `docs/noise-mark.png` (hue) and `docs/noise-mark-intensity.png`
(intensity), regenerated by `node tools/noise-mark-sheet.mjs`. Both gitignored,
like every other PNG in this repo.

## The invariant that changes

`tools/test/render-token.test.mjs` and `contracts/test/PaletteNoise.t.sol`
currently assert the noise is a NEUTRAL grey (`chroma === 0`). That assertion
exists for a real reason: the two inks are matched in luminance, so hue is the
only thing separating them, and a near-neutral HEART would be invisible against
a neutral noise.

Blue Blood makes the noise chromatic, so the assertion has to be restated rather
than deleted:

- Unmarked, the noise stays neutral and the existing rule is unchanged.
- With Blue Blood, the two inks must differ in HUE, and the noise chroma must
  stay below the heart chroma at the same tier.
- The luminance match holds in both cases and is not relaxed.

This is a load-bearing invariant bought by the state soak on 2026-08-29. It is
being made stricter and more explicit, not loosened, but it must be reviewed as
a change to proven ground rather than slipped in as a test edit.

## What changes

- `MarkRenderer`: `PULSE` becomes `BLUEBLOOD` at the same bit (rung 2, price 5),
  `names()` emits `blueblood`, and a new `noise(marks, tierNoise)` selector
  returns the slate ink or the shipped grey.
- `Palette`: the five Blue Blood inks alongside the five neutral ones, taken
  from ONE rung so the pair cannot be wired apart, as the existing inks are.
- `Renderer`: pass the noise through `MarkRenderer.noise` the way it already
  passes the heart fill through `MarkRenderer.heartFill`.
- `tools/render-token.mjs`: the same constants and the same selection. The two
  languages are diffed byte for byte, so a divergence fails the suite.
- Tests: the luminance match extended over both palettes; the new chroma-ceiling
  rule; a decode gate over the Blue Blood inks at every tier and every size; the
  differential test's fixtures regenerated.

## Cost

Expected to be indistinguishable from zero -- a substituted colour string, the
same shape as Vein, Halo and Crown. To be MEASURED, not assumed, and reported
against the day-364 worst case before it is called done.

## What this does not do

It does not restore what Pulse meant. Pulse made the heart beat; nothing on this
ladder now suggests motion. That was the operator's explicit call when the slot was
declared open rather than reserved for an aliveness Mark.

## Files to remove, pending approval

`contracts/src/render/RendererPulse.sol` and `contracts/test/PulseCost.t.sol`
exist only to have measured Pulse. Their numbers are recorded in
`docs/phase0-results.md`, so the files are spent. They are NOT deleted by this
design; removal is a separate ask.
