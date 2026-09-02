import test from "node:test";
import assert from "node:assert/strict";
import { solve, payloadFor } from "../qart.mjs";
import { heartTarget } from "../heart-target.mjs";
import { renderSvg, canvasFor, tierColour, lapsedColour, TIERS, NOISE_BY_TIER,
         rungOf, colourAt, noiseAt, bluebloodAt, MAX_RINGS, ringsFor, ringSpan,
         HUSH_QUIET, hasMark, ACHE, STATIC, HUSH, BEAT, VESSEL, BREAK, AURA,
       } from "../render-token.mjs";
import { scanResult } from "./helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const CODE = solve(PAYLOAD, 0);
const TARGET = heartTarget(CODE.size);

const render = state => renderSvg(CODE.modules, TARGET.want, CODE.size, state);
const DESTINATION = PAYLOAD.slice(0, -1);   // everything before the "#"
// WCAG relative luminance, for the contrast the scanner actually needs.
const expand = h => { const s = h.replace("#", ""); return s.length === 3 ? s.split("").map(c => c + c).join("") : s; };
const lum = h => {
  const s = expand(h);
  const c = [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("every streak tier clears the contrast a scanner needs", () => {
  for (const t of TIERS)
    assert.ok(contrast(t.colour, "#ffffff") >= 4.5,
      `tier ${t.min} (${t.colour}) is ${contrast(t.colour, "#ffffff").toFixed(2)}, under 4.5`);
  for (const n of NOISE_BY_TIER)
    assert.ok(contrast(n, "#ffffff") >= 4.5,
      `noise ${n} is ${contrast(n, "#ffffff").toFixed(2)} against white, under 4.5`);
});

// BT.601, the weighting ZXing's RGBLuminanceSource uses -- not WCAG's, which is
// a human legibility measure. The binarizer is what this has to satisfy.
const luma601 = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

test("every Static ink matches its tier in luminance", () => {
  // The Mark may move the noise in HUE; it may not move it in WEIGHT. The
  // binarizer resolves on weight and does not care why an ink is lighter, so
  // Static clears exactly the bar the neutral palette clears. Mirrors
  // PaletteNoise.t.sol.
  for (let rung = 0; rung < TIERS.length; rung++) {
    const gap = Math.abs(luma601(colourAt(rung)) - luma601(bluebloodAt(rung)));
    assert.ok(gap <= 1,
      `rung ${rung}: heart ${colourAt(rung)} and Static ${bluebloodAt(rung)} `
      + `are ${gap.toFixed(1)} apart in luminance -- they must match`);
  }
});

test("Static never out-chromas the heart it surrounds", () => {
  // Not a decode rule -- every intensity measured decodes. It is about which
  // element is the subject: the start-tier heart carries the least chroma on
  // the ladder, so a vivid noise takes the picture over. Day one binds it.
  const chroma = h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  for (let rung = 0; rung < TIERS.length; rung++) {
    const heart = chroma(colourAt(rung)), noise = chroma(bluebloodAt(rung));
    assert.ok(noise < heart,
      `rung ${rung}: Static ${bluebloodAt(rung)} has chroma ${noise} against `
      + `a heart ${colourAt(rung)} at ${heart} -- the noise must stay quieter`);
  }
});

test("every noise ink matches its tier in luminance", () => {
  // The invariant the state soak bought on 2026-08-29. Both inks of the code
  // must binarize as dark; once the raster is large enough that ZXing's 8x8
  // blocks fall inside one module, the lighter of the two goes to background.
  // A bare token stopped decoding at 1200px and a fully marked one at 900px
  // while the noise was a constant #767676. Mirrors PaletteNoise.t.sol.
  for (let rung = 0; rung < TIERS.length; rung++) {
    const gap = Math.abs(luma601(colourAt(rung)) - luma601(noiseAt(rung)));
    assert.ok(gap <= 1,
      `rung ${rung}: heart ${colourAt(rung)} and noise ${noiseAt(rung)} `
      + `are ${gap.toFixed(1)} apart in luminance -- they must match`);
  }
});

test("the token scans at every stage of its life", () => {
  for (const state of [
    { level: 0, streak: 0, years: 0 },
    { level: 12, streak: 2, years: 0 },
    { level: 200, streak: 45, years: 0 },
    { level: 365, streak: 140, years: 1 },
    { level: 365, streak: 1, years: 1 },       // whole but lapsed
    { level: 1095, streak: 400, years: 3 },
  ]) {
    const got = scanResult(render(state));
    assert.ok(got.ok, `${JSON.stringify(state)}: ${got.why} -- ${JSON.stringify(got.text)}`);
    assert.equal(got.destination, DESTINATION, `wrong destination at ${JSON.stringify(state)}`);
  }
});

test("the code is always dark ink on a light field, never inverted", () => {
  // A light-on-dark code is not a QR code as the standard defines it, and the
  // decoders that matter treat it that way. Measured 2026-08-28: an inverted
  // render -- light heart on black -- was never even DETECTED by ZXing at any
  // size, while jsqr read it happily, which is exactly the false confidence that
  // let the binary-payload bug survive. Inverted is ruled out, and this test is
  // what stops it coming back in through a Mark or a future palette edit.
  for (const state of [
    { level: 0, streak: 0, years: 0 },
    { level: 200, streak: 45, years: 0 },
    { level: 365, streak: 140, years: 1 },
    { level: 365, streak: 140, years: 1, marks: [ACHE] },
    { level: 365, streak: 140, years: 1, marks: [AURA] },
    { level: 365, streak: 140, years: 1, marks: [VESSEL] },
  ]) {
    const svg = render(state);
    // The field is the first rect: the ground everything else is painted on.
    const field = svg.match(/<rect[^>]*fill="(#[0-9a-fA-F]{3,6})"/)[1];
    const inks = [...svg.matchAll(/<path[^>]*fill="(#[0-9a-fA-F]{3,6})"/g)].map(m => m[1]);
    assert.ok(inks.length > 0, "no ink at all");
    for (const ink of inks) {
      assert.ok(lum(ink) < lum(field),
        `${JSON.stringify(state)}: ink ${ink} is lighter than the field ${field} -- `
        + "that is an inverted code, which standard decoders reject");
    }
  }
});

test("the day-one heart is visible against the noise", () => {
  // The heart and the noise used to be #6f6f6f and #767676: same hue, 1.11:1
  // apart, so a new token showed no heart. Neither a shared hue nor a shared
  // weight is acceptable on its own -- the two inks have to differ somehow.
  const day1 = tierColour(0);
  const chroma = h => { const e = h.replace("#", "");
    const [r, g, b] = [0, 2, 4].map(i => parseInt(e.substr(i, 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b); };

  // The heart and the noise are matched in LUMINANCE on purpose, so contrast
  // can no longer do this job -- hue is the only thing left separating them.
  // That makes chroma load-bearing rather than decorative: a neutral start tier
  // would now be completely invisible against its noise, not merely faint.
  const noise = noiseAt(rungOf(0));
  assert.ok(chroma(noise) === 0, `the noise ${noise} must be a neutral grey`);
  assert.ok(chroma(day1) >= 20,
    `day-one heart ${day1} has chroma ${chroma(day1)}. Its noise ${noise} is `
    + `matched in luminance, so hue is all that separates them -- a near-neutral `
    + `heart would not read at all`);
});

test("the real image scans at every size a viewer might see it", () => {
  // Contrast against white is necessary but NOT sufficient: the noise tone clears
  // WCAG at 4.54 and a scanner's binarizer still has to cope with three inks at
  // once. Only decoding the actual rendered token proves it, and it has to hold
  // across sizes -- a local binarizer behaves differently on a big raster than a
  // small one, so passing at one size says nothing about the others.
  for (const px of [900, 700, 500, 350, 250]) {
    for (const state of [
      { level: 0, streak: 0, years: 0 },          // day one, the palest state
      { level: 200, streak: 45, years: 0 },
      { level: 365, streak: 140, years: 1 },
    ]) {
      const got = scanResult(render(state), px);
      assert.ok(got.ok, `${px}px ${JSON.stringify(state)}: ${got.why}`);
    }
  }
});

test("the image stays inside the spec's size budget", () => {
  for (const years of [0, 1, 3]) {
    const svg = render({ level: 365, streak: 140, years });
    const b64 = Math.ceil(svg.length / 3) * 4;
    const tokenUri = Math.ceil((b64 + 400) / 3) * 4;   // plus the JSON envelope
    assert.ok(tokenUri < 20000, `tokenURI ${tokenUri} exceeds the 20,000 limit at ${years} years`);
  }
});

test("the frame seals only when the heart is whole", () => {
  const open = render({ level: 364, streak: 100, years: 0 });
  const sealed = render({ level: 365, streak: 100, years: 0 });
  assert.notEqual(open, sealed, "day 365 should differ from day 364");
  assert.ok(open.includes("#f4eef0"), "an unfinished year should still show ghost cells");
  assert.ok(!sealed.includes("#f4eef0"), "a whole heart should have no ghost cells left");
});

test("canvas grows one ring per completed year, with a gap between rings", () => {
  // Two cells per side per year: the ring, and the blank that separates it from
  // the next one in. Without the blank the rings merge into a single slab and
  // the year count cannot be read off the image.
  assert.equal(canvasFor(0), 51);
  assert.equal(canvasFor(1), 53);
  assert.equal(canvasFor(3), 61);
  assert.equal(canvasFor(10), 89, "the cap");
  assert.equal(canvasFor(99), 89, "past the cap it stops growing");
});

test("the ring cap is ten years and matches the contract", () => {
  // Decided 2026-08-29 on rendered evidence (docs/year-rings.png): past ten
  // years the heart is under half the canvas and the rings stop being
  // countable. MUST equal FrameRenderer.MAX_RINGS, asserted there too.
  assert.equal(MAX_RINGS, 10);
  assert.equal(ringsFor(10), 10);
  assert.equal(ringsFor(400), 10);
  assert.equal(ringSpan(0), 0, "no years, no rings");
  assert.equal(ringSpan(1), 1, "one ring is one cell");
  assert.equal(ringSpan(2), 3, "ring, gap, ring");
  assert.equal(ringSpan(10), 19, "ten rings and nine gaps");
});

test("streak tiers map to the right colours", () => {
  assert.equal(tierColour(0), "#70575f");
  assert.equal(tierColour(3), "#8e5566");
  assert.equal(tierColour(7), "#a83a55");
  assert.equal(tierColour(30), "#bd2242");
  assert.equal(tierColour(100), "#c8102e");
  assert.equal(tierColour(9999), "#c8102e");
});

// The six Marks that touch the image (Task 4 rename: vein -> ache, blueblood
// -> static, voice -> hush, bloom -> beat, halo -> aura, crown -> vessel).
// Iris Bought, Iris Earned, Break and Tint draw nothing yet -- the eyes and
// the inversion land in later tasks.
const DRAWN_MARKS = [ACHE, STATIC, HUSH, BEAT, AURA, VESSEL];

test("every drawn mark changes the image without breaking the scan", () => {
  const base = render({ level: 200, streak: 45, years: 0 });
  for (const mark of DRAWN_MARKS) {
    const svg = render({ level: 200, streak: 45, years: 0, marks: [mark] });
    assert.notEqual(svg, base, `mark ${mark} changed nothing`);
    const got = scanResult(svg);
    assert.ok(got.ok, `mark ${mark} broke the scan: ${got.why}`);
    assert.equal(got.destination, DESTINATION, `mark ${mark} changed the destination`);
  }
});

test("a mark that does not draw yet leaves the image alone", () => {
  // Break is the inversion (Task 7) and Iris Bought is the eyes (Task 6) --
  // neither is built, so neither may change the image today.
  const base = render({ level: 200, streak: 45, years: 0 });
  assert.equal(render({ level: 200, streak: 45, years: 0, marks: [BREAK] }), base,
    "break should not touch the image yet");
});

test("Static tints the noise and nothing else", () => {
  const base = render({ level: 200, streak: 45, years: 0 });
  const marked = render({ level: 200, streak: 45, years: 0, marks: [STATIC] });
  assert.notEqual(marked, base, "Static must actually change the image");

  // The ONLY difference may be the noise ink. Swapping the tinted ink back for
  // the neutral one has to reproduce the unmarked image byte for byte -- if it
  // does not, the Mark has reached a surface that belongs to another Mark.
  const rung = rungOf(45);
  const restored = marked.split(bluebloodAt(rung)).join(noiseAt(rung));
  assert.equal(restored, base, "Static touched something other than the noise");
});

test("Static scans at every rung and every size", () => {
  // The Mark tints half the lit modules in the code block, so it has to clear
  // the decode bar at every tier rather than at the one that happened to be
  // rendered during design. 848 is the exact multiple (53 cells x 16); the rest
  // are sizes a third party picks, including the 1200-1600 band where the old
  // constant-grey noise first failed.
  const SIZES = [256, 500, 848, 1080, 1600];
  const STREAKS = [0, 3, 7, 30, 100];   // one per rung, lowest first

  for (const streak of STREAKS) {
    const svg = render({ level: 200, streak, years: 0, marks: [STATIC],
                         lastDay: 1000, today: 1000 });
    for (const px of SIZES) {
      const got = scanResult(svg, px);
      assert.ok(got.ok,
        `Static at streak ${streak} failed to decode at ${px}px: ${got.why}`);
      assert.equal(got.destination, DESTINATION,
        `Static at streak ${streak} decoded to the wrong url at ${px}px`);
    }
  }
});

test("the worst case a token can reach still scans", () => {
  // Ten rings and every drawn Mark at once: the largest canvas, the tinted
  // quiet zone and the gradient heart all working against the scanner
  // together. Checked at four pixel sizes because a local binarizer behaves
  // differently on a big raster than a small one.
  const svg = render({ level: 365 * 10, streak: 140, years: 10, marks: DRAWN_MARKS });
  for (const px of [900, 700, 500, 350]) {
    const got = scanResult(svg, px);
    assert.ok(got.ok, `the worst case failed at ${px}px: ${got.why}`);
    assert.equal(got.destination, DESTINATION, `the destination changed at ${px}px`);
  }
});

test("the shipped quiet-zone tint keeps its decode margin", () => {
  // Measured 2026-08-29, then re-measured the same day after the noise inks were
  // matched to their tiers in luminance.
  //
  // The margin moved a long way. #f9eaef used to fail at 900px and was pinned
  // here as the proof that the shipped tint had no room to spare; it now decodes
  // at every size, and so does everything down to about #d4aabb. Matching the
  // code's two inks did that -- with the noise no longer the lightest thing in
  // the block, the binarizer has far more to work with. #c294a8 is the new
  // counter-example, and it fails at 700px and below.
  //
  // The lesson is kept rather than the number: a tint has to be MEASURED, and
  // the floor moves when anything else in the block changes.
  const at = tint => {
    const svg = render({ level: 200, streak: 45, years: 0, marks: [HUSH] })
      .replace(new RegExp(HUSH_QUIET, "g"), tint);
    return [900, 700, 500, 350].filter(px => !scanResult(svg, px).ok);
  };
  assert.deepEqual(at(HUSH_QUIET), [], "the shipped tint must decode at every size");
  assert.ok(at("#c294a8").length > 0, "#c294a8 must remain too deep to adopt");
});

test("a lapse pales the image, and a sealed token never pales", () => {
  // The bug this covers: lapsedColour existed and was unit-tested, but
  // renderSvg called tierColour and the lapse never reached the picture, while
  // Palette.lapsed did apply it on the Solidity side.
  const base = { level: 200, streak: 100, years: 0, lastDay: 1000 };
  const fresh = render({ ...base, today: 1000 });
  const lapsed = render({ ...base, today: 1040 });
  assert.notEqual(fresh, lapsed, "forty days without a check-in should pale the image");
  assert.ok(lapsed.includes(tierColour(0)), "a long lapse returns to the start tier");

  for (const freeze of ["resting", "sunset"]) {
    assert.equal(render({ ...base, today: 1040, [freeze]: true }), fresh,
      `a ${freeze} token should keep the colour it was sealed with`);
  }
});

test("the duotone survives every mark", () => {
  // The heart and the uncontrolled noise must stay two separate fills. Beat
  // swaps the heart's flat colour for a gradient reference and must not merge
  // the two groups. Static is the ONLY Mark permitted to change the noise
  // ink, so the expected noise is chosen by the mark set rather than fixed --
  // if any other Mark ever tints it, this fails, which is the point.
  for (const marks of [[], [BEAT], [STATIC], DRAWN_MARKS]) {
    const svg = render({ level: 200, streak: 45, years: 0, marks });
    const rung = rungOf(45);
    const noise = hasMark(marks, STATIC) ? bluebloodAt(rung) : noiseAt(rung);
    assert.ok(svg.includes(`fill="${noise}"`), `noise fill lost with ${marks}`);
    const heart = hasMark(marks, BEAT) ? 'fill="url(#b)"' : `fill="${tierColour(45)}"`;
    assert.ok(svg.includes(heart), `heart fill lost with ${marks}`);
  }
});

test("a lapse walks back down the same ladder, never off it", () => {
  // Kept identical to Palette.lapsed in Solidity, which asserts these same
  // boundaries. If the two ever diverge, one of the two suites fails.
  const RED = "#c8102e", ROSE = "#bd2242", DUSK = "#a83a55", TINT = "#8e5566", START = "#70575f";
  const at = gap => lapsedColour(100, 1000, 1000 + gap);
  assert.equal(at(0), RED, "same day");
  assert.equal(at(2), RED, "two days, still inert");
  assert.equal(at(3), ROSE, "3 days, one step");
  assert.equal(at(6), ROSE);
  assert.equal(at(7), DUSK, "7 days, two steps");
  assert.equal(at(29), DUSK);
  assert.equal(at(30), START, "30 days, back to the start");
  assert.equal(at(9999), START);

  assert.equal(lapsedColour(0, 1000, 1003), START, "cannot fall below the start");
  assert.equal(lapsedColour(3, 1000, 1007), START);
  assert.equal(lapsedColour(100, 1000, 999), RED, "a backwards clock is not a lapse");

  const ladder = new Set(TIERS.map(t => t.colour));
  for (const streak of [0, 3, 7, 30, 100]) {
    for (const gap of [0, 2, 3, 7, 30, 500]) {
      assert.ok(ladder.has(lapsedColour(streak, 1000, 1000 + gap)),
        `streak ${streak} gap ${gap} produced a colour outside the ladder`);
    }
  }
  assert.equal(TINT, TIERS.find(t => t.min === 3).colour, "ladder order changed");
});
