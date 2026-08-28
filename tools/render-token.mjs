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
export const canvasFor = years => BLOCK + 2 * (THICK + GAP + years);

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

/**
 * @param modules  the code's module bits, row major, size*size
 * @param want     the heart target bits, same shape, used to split heart from noise
 * @param state    { level, streak, years, marks }
 */
export function renderSvg(modules, want, size, state) {
  const { level = 0, streak = 0, years = 0, marks = [] } = state;
  const canvas = canvasFor(years);
  const frameOff = years + GAP;          // where the 49-grid frame starts
  const blockOff = frameOff + THICK;     // where the 45-cell block starts
  const codeOff = blockOff + QUIET;      // where the modules start

  const colour = tierColour(streak);
  const gold = marks.includes("crown") ? "#b8860b" : null;
  const ghost = marks.includes("vein") ? "#e3ccd3" : GHOST;
  const field = marks.includes("halo") ? "#fbeff2" : FIELD;

  const lit = new Set(), dim = new Set(), noise = new Set(), rings = new Set();

  // Day frame. The 11 surplus cells light only when the heart is whole.
  const whole = level >= DAY_CELLS;
  FRAME.forEach(([x, y], i) => {
    const p = (y + frameOff) * canvas + (x + frameOff);
    ((whole || i < level) ? lit : dim).add(p);
  });
  // One outline ring per completed year, outermost first.
  for (let k = 0; k < years; k++) {
    const a = k, b = canvas - 1 - k;
    for (let t = a; t <= b; t++) {
      rings.add(a * canvas + t); rings.add(b * canvas + t);
      rings.add(t * canvas + a); rings.add(t * canvas + b);
    }
  }
  // Code modules, split so the heart separates from the uncontrolled noise.
  const heart = new Set();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!modules[j * size + i]) continue;
      const p = (codeOff + j) * canvas + (codeOff + i);
      (want[j * size + i] ? heart : noise).add(p);
    }
  }

  const groups = [];
  if (dim.size) groups.push([ghost, dim]);
  if (noise.size) groups.push([NOISE, noise]);
  const frameColour = gold ?? colour;
  const framed = new Set([...lit, ...rings]);
  if (framed.size) groups.push([frameColour, framed]);
  if (heart.size) groups.push([colour, heart]);

  const body = groups.map(([c, s]) => `<path fill="${c}" d="${pathFor(s, canvas)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" shape-rendering="crispEdges"><rect width="${canvas}" height="${canvas}" fill="${field}"/>${body}</svg>`;
}
