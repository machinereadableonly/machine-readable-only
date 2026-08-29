// The single definition of which states matter, imported by every sweep so
// they cannot drift apart.
//
// The full cross-product of streak, lapse, rings, heart fill, Marks and
// lifecycle is roughly 800,000 states. Testing it is neither possible nor
// useful. What follows covers every axis independently at its boundaries, plus
// the handful of places where two axes actually interact.
import { MAX_RINGS, MARKS } from "./render-token.mjs";
import { DAY_CELLS } from "./frame-geometry.mjs";

/// Streak values one step either side of every tier threshold (3, 7, 30, 100).
export const STREAKS = [0, 1, 2, 3, 6, 7, 29, 30, 99, 100, 400];

/// Days since the last check-in, either side of every lapse step (3, 7, 30).
export const GAPS = [0, 2, 3, 6, 7, 29, 30, 60];

/// Completed years. 11 is past the cap of 10 and must render as 10.
export const RING_YEARS = [0, 1, 2, 5, 9, 10, 11];

/// Heart fills that change the frame's shape rather than just its length.
/// 12 is the art-direction case: a stalled heart must still look finished.
/// 364 is the measured gas worst case; 365 seals the frame.
export const FILLS = [1, 12, 200, 364, 365];

/// The five Marks that draw, each alone, then none and all.
export const DRAWING_MARKS = ["vein", "voice", "bloom", "halo", "crown"];

/// Every colour boundary against every lapse boundary. 88 pairs.
export function colourCases() {
  const out = [];
  for (const streak of STREAKS) {
    for (const gap of GAPS) {
      out.push({ streak, gap, lastDay: 1000, today: 1000 + gap });
    }
  }
  return out;
}

/// The states worth rendering in full and diffing between the two renderers.
export function renderCases() {
  const out = [];
  const base = { lastDay: 1000, today: 1000, level: 365, streak: 400 };

  // One per tier, live, then the same tier fully lapsed.
  for (const streak of [0, 3, 7, 30, 100]) {
    out.push({ label: `tier streak ${streak}`, ...base, streak });
    out.push({ label: `tier streak ${streak}, 30 days lapsed`, ...base, streak, today: 1030 });
  }

  // Ring counts, including one past the cap.
  for (const y of RING_YEARS) {
    out.push({ label: `${y} years`, ...base, level: Math.max(1, y * DAY_CELLS) });
  }

  // Heart fills.
  for (const level of FILLS) {
    out.push({ label: `fill ${level}`, ...base, level });
  }

  // Marks: none, each drawing one alone, all five, all seven.
  out.push({ label: "no marks", ...base, marks: [] });
  for (const m of DRAWING_MARKS) {
    out.push({ label: `mark ${m}`, ...base, marks: [m] });
  }
  out.push({ label: "all drawing marks", ...base, marks: DRAWING_MARKS });
  out.push({ label: "all seven marks", ...base, marks: MARKS });

  // Frozen lifecycles. Both must hold their colour against a far-future clock.
  out.push({ label: "resting", ...base, today: 9999, resting: true });
  out.push({ label: "sunset", ...base, today: 9999, sunset: true });

  return out;
}

/// The decode sweep: every ink against every ring count, bare and fully marked.
export function decodeCases() {
  const out = [];
  for (const streak of [0, 3, 7, 30, 100]) {
    for (const y of [0, 1, 5, 10]) {
      for (const marks of [[], DRAWING_MARKS]) {
        out.push({
          label: `streak ${streak}, ${y}y, ${marks.length ? "marked" : "bare"}`,
          streak, level: Math.max(1, y * DAY_CELLS), marks,
          lastDay: 1000, today: 1000,
        });
      }
    }
  }
  return out;
}

/// The extremes worth decoding at several raster sizes rather than one.
export const DECODE_SIZES = [250, 350, 500, 700, 900];
export function decodeExtremes() {
  return decodeCases().filter(c =>
    (c.streak === 0 || c.streak === 100) &&
    (c.level === 1 || c.level === MAX_RINGS * DAY_CELLS));
}

/// The subset driven through the live contract on Sepolia.
export function soakCases() {
  return renderCases().filter(c => !c.label.startsWith("mark "));
}
