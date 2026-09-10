---
paths:
  - "tools/**"
  - "contracts/src/render/**"
---

# Rendering and QR decode rules

Loaded only when working under `tools/` or the on-chain renderer. These are
MEASURED limits, not preferences -- each cost a decode failure to find.

## The decode oracle

**ZXing, not jsqr.** They disagree badly: 24 characters against 101 on the same
image, and jsqr read an inverted render ZXing never even detected. "It scans"
must mean ZXing, at several sizes, with a plain control in the batch.

## The constraints

- **The two inks may not separate by LUMINANCE.** It is the GAP that breaks the
  decode, not darkness: luma 74 against 74 passes at 1600px, 17 against 74 fails.
- **A third party's CDN interpolates unless the SVG declares a size.** With no
  width/height it rasterises at viewBox units -- 53 pixels, one per module --
  then upscales, and **54% of results would not decode**. Declaring
  `canvas * 16` took that to 3.6%. The cheap diagnostic is the grey-level count:
  the artwork has 3, a resampled copy has 150-208.
- **A fragile QArt solve causes missed scans**, not raster resonance. Heart match
  carries NO signal about robustness -- measure the decode, not the likeness.
- Free bytes are `0x40-0x5F`: the only 64-value coset avoiding controls holds the
  backtick and DEL, which Node's URL parser rewrites.
- ECC level L is already spent, which closes most of the artistic-QR playbook.
- No raw `#` may reach the output. The metadata JSON is plain utf-8, not base64.

## Before any mainnet mint

**EVERY QR BITMAP MUST BE RE-SOLVED against `machinereadableonly.com`.** A bitmap
encodes its own url, so nothing solved against the `example.com` placeholder
carries over. The real payload is `https://machinereadableonly.com/t/<id>#` --
36 characters at id 1, carrying the scheme AND a trailing `#`.

Measured 2026-09-03: the domain costs the heart **2.13 points**, about twice what
the 0.065-points-per-character slope predicts. **That slope came from a
9-character increase and does not hold linearly to 12 -- do not quote it as a
general figure.** Robustness did not degrade; all three test ids passed on the
first-choice mask with zero rejections.

## Heavy compute

Rasterising and decoding in bulk is exactly the shape that kills this box -- a
bare `node -e` sweep once reached 6.28 GB and destroyed the session. **Run any
sweep through `~/scripts/safe-build.sh`**, and split bulk work into batches. The
hook only recognises builds; a `node -e` sweep is your judgement call.

`@resvg/resvg-js`'s `.pixels` is a GETTER that copies the buffer on every read.
Read it once.
