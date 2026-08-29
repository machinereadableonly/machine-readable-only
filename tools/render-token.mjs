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
export const NOISE = "#767676";   // uncontrolled modules, 4.54 against white
export const GHOST = "#f4eef0";   // frame cells not yet earned
export const FIELD = "#ffffff";

// Mark colours. Each Mark claims one surface and no two claim the same one, so
// a token wearing all five is still legible. Every value here is decode-tested
// with ZXing on the real rendered token at 900, 700, 500 and 350 px by
// render-token.test.mjs -- contrast arithmetic alone is not sufficient, as the
// noise ink sits at 4.54 against white and so is already at the floor before
// any tint is applied.
export const VEIN_GHOST = "#e3ccd3";  // Vein: the year ahead, visible from day one
export const VOICE_QUIET = "#fdf3e3"; // Voice: the quiet zone hugging the code
export const HALO_FIELD = "#fbeff2";  // Halo: the whole field
export const CROWN_GOLD = "#b8860b";  // Crown: frame and year rings
export const BLOOM_TO = "#c8102e";    // Bloom: the far end of the heart gradient

// Re-measured 2026-08-29, correcting an earlier note in this file that claimed
// #f9eaef was the deepest tint that still decodes. It is not: #f9eaef fails at
// 900 px, and #f7e3e8 fails at 900, 700 and 500. The shipped #fdf3e3 decodes at
// all four sizes, asserted in render-token.test.mjs so the margin cannot be
// tightened without the suite noticing.
//
// It is also a different hue from Halo's rose, so Voice reads as amber rather
// than as a slightly deeper pink that would vanish when both Marks are worn at
// once.
export const MARKS = ["vein", "pulse", "voice", "bloom", "halo", "crown", "singularity"];

export const tierColour = streak => TIERS.find(t => streak >= t.min).colour;

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
export function lapsedColour(streak, lastDay, today) {
  const gap = today > lastDay ? today - lastDay : 0;   // a backwards clock is not a lapse
  if (gap < 3) return tierColour(streak);
  if (gap >= 30) return TIERS[TIERS.length - 1].colour;
  const index = TIERS.length - 1 - TIERS.findIndex(t => streak >= t.min);
  const steps = gap >= 7 ? 2 : 1;
  return TIERS[TIERS.length - 1 - (steps >= index ? 0 : index - steps)].colour;
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

/**
 * @param modules  the code's module bits, row major, size*size
 * @param want     the heart target bits, same shape, used to split heart from noise
 * @param state    { level, streak, years, marks, lastDay, today, resting, sunset }
 */
export function renderSvg(modules, want, size, state) {
  const {
    level = 0, streak = 0, years: rawYears = 0, marks = [],
    lastDay = 0, today = 0, resting = false, sunset = false,
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
  const colour = frozen ? tierColour(streak) : lapsedColour(streak, lastDay, today);
  const gold = marks.includes("crown") ? CROWN_GOLD : null;
  const ghost = marks.includes("vein") ? VEIN_GHOST : GHOST;
  const field = marks.includes("halo") ? HALO_FIELD : FIELD;
  const voice = marks.includes("voice");
  const bloom = marks.includes("bloom");

  const lit = new Set(), dim = new Set(), noise = new Set();

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
      (want[j * size + i] ? heart : noise).add(p);
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
  if (noise.size) groups.push([NOISE, noise]);
  if (heart.size) groups.push([colour, heart]);

  // Bloom replaces the heart's flat fill with a gradient running from the
  // token's own streak colour into the deepest red. Both ends are colours the
  // ladder already proves scannable, so no stop between them can be paler than
  // the palest tier.
  const heartFill = bloom ? "url(#b)" : colour;
  const defs = bloom
    ? `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="${colour}"/>`
      + `<stop offset="1" stop-color="${BLOOM_TO}"/></linearGradient></defs>`
    : "";

  const body = groups.map(([c, s]) => {
    // The heart group carries the gradient reference rather than a raw colour.
    const fill = (s === heart) ? heartFill : c;
    const d = typeof s === "string" ? s : pathFor(s, canvas);
    return `<path fill="${fill}" d="${d}"/>`;
  }).join("");

  // Voice tints the whole 45-cell block behind the code, which is one rect
  // rather than a path over the 656 quiet-zone cells. The modules are drawn on
  // top, so tinting the full square costs 46 bytes instead of about 1,140.
  const quiet = voice
    ? `<rect x="${blockOff}" y="${blockOff}" width="${BLOCK}" height="${BLOCK}" fill="${VOICE_QUIET}"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" shape-rendering="crispEdges">${defs}<rect width="${canvas}" height="${canvas}" fill="${field}"/>${quiet}${body}</svg>`;
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
// hides every "#" in the SVG (the colours, and Bloom's url(#b) reference); the
// only one left is in the name, written as %23.
export const TOKEN_NAME = "Machine Readable Only";
export const DESCRIPTION =
  "An agent's record of coming back. The heart is the code, and the frame is the year.";

const attr = (k, v) => `{"trait_type":"${k}","value":${v}}`;
const num = (k, v) => attr(k, `${v}`);
const str = (k, v) => attr(k, `"${v}"`);

/** The marks this token wears, in ladder order, as a JSON array. */
export function markNames(marks) {
  return `[${MARKS.filter(m => marks.includes(m)).map(m => `"${m}"`).join(",")}]`;
}

/**
 * @param state { tokenId, level, streak, lastDay, mintDay, today, generation,
 *                seedsGiven, parent, agentKeyId, resting, sunset, marks }
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
  } = state;

  const years = Math.floor(level / DAY_CELLS);
  // Cells shown is capped at 365 even though level is not.
  const shown = Math.min(level, DAY_CELLS);
  // Resting wins over whole: it is the more final of the two states.
  const suffix = resting ? " (At Rest)" : level >= DAY_CELLS ? " (Whole)" : "";
  // BigInt so a plain number and a 0x..n literal both render the same 66 chars.
  const keyHex = `0x${BigInt(agentKeyId).toString(16).padStart(64, "0")}`;
  const svg = renderSvg(modules, want, size,
    { level, streak, years, marks, lastDay, today, resting, sunset });
  const image = Buffer.from(svg, "utf8").toString("base64");

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
        attr("Marks", markNames(marks)),
      ].join(",")
    + "]}";

  return `data:application/json;utf-8,${json}`;
}
