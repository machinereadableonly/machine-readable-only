// Generates contracts/test/CombinationFixture.sol: every one of the 459
// renderable Mark combinations, with the byte length and keccak256 of the
// tokenURI the JS reference produces for each.
//
// WHY. combination-sweep.mjs renders all 459 and DECODES them -- it answers
// "does the QR still scan wearing this?" and never compares the two renderers.
// The cross-language differential (RenderFixture) covers 15 Mark-bearing states
// out of 189 legal sets, so combinations including Hush + Break, Aura + Break
// and the bought Iris under Break had no differential case at all. Two
// renderers can each be self-consistent and disagree with each other; that is
// the entire reason a differential exists, and the Mark surface was the thinnest
// part of it.
//
// This is the whole set rather than a sample. Rendering a tokenURI is string
// work with no rasterising -- the expensive part of the decode sweep is resvg,
// which this never touches -- so the full 459 costs a few seconds here and a
// few seconds in Solidity. A sample would have needed a rule for what to leave
// out, and the honest rule turned out to be "nothing".
//
//   node tools/combination-fixture.mjs [tokenId] [domain]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { keccak256, toBytes } from "viem";

import { tokenBitmap, SIZE } from "./token-bitmap.mjs";
import { heartMaskBytes } from "./heart-mask.mjs";
import { unpackModules } from "./qart.mjs";
import { tokenUri } from "./render-token.mjs";
import { generateCombinations, packCombination } from "./mark-combinations.mjs";

/// The state every combination is rendered at, held constant so the ONLY
/// variable is the Mark set. Whole, at the top tier, one ring: the state in
/// which the most Marks are legal and the most surface is drawn.
///
/// `irisRun` matters whenever the EARNED Iris is held -- it stores the run it
/// was granted on, which the renderer reads for that eye's ink. Fixed at 400
/// so the earned and bought routes are distinguishable in the output.
const STATE = { level: 365, streak: 400, lastDay: 1000, today: 1000, irisRun: 400 };

/// The same set again, on a SEEDED CHILD, for the sets that can hide an echo bug.
///
/// WHY THIS IS A SAMPLE WHEN THE MAIN PASS IS NOT. The comment at the top of
/// this file says a sample would need a rule for what to leave out and that the
/// honest rule was "nothing". That still holds for the MARK axis. This second
/// pass is a different axis with a different rule, and the rule is stateable:
/// ONE CASE PER ECHO-SENSITIVE DRAWING SITE.
///
/// The echo ring is ink in the ghost fill, and two of the six `_blockOff` call
/// sites are Mark-gated -- `_eyes` returns early without an Iris, `_quiet`
/// returns "" without Hush -- so those are the places a Mark and the ring can
/// collide. Renderer.t.sol already renders a child in the maximal legal set,
/// which covers every gated site AT ONCE; what it cannot show is a bug in one
/// site alone, or two that cancel. These isolate each site instead.
///
/// Rendering all 459 a second time was measured and rejected: the Solidity half
/// already costs 6.07s and 866M gas, which is most of the contracts suite, and
/// doubling it buys repetition of an interaction the sites above already pin.
const ECHO_STATE = { ...STATE, echo: 365, parent: 7, generation: 1 };

/// Chosen by drawing site, not by taste:
///   none                     the control -- the ring with no Mark near it
///   hush                     `_quiet`, the site gated on Hush
///   ache                     the deepening ghost, the ring's own fill
///   iris-bought(target)      `_eyes`, once per shape, since each draws its own
///   iris-bought(squircle)      geometry into the code's corners
///   iris-bought(leaf)
///   iris-earned              the earned route, whose ink comes from its own run
///   vessel                   the whole-heart repaint, the largest erase
///   iris-earned+aura         the tinted page the ring is drawn onto. Aura
///                            cannot stand alone -- Ladder.sol's `requiresAny`
///                            makes it wait on an Iris -- so this is the
///                            SHORTEST legal set that reaches the Aura field.
///   hush+static+iris-bought(target)+vessel+tint(violet)
///                            the maximal legal set, kept as the union case
const ECHO_LABELS = [
  "none",
  "hush",
  "ache",
  "iris-bought(target)",
  "iris-bought(squircle)",
  "iris-bought(leaf)",
  "iris-earned",
  "vessel",
  "iris-earned+aura",
  "hush+static+iris-bought(target)+vessel+tint(violet)",
];

export function fixtures(domain, tokenId) {
  const bitmap = tokenBitmap(domain, tokenId);
  const modules = unpackModules(Buffer.from(bitmap.hex, "hex"), SIZE);
  const want = unpackModules(heartMaskBytes(), SIZE);
  const { combos } = generateCombinations();

  const render1 = (c, state, label) => {
    const uri = tokenUri(modules, want, SIZE, {
      tokenId,
      mintDay: 900,
      ...state,
      marks: c.ids,
      irisVariant: c.irisVariant,
      tintVariant: c.tintVariant,
    });
    return {
      ...c,
      label,
      echo: state.echo ?? 0,
      parent: state.parent ?? 0,
      generation: state.generation ?? 0,
      marksBits: packCombination(c, state.irisRun),
      bytes: uri.length,
      hash: keccak256(toBytes(uri)),
    };
  };

  const founding = combos.map(c => render1(c, STATE, c.label));

  // ASSERTED, NOT ASSUMED. A label typo here would silently drop a drawing site
  // from the echo pass, and the fixture would regenerate smaller with nothing
  // to say so -- the same failure the COUNT assertion in Solidity exists to
  // catch, one layer earlier.
  const children = ECHO_LABELS.map(label => {
    const c = combos.find(x => x.label === label);
    if (!c) throw new Error(`ECHO_LABELS names a combination that does not exist: ${label}`);
    return render1(c, ECHO_STATE, `child: ${label}`);
  });

  return [...founding, ...children];
}

export function render(all, domain, tokenId) {
  const lines = all.map(r =>
    `        c[i++] = Case(${r.marksBits}, ${r.echo ?? 0}, ${r.parent ?? 0}, `
    + `${r.generation ?? 0}, ${r.bytes}, ${r.hash}, "${r.label}");`
  ).join("\n");

  return `// SPDX-License-Identifier: MIT
// GENERATED by tools/combination-fixture.mjs -- do not edit by hand.
// Regenerate with: node tools/combination-fixture.mjs ${tokenId} ${domain}
pragma solidity ^0.8.30;

/// @notice All ${all.length} renderable Mark combinations, with the byte length and
/// keccak256 of the tokenURI tools/render-token.mjs produces for each.
/// Token ${tokenId} on ${domain}.
///
/// @dev The Mark half of the cross-language differential. RenderFixture covers
/// 15 Mark-bearing states; the decode sweep covers all 459 but never compares
/// the two renderers. This closes that: every legal set, every Iris shape and
/// every Tint ink, diffed byte for byte.
///
/// The first ${all.length - ECHO_LABELS.length} are rendered at the SAME state -- level ${STATE.level},
/// streak ${STATE.streak}, lastDay ${STATE.lastDay}, today ${STATE.today}, irisRun ${STATE.irisRun} -- so a
/// failure is about the Marks and nothing else.
///
/// The last ${ECHO_LABELS.length}, labelled "child: ...", repeat one Mark set per
/// echo-sensitive drawing site on a SEEDED CHILD (echo ${ECHO_STATE.echo}), so a Mark
/// that collides with the dashed ring fails here rather than in nothing at all.
library CombinationFixture {
    struct Case {
        uint256 marks;
        uint32 echo;
        uint256 parent;
        uint32 generation;
        uint256 bytesLen;
        bytes32 hash;
        string label;
    }

    uint256 internal constant COUNT = ${all.length};

    function cases() internal pure returns (Case[] memory c) {
        c = new Case[](COUNT);
        uint256 i;
${lines}
    }
}
`;
}

const tokenId = Number(process.argv[2] ?? 1);
const domain = process.argv[3] ?? "example.com";
const here = dirname(fileURLToPath(import.meta.url));
const all = fixtures(domain, tokenId);
const out = join(here, "..", "contracts", "test", "CombinationFixture.sol");
writeFileSync(out, render(all, domain, tokenId));
console.log(
  `${all.length} combinations, ${Math.min(...all.map(a => a.bytes))}-${Math.max(...all.map(a => a.bytes))} bytes`
);
console.log(`wrote ${out}`);
