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
///
/// THE LARGE SIZES ARE THE POINT, not padding. The palette bug sweep C found on
/// 2026-08-29 did not appear until 1200px on a bare token, and the diagnosis
/// that pinned it went to 1600px by hand -- but this list stopped at 900, so the
/// standing sweep could not have seen the bug come back. Every size from 1100 up
/// was added on 2026-08-29 to close that. Do not trim them for speed; batch the
/// run instead.
export const DECODE_SIZES = [250, 350, 500, 700, 900, 1100, 1200, 1400, 1600];
export function decodeExtremes() {
  return decodeCases().filter(c =>
    (c.streak === 0 || c.streak === 100) &&
    (c.level === 1 || c.level === MAX_RINGS * DAY_CELLS));
}

/// The subset driven through the live contract on Sepolia.
export function soakCases() {
  return renderCases().filter(c => !c.label.startsWith("mark "));
}

// ---------------------------------------------------------------------------
// The cross sweep: state AGAINST bitmap, at sizes we do not choose.
//
// Every earlier decode sweep held one of the two variables still. The offline
// sweep rendered every state with token 1's bitmap; the Sepolia sweep gave each
// of 26 bitmaps a single state. Each token carries its own QArt solve, so the
// module layout differs per token -- which is exactly how token 12 got to a live
// chain before anyone saw it fail -- and a sweep that holds the code constant
// cannot see a per-token fragility at all.
// ---------------------------------------------------------------------------

/// Raster sizes a third party actually picks, none of them ours.
/// 256 is Alchemy's NFT API thumbnail. 500 and 1000 are ordinary CDN widths.
/// 1080 is the size OpenSea displays an item at. None is an integer multiple of
/// any canvas this piece can produce, which is the whole point of testing them.
export const THIRD_PARTY_SIZES = [256, 500, 1000, 1080];

/// Twelve token ids, so twelve independent QArt solves. Spread rather than
/// 1..12 so id length varies too -- a four-digit id is a different payload and
/// therefore a different solve.
export const CROSS_TOKEN_IDS = [1, 2, 3, 5, 8, 12, 13, 21, 34, 55, 89, 144];

/// Five states spanning the frame shapes and the ink ladder. Deliberately small:
/// the point of this sweep is breadth across BITMAPS, and the state axis is
/// already covered to its boundaries by sweeps A, B and C.
export function crossStates() {
  const base = { lastDay: 1000, today: 1000 };
  return [
    { label: "day one",        ...base, level: 1,    streak: 0,   marks: [] },
    { label: "mid, marked",    ...base, level: 200,  streak: 45,  marks: ["vein", "bloom"] },
    { label: "day 364 worst",  ...base, level: 364,  streak: 100, marks: DRAWING_MARKS },
    { label: "whole, 1 year",  ...base, level: 365,  streak: 400, marks: [] },
    { label: "whole, 10 years",...base, level: 3650, streak: 30,  marks: DRAWING_MARKS },
  ];
}

/// Every bitmap against every state. 12 x 5 = 60 pairs, each decoded at the
/// four third-party sizes plus its own exact multiple as a control.
export function crossCases() {
  const out = [];
  for (const id of CROSS_TOKEN_IDS) {
    for (const s of crossStates()) {
      out.push({ ...s, id, label: `token ${id}, ${s.label}` });
    }
  }
  return out;
}
