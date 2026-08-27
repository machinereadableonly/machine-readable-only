# MRO: What Marks Are Possible on a QArt Code-Heart

Assessment written 2026-08-27, during the Phase 0 rendering spike. Every number
below was measured, not estimated: rendered with resvg and decode-tested with
jsqr, with WCAG contrast computed per colour pair.

## Why this document exists

The approved spec's seven Marks were designed for the original composition: a
small static QR with 365 heart cells arranged around it. The design now on the
table inverts that -- the heart IS the code, drawn by QArt module reshuffling,
with a two-ring frame outside it that fills one cell per credited day.

That change breaks or weakens several Marks, so the ladder needs rebuilding
rather than porting. This document inventories what the new composition can
actually express, then proposes a ladder that fits it.

## The constraint everything obeys

A QR scans because dark modules contrast against light ones. The working
threshold is a 4.5:1 WCAG ratio. Two consequences dominate every decision here:

1. **The spec's streak palette cannot colour the code.** Measured against
   white: grey `#9a9a9a` 2.81, first tint `#d8a7b1` 2.08, dusk `#e07a8d` 2.86,
   rose `#d9455f` 4.23, red `#c8102e` 5.88. Only the last clears the bar, so a
   code wearing the spec palette stops scanning for the first 30 days. A
   darkened palette keeping the same grey-to-red journey clears every tier:
   `#6f6f6f` 5.02, `#8e5566` 5.77, `#a83a55` 6.17, `#bd2242` 6.05,
   `#c8102e` 5.88.
2. **Light surfaces must stay light.** The code's four-cell quiet zone and its
   light modules can be tinted, but only until contrast fails.

## Surface inventory

The canvas is 53 cells. Working outward from the centre:

| Region | Cells | Currently carries | Free to change? |
|---|---|---|---|
| Code block modules | 37 x 37 | the QArt heart | colour only; geometry is fixed by the payload |
| Quiet zone | ring 4-7 | white | tint, measured safe to 4.99 |
| Gap | ring 1 | white | free |
| Day frame | rings 2-3, 376 cells | 365 days + 11 sealing cells | free |
| Year ring | ring 0, 208 cells | completed years | free |
| Field | whole canvas | white | free |

Non-spatial surfaces, which cost nothing on the canvas:

- The dark-module colour, and whether it is one colour or several.
- The light-module colour inside the code.
- The unfilled (ghost) frame colour.
- The QArt target picture itself -- what shape the modules are driven towards.
- The payload, at a measured cost to picture fidelity.
- `animation_url`, a separate metadata field under no scanning constraint.
- `name` and `attributes`, text with no visual constraint at all.

## Measured treatments

All five decode. SVG sizes are for the whole image at day 200.

| Treatment | SVG | Decodes | Contrast | Verdict |
|---|---|---|---|---|
| Plain (one colour) | 4,895 B | yes | 5.88 | baseline |
| Duotone (heart vs noise) | 5,089 B | yes | 5.88 / 4.54 | **strongest result** |
| Quiet-zone tint | 6,033 B | yes | 4.99 | usable |
| Light-module tint | 8,192 B | yes | 4.60 | works, but +67% bytes |
| Inverted (dark field) | 4,302 B | yes | **3.21** | decodes but **below the 4.5 bar** |

Two findings matter beyond the table.

**Duotone should be part of the base design, not sold as a Mark.** Because the
generator knows which modules were driven to the heart target and which are
uncontrolled noise, it can colour them differently. At `#c8102e` for heart
modules and `#767676` for noise, both clear the contrast bar and the silhouette
stops competing with the noise. This is the single largest legibility gain
available, and it costs 194 bytes. Charging for the thing that makes the
artwork readable would be a mistake.

**The inverted treatment is not yet safe.** It decoded under jsqr on a clean
render, but 3.21 is well under the threshold, and jsqr on clean pixels is more
forgiving than a phone camera. A lighter red on near-black would clear the bar;
that pairing needs measuring and a real-device test before anything depends on
it.

## What happens to the seven specced Marks

| Mark | Spec visual | Status on the new design |
|---|---|---|
| Vein | Outline of the full heart from day one | **Broken.** The heart is complete from day one; there is nothing to preview. |
| Pulse | The heart beats (`animation_url`) | **Intact.** Separate field, no scanning constraint. |
| Voice | Second 21 x 21 QR outside the heart | **Broken.** No room, and growing the canvas breaks thumbnail decode. |
| Bloom | Gradient instead of flat colour | **Intact.** +159 bytes, decodes. |
| Halo | Soft glow ring around the canvas | **Conflicts.** Competes with the year rings, and SVG blur filters are costly and unreliable through marketplace PNG flattening. |
| Crown | Gold frame and a crown motif | **Half.** The gold frame works and the code keeps its streak colour. The motif has nowhere to sit: above the heart is the mandatory quiet zone. |
| Singularity | Heart cells become code modules; the QR is the only red element | **Broken.** That inversion is the new design's default state, so the Mark describes nothing distinct. |

### The Voice problem, quantified

Carrying receipt hash prefixes in the same code's payload is the only route
left, and it consumes the free bits that draw the heart:

| Payload | Free bits | Heart fidelity |
|---|---|---|
| Identity URL only | 640 | 70.9% |
| + 1 receipt | 576 | 69.0% |
| + 2 receipts | 512 | 65.8% |
| + 4 receipts | 384 | 61.1% |

At four receipts the picture falls to roughly QR-version-3 quality, which was
visibly messy in testing. Voice as specced would be the only Mark that makes
the owner's token look worse. It should be redefined, not capped.

## Proposed ladder

Every entry is additive, none degrades the picture, and each claims a distinct
surface so two Marks on one token never fight.

| Id | Mark | Surface claimed | Cost | Notes |
|---|---|---|---|---|
| 1 | Vein | Ghost frame colour | 0 B | The whole year's ring visible from day one instead of near-invisible: the road ahead, not the road behind |
| 2 | Pulse | `animation_url` | 0 B on the image | Unchanged from the spec |
| 3 | Voice | Quiet-zone tint + receipt hashes in `attributes` | ~1,140 B | The receipts become readable metadata; the visible token is the tinted halo hugging the code. Costs no fidelity |
| 4 | Bloom | Gradient on lit cells | ~160 B | Every gradient stop must clear 4.5:1 |
| 5 | Halo | Field tint | ~5 B | Replaces the blur filter, which marketplace flattening cannot be trusted with |
| 6 | Crown | Frame and year-ring colour | ~30 B | Gold. The code keeps its streak colour, so no state is lost |
| 7 | Singularity | The QArt target itself | ~0 B | The code is driven to a different picture entirely. Nothing else in the ladder can touch this surface, which is what makes it the top |

Singularity deserves comment. In the old design it was an inversion of figure
and ground. In the new one, the only surface no other Mark can reach is the
target picture the modules are driven towards -- so the top of the ladder
becomes the right to change what the code draws. That is a stronger claim than
a colour swap, and it costs nothing to render.

## Open questions

- Multiple year rings have nowhere to go. Only the first fits; more need either
  a growing canvas, which runs into the thumbnail-decode ceiling measured
  earlier (canvas 81 stops decoding at 120 px), or rings stacking inward.
- The inverted palette needs a contrast-safe pairing and a real-device scan test
  before Singularity or any Mark relies on it.
- Every decode result here is jsqr on clean renders. A phone-camera test on
  physical screens is still outstanding and is the only thing that settles
  scannability for real.
