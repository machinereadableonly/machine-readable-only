// The selection criterion that decides which of the eight masks a token ships.
//
// Until 2026-08-29 that was "highest heart match", and on two of twelve tokens
// measured it picked a code that failed to decode at about a fifth of raster
// sizes. Both times the culprit was mask 4, winning on match by roughly a point.
// These tests pin the fix: the gate must reject the fragile candidate, and the
// tokens it was found on must ship something that scans.
import test from "node:test";
import assert from "node:assert/strict";
import { solve, payloadFor, unpackModules } from "../qart.mjs";
import { heartMaskBytes } from "../heart-mask.mjs";
import { renderSvg, ACHE, HUSH, BEAT, AURA, VESSEL } from "../render-token.mjs";
import { scanResult } from "./helpers/decode.mjs";
import { tokenBitmap, SIZE } from "../token-bitmap.mjs";
import { gateSolve, GATE_SIZES, gateStates } from "../robust-solve.mjs";

const DOMAIN = "example.com";
const want = () => unpackModules(heartMaskBytes(), SIZE);

// The two failures the cross sweep found, with the state each failed in and the
// raster sizes it failed at. Measured, not chosen.
const KNOWN_FRAGILE = [
  { id: 55, badMask: 4, state: { level: 365,  streak: 400, marks: [] },
    sizes: [350, 500, 1000, 1150, 1300, 1550], label: "whole, 1 year" },
  { id: 12, badMask: 4, state: { level: 3650, streak: 30,
      marks: [ACHE, HUSH, BEAT, AURA, VESSEL] },
    sizes: [700], label: "whole, 10 years" },
];

test("the gate rejects the fragile candidate it was built to catch", () => {
  // The gate is only worth its runtime if it actually fails the code that got
  // through before. Asserting the OUTCOME (token 55 ships mask 1) would pass
  // just as well if the gate did nothing and the tie-break happened to move --
  // this asserts the mechanism.
  const { id, badMask } = KNOWN_FRAGILE[0];
  const fragile = solve(payloadFor(DOMAIN, id), badMask);
  const verdict = gateSolve(fragile, `https://${DOMAIN}/t/${id}`, want());
  assert.equal(verdict.ok, false,
    `mask ${badMask} on token ${id} decoded everywhere; it is measured not to`);
  assert.ok(verdict.failures.length > 0);
});

test("a token that was fragile now ships a code that scans where it used to fail", () => {
  for (const { id, badMask, state, sizes, label } of KNOWN_FRAGILE) {
    const r = tokenBitmap(DOMAIN, id);
    assert.notEqual(r.mask, badMask,
      `token ${id} still ships mask ${badMask}, the one measured to fail`);
    assert.ok(r.rejected > 0, `token ${id} should have had a better-matching mask rejected`);

    const modules = unpackModules(Uint8Array.from(Buffer.from(r.hex, "hex")), SIZE);
    const years = Math.floor(state.level / 365);
    const svg = renderSvg(modules, want(), SIZE,
      { ...state, lastDay: 1000, today: 1000, years });

    for (const px of sizes) {
      const got = scanResult(svg, px);
      assert.ok(got.ok, `token ${id} ${label} at ${px}px: ${got.why}`);
      assert.equal(got.destination, `https://${DOMAIN}/t/${id}`,
        `token ${id} ${label} at ${px}px went to the wrong destination`);
    }
  }
});

test("the gate covers the sizes and states the failures were found at", () => {
  // A gate that no longer looks where the bugs were is not a gate. Both lists
  // may grow; neither may lose a value that once caught something.
  for (const px of [350, 500, 700, 1000, 1080, 1150, 1300, 1550]) {
    assert.ok(GATE_SIZES.includes(px), `GATE_SIZES lost ${px}px, which caught a real failure`);
  }
  const labels = gateStates().map(s => s.label);
  for (const l of ["whole, 1 year", "whole, 10 years"]) {
    assert.ok(labels.includes(l), `gateStates lost "${l}", where a real failure lived`);
  }
});
