// Choosing a token's code by whether it SCANS, not only by how much it looks
// like a heart.
//
// WHY THIS EXISTS. Until 2026-08-29 the shipped bitmap was `bestOfAllMasks` --
// the highest heart match of the eight. Measured that day across twelve tokens,
// five states and the raster sizes a third party actually picks: two of the
// twelve carried a code that failed to decode at a fifth of raster sizes, and in
// BOTH cases the selector had actively chosen the fragile one, because fidelity
// and fragility happened to point the same way (mask 4, winning on match by
// about a point). Match rate carries no signal about robustness -- the four
// tokens measured sat within 1.2 points of each other while decoding anywhere
// from 25/31 to 31/31 of raster sizes.
//
// The fix is a change of selection criterion, nothing more: take the highest
// match among the masks that survive the gate below. Measured cost on the two
// affected tokens was 0.9 and 1.5 points of heart match; unaffected tokens are
// unchanged, because their best-matching mask already passes.
//
// This runs OFF CHAIN -- the bitmap is solved here and passed into mint() as
// hex -- so it costs no gas and changes no contract. It is also permanent per
// token: a fragile code, once minted, is carried for the life of the piece.
// That asymmetry is why the gate is deliberately stricter than it needs to be.
import { allMaskSolves, payloadFor, unpackModules } from "./qart.mjs";
import { heartMaskBytes } from "./heart-mask.mjs";
import { renderSvg, canvasFor } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

/// The raster sizes a candidate must clear. The four a third party picks
/// (256 is Alchemy's thumbnail, 1080 is OpenSea's display size), plus sizes that
/// caught every known failure: 350, 500, 700, 1000, 1150, 1300, 1550. Each case
/// is additionally checked at its own exact multiple of the canvas, which is
/// added per state because the canvas grows with year rings.
export const GATE_SIZES = [256, 350, 500, 700, 1000, 1080, 1150, 1300, 1550];

/// The states a candidate is rendered in before it is judged.
///
/// State matters and it is not obvious that it should. Token 55 decoded fine at
/// day one, mid-life and day 364 and failed only when whole at one year; token
/// 12 failed only when whole at ten years. The drawn frame, ghost cells and
/// rings surround the code and change what the binarizer's blocks resolve
/// against, so a code is only as good as the images it actually appears in.
export function gateStates() {
  const base = { lastDay: 1000, today: 1000 };
  const marks = ["vein", "voice", "bloom", "halo", "crown"];
  return [
    { label: "day one",         ...base, level: 1,    streak: 0,   marks: [] },
    { label: "mid, marked",     ...base, level: 200,  streak: 45,  marks: ["vein", "bloom"] },
    { label: "day 364 worst",   ...base, level: 364,  streak: 100, marks },
    { label: "whole, 1 year",   ...base, level: 365,  streak: 400, marks: [] },
    { label: "whole, 10 years", ...base, level: 3650, streak: 30,  marks },
  ];
}

const want = () => unpackModules(heartMaskBytes(), 37);

/// Does this solve decode to `expected` in every gate state at every gate size?
/// Returns { ok, checked, failures } rather than a bare boolean, so a caller can
/// report WHICH size and state rejected a candidate instead of just that one did.
export function gateSolve(solve, expected, target = want()) {
  const failures = [];
  let checked = 0;

  for (const state of gateStates()) {
    const years = Math.floor(state.level / 365);
    const svg = renderSvg(solve.modules, target, solve.size, { ...state, years });
    // The exact multiple is a control: a candidate that fails even there is a
    // broken code, not a sampling artefact, and that distinction is worth
    // keeping in the failure list.
    const sizes = [...GATE_SIZES, canvasFor(years) * 16];

    for (const px of sizes) {
      checked++;
      const scan = scanResult(svg, px);
      if (!(scan.ok && scan.destination === expected)) {
        failures.push({ state: state.label, px, why: scan.ok ? `wrong destination ${scan.destination}` : scan.why });
      }
    }
  }

  return { ok: failures.length === 0, checked, failures };
}

/// The shipped selection: the best-matching solve that survives the gate.
///
/// Masks are tried in match order and the first survivor wins, so a healthy
/// token pays for exactly one gate run. `onProgress` is called per candidate so
/// a CLI can show the walk; it is otherwise silent.
///
/// Throws if no mask survives. That is the right behaviour and not a nuisance:
/// a token with no scannable code must not be mintable, and it has not happened
/// on any payload measured so far.
export function robustSolve(payload, { onProgress } = {}) {
  const expected = payload.endsWith("#") ? payload.slice(0, -1) : payload;
  const target = want();
  const tried = [];

  for (const candidate of allMaskSolves(payload)) {
    const verdict = gateSolve(candidate, expected, target);
    tried.push({ mask: candidate.mask, match: candidate.match, ...verdict });
    onProgress?.(tried[tried.length - 1]);
    if (verdict.ok) return { ...candidate, gate: { tried, rejected: tried.length - 1 } };
  }

  throw new Error(
    `no mask produced a scannable code for ${payload}; tried ` +
    tried.map(t => `${t.mask} (${t.failures.length} failures)`).join(", ")
  );
}

/// Convenience for callers that have a domain and an id rather than a payload.
export const robustSolveFor = (domain, tokenId, opts) =>
  robustSolve(payloadFor(domain, tokenId), opts);
