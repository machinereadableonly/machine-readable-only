// Every Mark set the ladder's own masks allow, and every renderable variant of
// each. ONE definition, imported by both the decode sweep (combination-sweep.mjs)
// and the cross-language fixture (combination-fixture.mjs).
//
// Extracted from combination-sweep.mjs on 2026-09-06 so a second consumer
// could reach it. That file is a script -- importing it runs a sweep -- and a
// second hand-written copy of these masks is exactly the drift this project
// keeps a single state-matrix.mjs to avoid.
import { MARKS, IRIS_SHAPE_NAMES, IRIS_BOUGHT, IRIS_EARNED, TINT } from "./render-token.mjs";

/// Mirror of contracts/src/Ladder.sol: for each Mark id, the bit of its
/// excluded partner, and (pair 5 only) the bits of what it requires ANY of.
/// Bit n means Mark id n, matching Ladder.sol's own `uint16(1 << id)`.
export const EXCLUDES = {
  1: 1 << 2, 2: 1 << 1,   // Hush / Ache
  3: 1 << 4, 4: 1 << 3,   // Static / Beat
  5: 1 << 6, 6: 1 << 5,   // Iris bought / Iris earned
  7: 1 << 8, 8: 1 << 7,   // Vessel / Break
  9: 1 << 10, 10: 1 << 9, // Tint / Aura
};

export const AN_IRIS = (1 << 5) | (1 << 6);
export const REQUIRES_ANY = { 9: AN_IRIS, 10: AN_IRIS };

/** Is this bitmask (bit n = Mark id n held) a set Ladder.sol's masks allow? */
export function isLegalSet(mask) {
  for (let id = 1; id <= 10; id++) {
    if (!(mask & (1 << id))) continue;
    if (EXCLUDES[id] && (mask & EXCLUDES[id])) return false;
    const req = REQUIRES_ANY[id] ?? 0;
    if (req && !(mask & req)) return false;
  }
  return true;
}

export function idsOf(mask) {
  const ids = [];
  for (let id = 1; id <= 10; id++) if (mask & (1 << id)) ids.push(id);
  return ids;
}

export function labelFor(ids, irisVariant, tintVariant) {
  if (!ids.length) return "none";
  return ids.map(id => {
    if (id === IRIS_BOUGHT) return `iris-bought(${IRIS_SHAPE_NAMES[irisVariant]})`;
    if (id === IRIS_EARNED) return "iris-earned";
    if (id === TINT) return `tint(${tintVariant === 1 ? "gold" : "violet"})`;
    return MARKS[id - 1];
  }).join("+");
}

/**
 * Every reachable Mark set, expanded into every renderable variant: the three
 * Iris shapes when the BOUGHT Iris is held (the earned route is always shape 0,
 * "target" -- MarkRenderer.irisShape), and the two Tint inks when Tint is held.
 *
 * The two counts are asserted on every call. It is pure combinatorics and
 * costs nothing, so a drifted mask table fails loudly at whichever entrypoint
 * reached it first.
 */
export function generateCombinations() {
  const legalSets = [];
  for (let mask = 0; mask < (1 << 11); mask++) {
    if (mask & 1) continue;          // bit 0 is never a Mark
    if (isLegalSet(mask)) legalSets.push(mask);
  }
  if (legalSets.length !== 189) {
    throw new Error(
      `generated ${legalSets.length} reachable Mark sets from the masks, expected `
      + `189 -- the mask table above has drifted from contracts/src/Ladder.sol`
    );
  }

  const combos = [];
  for (const mask of legalSets) {
    const ids = idsOf(mask);
    const irisVariants = ids.includes(IRIS_BOUGHT) ? [0, 1, 2] : [0];
    const tintVariants = ids.includes(TINT) ? [0, 1] : [0];
    for (const irisVariant of irisVariants) {
      for (const tintVariant of tintVariants) {
        combos.push({ ids, irisVariant, tintVariant, label: labelFor(ids, irisVariant, tintVariant) });
      }
    }
  }
  if (combos.length !== 459) {
    throw new Error(
      `generated ${combos.length} renderable combinations, expected 459 -- `
      + `the variant expansion above has drifted`
    );
  }
  return { legalSets, combos };
}

/**
 * The `_marks` word the chain would hold for one combination: the Mark bits,
 * the Iris shape at bit 16, the Tint ink at bit 24 and the earned Iris's run at
 * bit 32. MUST mirror the layout `applyMark` writes -- the same packing
 * render-fixture.mjs does, restated here because that module packs a
 * state-matrix case rather than a combination.
 *
 * `irisRun` IS PART OF THE WORD AND NOT PART OF THE STATE, which is the whole
 * trap: the JS renderer takes it as a separate state field, while Solidity
 * reads it back out of `marks >> 32` (MarkRenderer.irisRun). Omit it here and
 * the two languages render an "Iris Run" attribute of 400 and 0 respectively --
 * a two-byte difference, found exactly this way while writing the fixture.
 * Only meaningful when the EARNED Iris is held; the bought route has no run.
 */
export function packCombination({ ids, irisVariant, tintVariant }, irisRun = 0) {
  let bits = ids.reduce((acc, id) => acc | (1n << BigInt(id)), 0n);
  if (irisVariant) bits |= BigInt(irisVariant) << 16n;
  if (tintVariant) bits |= BigInt(tintVariant) << 24n;
  if (irisRun && ids.includes(IRIS_EARNED)) bits |= BigInt(irisRun) << 32n;
  return bits;
}
