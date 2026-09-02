// Reference renderer: the exact SVG the Solidity Renderer must reproduce.
// Kept in one place so Phase 0 can diff on-chain output against it byte for byte.
import { frameCells, BLOCK, THICK, LOCAL, DAY_CELLS } from "./frame-geometry.mjs";

export const QUIET = 4;
export const GAP = 1;           // between the day frame and the year rings

// Streak tiers, darkened from the spec palette so every one clears the 4.5:1
// contrast a scanner needs. Measured against white: 6.53, 5.77, 6.17, 6.05, 5.88.
//
// Every tier separates from the noise by HUE, not by brightness: the deepest red
// is only 1.30:1 against the noise in luminance and still reads instantly. That
// is why the day-one tier cannot be neutral. It used to be #6f6f6f, 1.11:1
// against a #767676 noise and the same hue, so a brand-new token rendered as a
// grey blob with no heart visible in it at all. #70575f is the same weight with
// a trace of rose, which makes the whole ladder a hue journey into #c8102e.
export const TIERS = [
  { min: 100, colour: "#c8102e" },
  { min: 30,  colour: "#bd2242" },
  { min: 7,   colour: "#a83a55" },
  { min: 3,   colour: "#8e5566" },
  { min: 0,   colour: "#70575f" },
];
// The noise cannot be lightened to make room: #767676 is the lightest tone that
// still decodes at every size. Measured, #828282 and up fail from 500px.
// The noise is one ink PER TIER, matched in luminance to the heart at that
// tier, so the two separate by hue alone. Measured 2026-08-29: with a single
// #767676 noise (luma 118) against a heart running 74 to 104, a bare token
// stopped decoding at 1200px and a fully marked one at 900px, while a plain
// black-on-white control of the same code passed at every size to 1600. It is
// the luminance GAP that does it, not darkness -- luma 74 against 74 passes at
// 1600, luma 17 against 74 fails. Index n here pairs with TIERS[n] reversed;
// noiseFor() does the pairing so no caller has to.
export const NOISE_BY_TIER = [
  "#4a4a4a",   // matches #c8102e, luma 74
  "#545454",   // matches #bd2242, luma 84
  "#5e5e5e",   // matches #a83a55, luma 94
  "#686868",   // matches #8e5566, luma 104
  "#5f5f5f",   // matches #70575f, luma 95
];
// Static, the rung-1 Mark (Task 4 rename from Blue Blood): the noise takes a
// green tint. Same weights as NOISE_BY_TIER above -- the luminance pairing does
// not bend for a Mark, because the binarizer does not care why an ink is
// lighter. Only the hue moves.
//
// GREEN, chosen by the operator 2026-09-02 from a rendered sheet (static-hue-sheet.mjs)
// that put all four candidates plus the shipped grey under ONE derivation
// across all five run rungs. It is the only hue that keeps getting STRONGER as
// the run deepens (10/21/39/55/66 across the rungs, where slate, teal and
// violet all peak at run 7 and fall back): a deeper streak darkens the heart,
// the noise must darken to match, and a blue or violet cannot hold high chroma
// at a dark luma while a green can.
//
// Derived, not chosen: a green direction [0, 124, 8] pulled toward its own
// grey until its chroma is 60% of that rung's heart, then scaled onto that
// rung's exact BT.601 luma. Must match Palette.staticAt in Solidity.
export const STATIC_BY_TIER = [
  "#08770f",   // matches #c8102e, luma 74
  "#1d7a23",   // matches #bd2242, luma 84
  "#37793b",   // matches #a83a55, luma 94
  "#537655",   // matches #8e5566, luma 104
  "#556557",   // matches #70575f, luma 95
];

export const GHOST = "#f4eef0";   // frame cells not yet earned
export const FIELD = "#ffffff";

// Mark colours. Each Mark claims one surface and no two claim the same one, so
// a token wearing all five is still legible. Every value here is decode-tested
// with ZXing on the real rendered token at 900, 700, 500 and 350 px by
// render-token.test.mjs -- contrast arithmetic alone is not sufficient, as the
// noise ink sits at 4.54 against white and so is already at the floor before
// any tint is applied.
export const ACHE_GHOST = "#e3ccd3";  // Ache: the year ahead, visible from day one
export const HUSH_QUIET = "#fdf3e3";  // Hush: the quiet zone hugging the code
export const AURA_FIELD = "#fbeff2";  // Aura: the whole field
export const VESSEL_GOLD = "#b8860b"; // Vessel: frame and year rings
// Beat: the far end of the heart gradient. VIOLET, chosen by the operator 2026-08-31 from
// a rendered sheet: it makes the heart bi-chromatic and reads as spectrum
// rather than blood. Same string length as the red it replaced (#c8102e), so
// zero bytes and zero gas.
export const BEAT_TO = "#2000ff";

// Tint's two inks -- the eyes only, and only when an Iris is worn. Violet and
// gold, chosen by the operator 2026-09-02 from tools/tint-on-green-sheet.mjs, which
// rendered every candidate against Static's green, the surface that directly
// surrounds the eyes. Heart red is out because the untinted Iris already
// draws in the token's own colour; green is out because it is Static's;
// near-black is out because it is what an ORDINARY QR eye already looks like.
// Must match MarkRenderer.TINT_VIOLET / TINT_GOLD in Solidity.
export const TINT_VIOLET = "#9800fc";
export const TINT_GOLD = "#b8860b";

// Re-measured 2026-08-29, correcting an earlier note in this file that claimed
// #f9eaef was the deepest tint that still decodes. It is not: #f9eaef fails at
// 900 px, and #f7e3e8 fails at 900, 700 and 500. The shipped #fdf3e3 decodes at
// all four sizes, asserted in render-token.test.mjs so the margin cannot be
// tightened without the suite noticing.
//
// It is also a different hue from Aura's rose, so Hush reads as amber rather
// than as a slightly deeper pink that would vanish when both Marks are worn at
// once.

// Ten Mark ids in five pairs, nine distinct names, eight surfaces. Index n here
// is mark id n + 1. Both Iris ids emit "iris": same surface, two routes, and the
// route is visible in the image rather than in the JSON.
export const MARKS = [
  "hush", "ache", "static", "beat", "iris",
  "iris", "vessel", "break", "tint", "aura",
];

// TIERS is written top-down (100+ first) while Solidity indexes the ladder
// bottom-up (0 = the start of a life). Everything below works in RUNGS -- the
// Solidity direction -- so the two languages can be read side by side.
const TOP = TIERS.length - 1;
export const rungOf = streak => TOP - TIERS.findIndex(t => streak >= t.min);
export const colourAt = rung => TIERS[TOP - rung].colour;
export const noiseAt = rung => NOISE_BY_TIER[TOP - rung];
export const staticAt = rung => STATIC_BY_TIER[TOP - rung];
export const tierColour = streak => colourAt(rungOf(streak));

// Break's exchange, DEFINITION B: swap which rung colour the heart and the
// noise take, rather than swapping the fills verbatim (Definition A, which
// hands Beat's gradient to the noise and was rejected -- see MarkRenderer.inks
// in Solidity for the full reasoning). The decode rule survives the exchange
// for free: colourAt(r) and the noise at the same rung are matched in
// luminance by construction, so swapping two equal-luminance inks leaves the
// binarizer the same picture. Mirrors MarkRenderer.inks exactly.
export function inks(marks, rung) {
  const colour = colourAt(rung);
  const n = hasMark(marks, STATIC) ? staticAt(rung) : noiseAt(rung);
  return hasMark(marks, BREAK)
    ? { heartInk: n, noiseInk: colour }
    : { heartInk: colour, noiseInk: n };
}

// A lapse walks BACK DOWN the same ladder rather than introducing paler tones.
// Paler is not available: #767676 is the lightest ink that still decodes, so a
// genuinely paler heart would stop scanning. Reusing the ladder means every
// colour a lapse can produce is already proven scannable.
//
// Steps at 3, 7 and 30 days so each step is one marketplace refresh rather than
// a continuous fade needing a refresh every day. At 30 the heart returns all the
// way to the start, which is what the spec's separate effective-streak rule
// implies as well.
//
// MUST stay identical to Palette.lapsed in contracts/src/render/Palette.sol.
// The Solidity has the same boundary tests; if these two ladders ever diverge,
// one of the two suites fails.
/**
 * The rung a token sits on once a lapse is counted.
 *
 * Returned as a rung rather than a colour because the heart ink and the noise
 * ink must come from the SAME rung -- they are matched in luminance, and a
 * mismatch stops the code decoding at large rasters. Mirrors
 * Palette.lapsedIndex in Solidity line for line.
 */
export function lapsedRung(streak, lastDay, today) {
  const gap = today > lastDay ? today - lastDay : 0;   // a backwards clock is not a lapse
  if (gap < 3) return rungOf(streak);
  if (gap >= 30) return 0;
  const rung = rungOf(streak);
  const steps = gap >= 7 ? 2 : 1;
  return steps >= rung ? 0 : rung - steps;
}

export function lapsedColour(streak, lastDay, today) {
  return colourAt(lapsedRung(streak, lastDay, today));
}
// Completed-year rings stop growing the canvas at MAX_RINGS.
//
// Ten, decided 2026-08-29 after rendering the same token at every ring count
// (docs/year-rings.png). The old cap of 80 was set by what still fits the gas
// and byte limits, which turned out to be the wrong question: the rings stop
// being readable long before they stop fitting. At 20 rings the heart is under
// half the canvas and at 80 it is a fifth, a red field with a stamp in it -- and
// the 80-ring token does not decode at a 300px thumbnail at all.
//
// Ten years is also the point where the piece has a better answer than a
// eleventh ring: the token seeds a child, and Lineage carries the record on.
// The Years attribute in the JSON keeps counting past the cap regardless, so
// nothing is lost from the record -- only the ring stops being added.
//
// MUST stay identical to FrameRenderer.MAX_RINGS in Solidity.
export const MAX_RINGS = 10;
export const ringsFor = years => Math.min(years, MAX_RINGS);

// Rings are drawn one cell wide with one cell of field between them, so they can
// be counted. Contiguous rings merged into a single slab of colour: at five you
// could no longer tell them apart, which defeats the point of drawing one per
// year. The gap costs two extra cells of canvas per year rather than one.
export const ringSpan = rings => (rings === 0 ? 0 : 2 * rings - 1);
export const canvasFor = years => BLOCK + 2 * (THICK + GAP + ringSpan(ringsFor(years)));

const FRAME = frameCells();

// Same-colour horizontal runs merged into one path each. This is what keeps the
// image inside budget: one rect per cell measured 70,298 bytes, this form 4,986.
export function pathFor(set, canvas) {
  let d = "";
  for (let y = 0; y < canvas; y++) {
    let x = 0;
    while (x < canvas) {
      if (!set.has(y * canvas + x)) { x++; continue; }
      let w = 1;
      while (x + w < canvas && set.has(y * canvas + x + w)) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  }
  return d;
}

// One outline ring per completed year, outermost first, drawn as four bars
// rather than as cells.
//
// The gap that makes rings countable also makes them ruinous to draw row by row:
// away from a ring's own top or bottom edge, a row crosses every ring separately,
// so ten rings put twenty one-cell runs on every row of the canvas. Measured at
// the cap, that came to 20,531 bytes for the frame alone, over the 20,000 limit
// for the whole tokenURI. As bars it is four runs per ring regardless of canvas
// size.
//
// Rings never touch the day frame -- GAP keeps a blank cell between them -- so no
// run here could have merged with a frame run anyway, and pulling them out of the
// row walk moves no pixel.
export function ringBars(rings, canvas) {
  let d = "";
  for (let k = 0; k < rings; k++) {
    const o = 2 * k;                  // ring k sits at depth 2k
    const len = canvas - 2 * o;       // its full width, corners included
    d += `M${o} ${o}h${len}v1h-${len}z`;
    d += `M${o} ${canvas - 1 - o}h${len}v1h-${len}z`;
    const h = len - 2;                // the sides, corners already drawn
    if (h > 0) {
      d += `M${o} ${o + 1}h1v${h}h-1z`;
      d += `M${canvas - 1 - o} ${o + 1}h1v${h}h-1z`;
    }
  }
  return d;
}

// The QR's three reshaped finder patterns ("eyes"). Mirrors
// contracts/src/render/EyeRenderer.sol exactly -- written FROM the Solidity,
// not from the sheet, so the string building matches. Shape 0 target
// (concentric circles), 1 squircle (rounded rects), 2 leaf (two opposite
// corners rounded). See EyeRenderer.sol for the geometry notes and the decode
// testing that picked these three.
export const IRIS_SHAPE_NAMES = ["target", "squircle", "leaf"];

const eyeErase = (x, y, ground) => `<rect x="${x}" y="${y}" width="7" height="7" fill="${ground}"/>`;

const eyeTarget = (x, y, ink, ground) => {
  const cx = `${x + 3}.5`, cy = `${y + 3}.5`;
  return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${ink}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${ground}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${ink}"/>`;
};

const eyeSquircle = (x, y, ink, ground) =>
  `<rect x="${x}" y="${y}" width="7" height="7" rx="3" fill="${ink}"/>`
  + `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="2.1" fill="${ground}"/>`
  + `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1.5" fill="${ink}"/>`;

// Two opposite corners rounded, r 2.6 / 1.8 / 1.3. `x + 2.6` etc. print with a
// single decimal digit for an integer x, which is why Solidity has to build
// these as string.concat(toString(x + 2), ".6") -- verified to match before
// EyeRenderer.sol was written.
const eyeLeaf = (x, y, ink, ground) =>
  `<path fill="${ink}" d="M${x + 2}.6 ${y}h4.4v4.4a2.6 2.6 0 0 1 -2.6 2.6h-4.4v-4.4a2.6 2.6 0 0 1 2.6 -2.6z"/>`
  + `<path fill="${ground}" d="M${x + 2}.8 ${y + 1}h3.2v3.2a1.8 1.8 0 0 1 -1.8 1.8h-3.2v-3.2a1.8 1.8 0 0 1 1.8 -1.8z"/>`
  + `<path fill="${ink}" d="M${x + 3}.3 ${y + 2}h1.7v1.7a1.3 1.3 0 0 1 -1.3 1.3h-1.7v-1.7a1.3 1.3 0 0 1 1.3 -1.3z"/>`;

const EYE_SHAPES = [eyeTarget, eyeSquircle, eyeLeaf];

/**
 * The three eyes, reshaped, at the three fixed finder-pattern positions
 * relative to `codeOff`. Erased to `ground` before `ink` is drawn on top --
 * NEVER a constant, because the ground is the actual colour under the code
 * block (HUSH_QUIET when Hush is worn, otherwise the field, which Aura
 * tints). Mirrors EyeRenderer.eyes in Solidity.
 */
export function eyeOverlay(codeOff, shape, ink, ground, size) {
  const draw = EYE_SHAPES[shape] ?? eyeTarget;
  const positions = [[0, 0], [size - 7, 0], [0, size - 7]];
  let out = "";
  for (const [ex, ey] of positions) {
    const x = codeOff + ex, y = codeOff + ey;
    out += eyeErase(x, y, ground) + draw(x, y, ink, ground);
  }
  return out;
}

/**
 * @param modules  the code's module bits, row major, size*size
 * @param want     the heart target bits, same shape, used to split heart from noise
 * @param state    { level, streak, years, marks, lastDay, today, resting,
 *                   sunset, irisVariant, tintVariant, irisRun }
 *
 * state.marks is an array of Mark ids (1..10), not names -- see MARKS above
 * and hasMark below. Ids 5 and 6 both draw "iris", and Task 6 needs to tell
 * them apart, which a name array could not do.
 *
 * irisVariant is the shape index (0/1/2) written when the BOUGHT Iris is
 * applied; tintVariant is the ink index (0/1) written when Tint is applied;
 * irisRun is the streak stored when the EARNED Iris is applied. All three
 * default to 0, mirroring the bits `_marks` packs on chain when a Mark has
 * never been applied.
 */
export function renderSvg(modules, want, size, state) {
  const {
    level = 0, streak = 0, years: rawYears = 0, marks = [],
    lastDay = 0, today = 0, resting = false, sunset = false,
    // Pixels per cell declared as the SVG's intrinsic size. Mirrors
    // Renderer.pxPerCell(), adopted 2026-08-29 on a measured A/B: it took
    // third-party decode failures from 54% to 3.6%. The two languages must
    // carry the same number or the differential test is measuring nothing.
    // Pass 0 for the RendererUnsized control.
    pxPerCell = 16,
    // The bits _marks packs on chain for the eyes: the BOUGHT Iris's shape,
    // Tint's ink, and the streak the EARNED Iris stored when it was applied.
    irisVariant = 0, tintVariant = 0, irisRun = 0,
  } = state;
  const years = ringsFor(rawYears);
  const canvas = canvasFor(years);
  const frameOff = ringSpan(years) + GAP;   // where the 49-grid frame starts
  const blockOff = frameOff + THICK;     // where the 45-cell block starts
  const codeOff = blockOff + QUIET;      // where the modules start

  // A token that has stopped checking in pales, walking back down the tier
  // ladder. A sealed or sunset token does not: its image is final, so the
  // stored streak colours it forever. Both branches must mirror Palette.tier
  // and Palette.lapsed in Solidity exactly.
  const frozen = resting || sunset;
  const rung = frozen ? rungOf(streak) : lapsedRung(streak, lastDay, today);
  const colour = colourAt(rung);
  // Static claims the noise ink -- the one surface no other Mark touches.
  // Selected by RUNG, not by colour, so the heart and the noise can never be
  // taken from different tiers. Break then exchanges which rung colour the
  // heart and the noise take (Definition B) -- see inks() above. The FRAME
  // keeps `colour` unaffected; only the code block's two regions exchange.
  const { heartInk, noiseInk: noise } = inks(marks, rung);
  const gold = hasMark(marks, VESSEL) ? VESSEL_GOLD : null;
  const ghost = hasMark(marks, ACHE) ? ACHE_GHOST : GHOST;
  const field = hasMark(marks, AURA) ? AURA_FIELD : FIELD;
  const hush = hasMark(marks, HUSH);
  const beat = hasMark(marks, BEAT);

  const lit = new Set(), dim = new Set(), noiseCells = new Set();

  // Day frame. The 11 surplus cells light only when the heart is whole.
  const whole = level >= DAY_CELLS;
  FRAME.forEach(([x, y], i) => {
    const p = (y + frameOff) * canvas + (x + frameOff);
    ((whole || i < level) ? lit : dim).add(p);
  });
  // Code modules, split so the heart separates from the uncontrolled noise.
  const heart = new Set();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!modules[j * size + i]) continue;
      const p = (codeOff + j) * canvas + (codeOff + i);
      (want[j * size + i] ? heart : noiseCells).add(p);
    }
  }

  // Draw order: the frame's two paths, then the code's two. Every one of these
  // four sets is disjoint from the others -- no cell appears in two of them -- so
  // the order changes no pixel. It is fixed this way so that each renderer's pair
  // of paths is adjacent in the output, which lets FrameRenderer and CodeRenderer
  // each emit one string that the assembler simply concatenates. Interleaving
  // them would force both libraries to be split into single-path functions for no
  // visual gain.
  const groups = [];
  if (dim.size) groups.push([ghost, dim]);
  const frameColour = gold ?? colour;
  // The frame's own cells first, then the rings, so the contract can emit its
  // row walk and then append the bars.
  const framePath = pathFor(lit, canvas) + ringBars(years, canvas);
  if (framePath) groups.push([frameColour, framePath]);
  if (noiseCells.size) groups.push([noise, noiseCells]);
  if (heart.size) groups.push([heartInk, heart]);

  // Beat replaces the heart's flat fill with a gradient running from the
  // token's own streak colour into violet. Both ends are colours the ladder
  // already proves scannable, so no stop between them can be paler than the
  // palest tier. The near stop is heartInk rather than colour, so Break +
  // Beat moves it to the noise ink and leaves the far stop, BEAT_TO, alone.
  const heartFill = beat ? "url(#b)" : heartInk;
  const defs = beat
    ? `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="${heartInk}"/>`
      + `<stop offset="1" stop-color="${BEAT_TO}"/></linearGradient></defs>`
    : "";

  const body = groups.map(([c, s]) => {
    // The heart group carries the gradient reference rather than a raw colour.
    const fill = (s === heart) ? heartFill : c;
    const d = typeof s === "string" ? s : pathFor(s, canvas);
    return `<path fill="${fill}" d="${d}"/>`;
  }).join("");

  // Hush tints the whole 45-cell block behind the code, which is one rect
  // rather than a path over the 656 quiet-zone cells. The modules are drawn on
  // top, so tinting the full square costs 46 bytes instead of about 1,140.
  const quiet = hush
    ? `<rect x="${blockOff}" y="${blockOff}" width="${BLOCK}" height="${BLOCK}" fill="${HUSH_QUIET}"/>`
    : "";

  // ` width="848" height="848"` when a size is declared, empty otherwise -- so
  // the unsized build emits the exact bytes it always has, down to the single
  // space before viewBox.
  const px = pxPerCell ? canvas * pxPerCell : 0;
  const intrinsic = px ? ` width="${px}" height="${px}"` : "";

  // The reshaped eyes, drawn LAST -- over the noise, the frame and the heart --
  // so the erase-to-ground step lands cleanly even on a token wearing Static,
  // whose green already recolours these same modules as ordinary code. Empty
  // when no Iris is worn, so the finder patterns stay ordinary code modules
  // exactly as they are today. Mirrors Renderer._eyes in Solidity.
  const anyIris = hasMark(marks, IRIS_BOUGHT) || hasMark(marks, IRIS_EARNED);
  let eyes = "";
  if (anyIris) {
    const earned = hasMark(marks, IRIS_EARNED);
    // The EARNED Iris does not lapse: its rung comes from the run stored at
    // apply time, not the live rung, which is the whole point of the Mark --
    // it stops tracking the lapse. Break's exchange is then applied at THAT
    // rung through inks(), not the token's live rung: the earned Iris is
    // frozen at a top-tier run, and under Break the live noise is also
    // top-tier red, so computing the eye's ink at the live rung would collide
    // the eye into the noise it sits on. Mirrors Renderer._eyes in Solidity.
    const eyeRung = earned ? rungOf(irisRun) : rung;
    const base = inks(marks, eyeRung).heartInk;
    const ink = hasMark(marks, TINT) ? (tintVariant === 1 ? TINT_GOLD : TINT_VIOLET) : base;
    const ground = hush ? HUSH_QUIET : field;
    const eyeShape = earned ? 0 : irisVariant;
    eyes = eyeOverlay(codeOff, eyeShape, ink, ground, size);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg"${intrinsic} viewBox="0 0 ${canvas} ${canvas}" shape-rendering="crispEdges">${defs}<rect width="${canvas}" height="${canvas}" fill="${field}"/>${quiet}${body}${eyes}</svg>`;
}

// ---------------------------------------------------------------------------
// The metadata wrapper. This is the reference the Solidity Renderer is diffed
// against byte for byte, so every choice here is load-bearing.
//
// Measured 2026-08-28, three routes for the same token at 80 rings:
//   base64 SVG inside a utf-8 JSON   14,780 B   2,375,511 gas
//   utf-8 SVG, percent-escaped        11,139 B   5,846,742 gas
//   base64 SVG inside a base64 JSON   19,804 B   3,210,443 gas
// Base64 wins on gas by a factor of 2.5 despite being the largest-but-one on
// bytes, because a per-byte escape loop in Solidity costs far more than
// Solady's word-wise encoder. The spec left this open ("unless the spike shows
// base64 is needed"); the spike shows it.
//
// The hash character cannot appear raw anywhere in the URI. The whole tokenURI
// is itself a URI, so a raw "#" starts the fragment and truncates the JSON --
// measured: JSON.parse fails with "Unterminated string at position 31". Base64
// hides every "#" in the SVG (the colours, and Beat's url(#b) reference); the
// only one left is in the name, written as %23.
export const TOKEN_NAME = "Machine Readable Only";
export const DESCRIPTION =
  "An agent's record of coming back. The heart is the code, and the frame is the year.";

const attr = (k, v) => `{"trait_type":"${k}","value":${v}}`;
const num = (k, v) => attr(k, `${v}`);
const str = (k, v) => attr(k, `"${v}"`);

// Mark ids, ladder order 1 to 10. Mirrors MarkRenderer.sol's bit constants
// exactly -- id n is bit n there and index n-1 into MARKS here.
export const HUSH = 1;
export const ACHE = 2;
export const STATIC = 3;
export const BEAT = 4;
export const IRIS_BOUGHT = 5;
export const IRIS_EARNED = 6;
export const VESSEL = 7;
export const BREAK = 8;
export const TINT = 9;
export const AURA = 10;

/** The marks this token wears, in ladder order, as a JSON array. */
export function markNames(ids) {
  const held = new Set(ids);
  const out = [];
  MARKS.forEach((name, i) => { if (held.has(i + 1)) out.push(name); });
  return `[${out.map(m => `"${m}"`).join(",")}]`;
}

/** Does this token wear mark `id`? The one predicate every selector uses. */
export const hasMark = (ids, id) => ids.includes(id);

/**
 * @param state { tokenId, level, streak, lastDay, mintDay, today, generation,
 *                seedsGiven, parent, agentKeyId, resting, sunset, marks,
 *                irisVariant, tintVariant, irisRun }
 */
// The attribute list is the spec's, in the spec's order. `Sunset` is the one
// entry the spec does not list; it is real piece-wide state a reader can act
// on, so it stays. Every line here has a twin in Renderer._attrsA / _attrsB --
// the differential test exists to catch the two drifting apart.
export function tokenUri(modules, want, size, state) {
  const {
    tokenId = 0, level = 0, streak = 0, lastDay = 0, mintDay = 0, today = 0,
    generation = 0, seedsGiven = 0, parent = 0, agentKeyId = 0,
    resting = false, sunset = false, marks = [],
    irisVariant = 0, tintVariant = 0, irisRun = 0,
  } = state;

  const years = Math.floor(level / DAY_CELLS);
  // Cells shown is capped at 365 even though level is not.
  const shown = Math.min(level, DAY_CELLS);
  // Resting wins over whole: it is the more final of the two states.
  const suffix = resting ? " (At Rest)" : level >= DAY_CELLS ? " (Whole)" : "";
  // BigInt so a plain number and a 0x..n literal both render the same 66 chars.
  const keyHex = `0x${BigInt(agentKeyId).toString(16).padStart(64, "0")}`;
  const svg = renderSvg(modules, want, size,
    { level, streak, years, marks, lastDay, today, resting, sunset, irisVariant, tintVariant, irisRun });
  const image = Buffer.from(svg, "utf8").toString("base64");

  // "Iris Shape" is emitted for BOTH routes -- the earned Iris does have a
  // shape (always "target") and an agent reading the JSON should not have to
  // know that "absent means target". "Iris Run" is emitted for the EARNED
  // route only, because it is the thing the bought route does not have.
  // Mirrors Renderer._irisAttrs in Solidity.
  const earnedIris = hasMark(marks, IRIS_EARNED);
  const anyIris = hasMark(marks, IRIS_BOUGHT) || earnedIris;
  const irisAttrs = anyIris
    ? [
        str("Iris Shape", IRIS_SHAPE_NAMES[earnedIris ? 0 : irisVariant]),
        ...(earnedIris ? [num("Iris Run", irisRun)] : []),
      ]
    : [];

  const json = "{"
    + `"name":"${TOKEN_NAME} %23${tokenId}${suffix}",`
    + `"description":"${DESCRIPTION}",`
    + `"image":"data:image/svg+xml;base64,${image}",`
    + `"attributes":[`
    + [
        num("Level", level),
        num("Streak", streak),
        str("Heart", `${shown}/${DAY_CELLS}`),
        num("Years", ringsFor(years)),
        str("Whole", level >= DAY_CELLS ? "yes" : "no"),
        num("Mint Day", mintDay),
        num("Last Day", lastDay),
        str("Agent Key", keyHex),
        num("Generation", generation),
        num("Parent", parent),
        num("Children", seedsGiven),
        str("Resting", resting ? "yes" : "no"),
        str("Sunset", sunset ? "yes" : "no"),
        ...irisAttrs,
        attr("Marks", markNames(marks)),
      ].join(",")
    + "]}";

  return `data:application/json;utf-8,${json}`;
}
