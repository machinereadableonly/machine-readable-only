// Writes sample tokens to tools/out/ so a design change can be eyeballed quickly.
//   npm run preview            -- token 1 through its life
//   npm run preview -- 42 7    -- token ids 42 and 7, whole, one year
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { bestOfAllMasks, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg } from "./render-token.mjs";

const DOMAIN = process.env.MRO_DOMAIN ?? "example.com";
const ids = process.argv.slice(2).map(Number).filter(Boolean);
const STATES = [
  { level: 12, streak: 2, years: 0, tag: "day12" },
  { level: 90, streak: 9, years: 0, tag: "day90" },
  { level: 200, streak: 45, years: 0, tag: "day200" },
  { level: 365, streak: 140, years: 1, tag: "whole" },
  { level: 365, streak: 1, years: 1, tag: "lapsed" },
];
mkdirSync("out", { recursive: true });
for (const id of ids.length ? ids : [1]) {
  const code = bestOfAllMasks(payloadFor(DOMAIN, id));
  const target = heartTarget(code.size);
  console.log(`token ${id}: mask ${code.mask}, heart ${(code.match * 100).toFixed(1)}%`);
  for (const s of (ids.length > 1 ? [STATES[3]] : STATES)) {
    const svg = renderSvg(code.modules, target.want, code.size, s);
    writeFileSync(`out/token-${id}-${s.tag}.png`,
      new Resvg(svg, { fitTo: { mode: "width", value: 760 } }).render().asPng());
    console.log(`  ${s.tag}: ${svg.length} B svg`);
  }
}
