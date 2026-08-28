// Prints the constants FrameRenderer.t.sol asserts against: the exact ghost and
// frame path data tools/render-token.mjs draws for a given life stage.
//
// The Solidity test embeds these rather than reading a file, for the same reason
// CodeRenderer.t.sol does: tools/out is gitignored and a test that read from
// there would fail on a clean clone. Re-run and paste back if the frame order,
// the ring rule or the path format ever changes.
//
//   node tools/frame-path-fixture.mjs <level> <years>
import { frameCells, BLOCK, THICK, LOCAL, DAY_CELLS } from "./frame-geometry.mjs";
import { pathFor, canvasFor, ringsFor, GAP } from "./render-token.mjs";

const FRAME = frameCells();

/** The two frame paths for one life stage, exactly as renderSvg would draw them. */
export function framePaths(level, rawYears) {
  const years = ringsFor(rawYears);
  const canvas = canvasFor(years);
  const frameOff = years + GAP;

  const lit = new Set(), dim = new Set(), rings = new Set();
  const whole = level >= DAY_CELLS;
  FRAME.forEach(([x, y], i) => {
    const p = (y + frameOff) * canvas + (x + frameOff);
    ((whole || i < level) ? lit : dim).add(p);
  });
  for (let k = 0; k < years; k++) {
    const a = k, b = canvas - 1 - k;
    for (let t = a; t <= b; t++) {
      rings.add(a * canvas + t); rings.add(b * canvas + t);
      rings.add(t * canvas + a); rings.add(t * canvas + b);
    }
  }
  const framed = new Set([...lit, ...rings]);
  return {
    canvas, years, whole,
    litCells: lit.size, dimCells: dim.size,
    ghostD: dim.size ? pathFor(dim, canvas) : "",
    frameD: framed.size ? pathFor(framed, canvas) : "",
  };
}

if (process.argv[1] && process.argv[1].endsWith("frame-path-fixture.mjs")) {
  const level = Number(process.argv[2] ?? 0);
  const years = Number(process.argv[3] ?? 0);
  const f = framePaths(level, years);
  const wrap = s => s.length === 0 ? '        ""'
    : s.match(/.{1,90}/g).map(l => `        "${l}"`).join("\n");
  console.log(`// level ${level}, years ${years} -> canvas ${f.canvas}, whole ${f.whole}`);
  console.log(`// lit ${f.litCells}, ghost ${f.dimCells}, ghostD ${f.ghostD.length} B, frameD ${f.frameD.length} B`);
  console.log(`\nghostD:\n${wrap(f.ghostD)};`);
  console.log(`\nframeD:\n${wrap(f.frameD)};`);
}
