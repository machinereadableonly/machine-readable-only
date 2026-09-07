// The single definition of which states matter, imported by every sweep so
// they cannot drift apart.
//
// The full cross-product of streak, lapse, rings, heart fill, Marks and
// lifecycle is roughly 800,000 states. Testing it is neither possible nor
// useful. What follows covers every axis independently at its boundaries, plus
// the handful of places where two axes actually interact.
import {
  MAX_RINGS, MARKS, HUSH, ACHE, STATIC, BEAT, VESSEL, BREAK, AURA,
  IRIS_BOUGHT, IRIS_EARNED, TINT,
} from "./render-token.mjs";
import { DAY_CELLS } from "./frame-geometry.mjs";

/// A Mark id's ladder name, for labels only -- never fed back into `marks`.
const nameOf = id => MARKS[id - 1];

// Old ladder name -> new Mark id, same surface. Kept only so the historical
// sweeps below keep rendering exactly the picture they always rendered; see
// tools/state-matrix.mjs's callers and the Task 4 brief's name map.
//   vein -> ache, blueblood -> static, voice -> hush, bloom -> beat,
//   halo -> aura, crown -> vessel, singularity -> break.
const OLD_SEVEN = [HUSH, ACHE, STATIC, BEAT, VESSEL, BREAK, AURA];

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

/// The five Marks that draw, each alone, then none and all. Preserved from the
/// old ladder by the same-surface map above: vein -> ache, voice -> hush,
/// bloom -> beat, halo -> aura, crown -> vessel. (Static also draws -- the
/// noise ink -- but was never in this list before the rename either.)
export const DRAWING_MARKS = [ACHE, HUSH, BEAT, AURA, VESSEL];

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

  // Marks: none, each drawing one alone, all five, all seven (the old ladder,
  // renamed and repositioned -- see OLD_SEVEN above).
  out.push({ label: "no marks", ...base, marks: [] });
  for (const m of DRAWING_MARKS) {
    out.push({ label: `mark ${nameOf(m)}`, ...base, marks: [m] });
  }
  out.push({ label: "all drawing marks", ...base, marks: DRAWING_MARKS });
  out.push({ label: "all seven marks", ...base, marks: OLD_SEVEN });

  // The eyes (Task 6). Added in Fix Round 1: neither DRAWING_MARKS nor
  // OLD_SEVEN was ever extended to wear an Iris, so both fixtures this
  // function feeds -- the cross-language byte diff and the on-chain soak --
  // were blind to the newest and riskiest drawing surface. DRAWING_MARKS and
  // OLD_SEVEN are left untouched on purpose: they are historical-continuity
  // sets whose tracked numbers are only comparable across commits because
  // they have not moved. These are new cases instead, each a LEGAL Mark set
  // (at most one per pair -- (1,2) (3,4) (5,6) (7,8) (9,10) -- and Tint/Aura
  // additionally require holding an Iris, per Ladder.sol's requiresAny).
  out.push({ label: "iris squircle", ...base, marks: [IRIS_BOUGHT], irisVariant: 1 });
  out.push({ label: "iris leaf", ...base, marks: [IRIS_BOUGHT], irisVariant: 2 });
  out.push({ label: "tint violet", ...base, marks: [IRIS_BOUGHT, TINT], tintVariant: 0 });
  out.push({ label: "tint gold", ...base, marks: [IRIS_BOUGHT, TINT], tintVariant: 1 });
  // The earned Iris does not lapse: it keeps the colour of the run it was
  // applied at. Thirty days lapsed here so the live rung (start tier) and the
  // stored run (top tier) visibly disagree -- this is the case that actually
  // exercises "does not lapse" rather than merely asserting it never moved.
  out.push({
    label: "earned iris, lapsed to the start tier",
    ...base, streak: 100, today: 1030, marks: [IRIS_EARNED], irisRun: 100,
  });
  // The specific defect this task exists to prevent: an Iris erased onto the
  // AURA field with no Hush worn. A constant erase colour (rather than the
  // actual ground) would punch a white square into this token's tinted page.
  out.push({ label: "iris on aura, no hush", ...base, marks: [IRIS_BOUGHT, AURA] });
  // Tint is legal on the earned route too, and untested until now.
  out.push({
    label: "tint on earned iris",
    ...base, streak: 100, marks: [IRIS_EARNED, TINT], tintVariant: 1, irisRun: 100,
  });

  // Break (Task 7): the rung-colour exchange. Added in the same task as the
  // renderer change, since nothing else here covers it -- DRAWING_MARKS and
  // OLD_SEVEN are historical-continuity sets and stay untouched on purpose.
  // Break composes with either side of pair 2 (Static XOR Beat, never both)
  // and either route of pair 3 (an Iris), so those are the interactions worth
  // a case each rather than Break alone.
  out.push({ label: "break alone", ...base, marks: [BREAK] });
  out.push({ label: "break with static", ...base, marks: [BREAK, STATIC] });
  out.push({ label: "break with beat", ...base, marks: [BREAK, BEAT] });
  // STATIC WITHOUT BREAK, and BEAT without it. Break exchanges the pair
  // (colour, staticAt), so until these existed every cross-language case
  // wearing Static also wore Break -- "all seven marks" and "break with
  // static" both -- and the UN-exchanged assignment was asserted only within
  // one language on each side (Renderer.t.sol in Solidity,
  // render-token.test.mjs in JS). Two renderers can agree with themselves and
  // not with each other; that is the whole reason this matrix exists.
  //
  // Beat needs no case of its own: DRAWING_MARKS already renders it alone, as
  // "mark beat". Static was the one missing, because it was never added to
  // that historical-continuity set.
  out.push({ label: "mark static", ...base, marks: [STATIC] });
  // The earned Iris frozen at the top tier while the live rung has lapsed to
  // the start tier -- reusing the same mismatch as "earned iris, lapsed to
  // the start tier" above, but with Break worn too, so this actually
  // exercises computing the eye's ink at ITS OWN rung (the frozen one) rather
  // than the token's live rung, which is where the two languages could most
  // easily disagree.
  out.push({
    label: "break on earned iris, lapsed to the start tier",
    ...base, streak: 100, today: 1030, marks: [BREAK, IRIS_EARNED], irisRun: 100,
  });

  // C4.10, the absence steps. The heart is at rung 0 in all three, so these
  // three states differ ONLY in the frame -- which makes them the case that
  // catches a ghost rule the two renderers disagree about. A token that never
  // returned is the shape the piece is most likely to hold in quantity.
  const never = { level: 1, streak: 1, lastDay: 1000 };
  out.push({ label: "never returned, 29 days", ...base, ...never, today: 1029 });
  out.push({ label: "never returned, 30 days", ...base, ...never, today: 1030 });
  out.push({ label: "never returned, a year", ...base, ...never, today: 1365 });
  out.push({ label: "never returned, three years", ...base, ...never, today: 2095 });
  // The unearned year gone AND Ache deepening it: the two rules meet on the
  // same cells, and Ache's own three steps are the ones nothing else covers.
  out.push({ label: "ache, never returned, a year", ...base, ...never, today: 1365, marks: [ACHE] });
  out.push({ label: "aura, never returned, a year", ...base, ...never, today: 1365, marks: [AURA] });

  // Frozen lifecycles. Both must hold their colour against a far-future clock.
  out.push({ label: "resting", ...base, today: 9999, resting: true });
  out.push({ label: "sunset", ...base, today: 9999, sunset: true });

  // A sunset that closed while this token had ALREADY lapsed. The freeze is
  // taken at the day the piece closed, so the token keeps the paled colour it
  // had earned rather than snapping back to its last live run. Without a
  // `sunsetDay` in the view this state could not be drawn at all, and every
  // abandoned token would have looked kept at the moment the record sealed.
  out.push({
    label: "sunset after this token lapsed",
    ...base, today: 9999, sunset: true, sunsetDay: 1040,
  });

  // The slip, at each boundary of the ladder it now fades down. A token on a
  // 400-day run that missed one day and came back: `streak` is the new run,
  // `fellRun`/`fellDay` are the one it lost. Capped one rung below what fell,
  // so the day of the return is not the same picture as never having slipped.
  for (const [label, day, streak] of [
    ["slipped, day of return", 1002, 1],
    ["slipped, 3 days on", 1005, 4],
    ["slipped, 7 days on", 1009, 8],
    ["slipped, 30 days on", 1032, 31],
  ]) {
    out.push({
      label, ...base, streak, lastDay: day, today: day, fellRun: 400, fellDay: 1000,
    });
  }

  // The fall outliving the new run is the whole point, but the new run must be
  // able to overtake it again. At a 100-day new run the live rung is the top
  // one and the fall is irrelevant.
  out.push({
    label: "slipped, new run overtakes the fall",
    ...base, streak: 100, lastDay: 1100, today: 1100, fellRun: 400, fellDay: 1000,
  });

  // SEEDED CHILDREN, so the echo ring is not invisible to this matrix.
  //
  // Until these existed every case here rendered a FOUNDING token, and
  // Renderer.t.sol said so in as many words: the dashed ring's only
  // cross-language coverage was three cases written by hand. The two
  // `echoRingBars` implementations could have drifted with every suite green.
  //
  // These do NOT repeat those three (a newborn, a child at the ring cap, and a
  // child in the maximal legal Mark set). They cover what those leave out.
  //
  // `parent` and `generation` travel with `echo` on purpose. All three reach
  // the metadata as attributes, so a case carrying an echo while claiming
  // generation 0 would be a token that cannot exist, and the JS reference would
  // render one thing while the Solidity view said another.
  //
  // THESE ARE EXCLUDED FROM THE SOAK by `soakCases`, and that is not an
  // oversight: see the comment there.
  const child = { parent: 7, generation: 1 };

  // THE RING-BUDGET BOUNDARY, which nothing tested. `ringBudget` spends a slot
  // on ANY non-zero echo rather than on a whole year of it, so one single
  // inherited day costs a ring. This case and "1 years" differ by exactly that
  // one day of echo, and must therefore differ in ring count.
  out.push({ label: "child, echo of one day", ...base, ...child, echo: 1 });

  // Own years AND an echo, where the slot arithmetic actually bites rather than
  // only at the cap: two years earned, nine slots left, ten drawn.
  out.push({ label: "child, two years and an echo", ...base, ...child, level: 730, echo: 1000 });

  // The ghost fill and the echo ring meet on the same cells. A child that never
  // came back is the shape a line most often ends in, and the absence steps
  // (C4.10) were written when no token could carry an echo at all.
  out.push({
    label: "child, never returned, a year",
    ...base, ...child, level: 1, streak: 1, lastDay: 1000, today: 1365, echo: 365,
  });

  // A lapse pales the heart; the echo is inherited and must not pale with it.
  out.push({ label: "child, 30 days lapsed", ...base, ...child, today: 1030, echo: 365 });

  // Both frozen lifecycles, carrying an echo. `sunset` is dropped from the soak
  // generator separately, by `!c.sunset`; `resting` is not, which is one more
  // reason the echo exclusion cannot be left to either of them.
  out.push({ label: "child, resting", ...base, ...child, today: 9999, resting: true, echo: 365 });
  out.push({ label: "child, sunset", ...base, ...child, today: 9999, sunset: true, echo: 365 });

  // A deeper line, with a wide parent id. Generation, Parent and Echo are all
  // rendered as NUMBERS into the metadata, so their digit widths are part of
  // the byte length this fixture pins -- and every other child case here is
  // generation 1, parent 7, one digit each.
  out.push({
    label: "child, deep line and a wide parent",
    ...base, parent: 4242, generation: 3, echo: 3650,
  });

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
  // THE ECHO CASES CANNOT BE SOAKED, and dropping them here is load-bearing.
  //
  // The soak drives REAL tokens on a real chain, and a child exists only by
  // `seed`, which needs a whole heart and a full agent-year. Nothing in the
  // soak can manufacture one.
  //
  // Worse than merely failing: `renderSoakStates` builds each line field by
  // field, and `SoakStates.State` has no `echo`. Left in, these would be
  // emitted as FOUNDING tokens wearing a child's label -- a fixture that
  // states something untrue rather than one that breaks.
  //
  // Filtered on `c.echo` rather than on the "child" label, because a label is
  // prose and a typo in it would silently put a child back into the soak.
  return renderCases().filter(c => !c.label.startsWith("mark ") && !c.echo);
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
    { label: "mid, marked",    ...base, level: 200,  streak: 45,  marks: [ACHE, BEAT] },
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
