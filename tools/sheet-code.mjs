// The one code every visual sheet is judged on.
//
// C2.8: every Mark sheet this project has ever looked at was drawn on a bitmap
// solved against `example.com`, because ten separate tools each wrote
// `payloadFor("example.com", 1)` and `solve(PAYLOAD, 7)` at the top. The domain
// was decided on 2026-09-03 and none of them noticed, so every visual decision
// on the ladder was taken on a heart that will never mint.
//
// The fix is not ten edits, it is one place to edit. Both values here are also
// derived rather than typed: the mask comes from the SHIPPED selector, so a
// sheet can never be judged on a candidate the robustness gate would have
// thrown out -- under `example.com` token 1 shipped mask 7, and under the real
// domain it ships mask 0, which is exactly the kind of drift a hardcoded 7
// hides.
//
// Solving costs about 4.4 seconds and is memoised by robustSolve itself, so a
// sheet importing this pays it once.
import { payloadFor } from "./qart.mjs";
import { robustSolveFor } from "./robust-solve.mjs";
import { heartTarget } from "./heart-target.mjs";

/// The real domain. Not a placeholder, and not configurable: a sheet judged
/// against anything else is measuring a token nobody can mint.
export const SHEET_DOMAIN = "machinereadableonly.com";

/// The reference token every sheet draws. Token 1, because it is the one an
/// operator mints first and the one every earlier sheet used.
export const SHEET_TOKEN_ID = 1;

export const PAYLOAD = payloadFor(SHEET_DOMAIN, SHEET_TOKEN_ID);
/// The payload without its trailing `#`: what a scanner should report.
export const DEST = PAYLOAD.slice(0, -1);

export const CODE = robustSolveFor(SHEET_DOMAIN, SHEET_TOKEN_ID);
export const TARGET = heartTarget(CODE.size);
