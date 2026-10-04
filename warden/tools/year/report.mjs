// The run's one page: both logs turned into what an operator actually asks --
// where each agent ended up, which paths the year proved live, and every finding.
//
// It reads the logs and nothing else. No chain, no mirror, no network: a report
// that went and asked again could disagree with the run it is reporting on.
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { LADDER } from "../../src/mcp/ladder.mjs";
import { checkerPaths, describeFinding, markBitsOf } from "./checker.mjs";
import { loadState, readJsonl, yearPaths } from "./runner.mjs";
import { finisherMark, FINISH_LEVEL } from "./tally.mjs";
import { AGENTS } from "./scenario.mjs";

/// Said on the page rather than left to be assumed: a fade is the renderer's ink
/// ladder applied to a run that fell, not a field any read of a token returns,
/// so the checker cannot assert one and this run does not claim to have.
export const FADE_NOTE =
  "A full fade is not observable from token state and is therefore not checked here: " +
  "the fade is the renderer's ink ladder applied to a run that fell, not a stored field. " +
  "What the logs do prove is the lapse that causes it, and the rendered sheets cover the ink.";

/// Ids 1-10 are asked for; 11-15 are given by a finishing place, best read in
/// the order they are earned.
const REQUESTABLE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const FINISHER_IDS_BY_PLACE = [15, 14, 13, 12, 11];

/// Nothing from a log reaches the page as markup. Both quote forms go too: a
/// reason is interpolated into attributes nowhere today, and that is not a
/// property to leave resting on the current shape of the markup.
export function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What the run proved about one requestable Mark.
 *
 * PROVEN LIVE MEANS THE BIT IS ON CHAIN, not that the Warden accepted the order.
 * An `applied-queued` outcome is a row in the mirror's queue: the Clock still has
 * to write it, and a Mark that was ordered and never written is exactly the
 * failure this run exists to catch. `marksSeen` is the set of Mark ids read off
 * the chain in a passing checker row.
 *
 * `demand-only` is the price read and asserted with nothing paid, which is what
 * the budget forced on the dearest four.
 */
export function markStatus(runnerLines, id, marksSeen = new Set()) {
  if (marksSeen.has(id)) return "proven live";
  const asked = runnerLines.filter((line) => line.action === "mark" && line.markId === id);
  if (asked.some((line) => line.outcome === "applied-queued")) return "ordered, not seen on chain";
  if (asked.some((line) => line.outcome === "demand-only")) return "demand-only";
  return "not reached";
}

const ordinal = (n) => {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

const seen = (lines, predicate) => (lines.some(predicate) ? "proven live" : "not reached");

/// The paths the runner drives directly, each proven by a line of its own.
const RUN_PATHS = [
  ["A mint through the real door", (l) => l.action === "mint" && l.ok],
  ["A check-in credited", (l) => l.action === "checkin" && l.ok],
  ["A check-in refused", (l) => l.action === "checkin" && l.ok === false],
  ["Rest: the owner seals a token", (l) => l.action === "rest" && l.ok],
  ["A token transferred to another wallet", (l) => l.action === "transfer" && l.ok],
  ["A token rebound to a new key", (l) => l.action === "rebind" && l.ok],
  ["A child seeded", (l) => l.action === "seed" && l.ok],
];

/// The paths only a read can prove, which is what the checker's milestones are.
const MILESTONE_PATHS = [
  ["streak-3", "A three-day run"],
  ["streak-7", "A seven-day run"],
  ["streak-30", "A thirty-day run"],
  ["streak-100", "A hundred-day run"],
  ["first-lapse", "A run broken"],
  ["rested", "Frozen art after a rest"],
  ["finished", "A year completed at 365"],
  ["echo", "A child's echo ring"],
  ["heartbeat", "The Clock's heartbeat on a silent day"],
];

/**
 * Every agent the run was designed with, plus anything state.json holds a token
 * for, in the order the table was designed in and the child last.
 *
 * The UNION, not state.json's keys: an agent whose mint never landed has no
 * token id, and reading its row off state.json alone would have dropped it from
 * the page -- the one agent whose absence most needs explaining.
 */
function agentOrder(state) {
  const scripted = [...AGENTS.map((a) => a.name), CHILD];
  const names = [...new Set([...AGENTS.map((a) => a.name), ...Object.keys(state?.tokens ?? {})])];
  return names.sort((a, b) => {
    const rank = (n) => (scripted.indexOf(n) === -1 ? scripted.length : scripted.indexOf(n));
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

const CHILD = "child";
const NONE = "--";

const stateLines = (checkerLines) => checkerLines.filter((l) => l.ok !== undefined && l.tokenId !== null && l.tokenId !== undefined);

/// A pass that died before it read anything: no token, and a FAIL that belongs in
/// the total. Left out, a run whose every pass crashed read "FAILs: 0".
const passLines = (checkerLines) =>
  checkerLines.filter((l) => l.ok === false && (l.tokenId === null || l.tokenId === undefined));

function agentRow(agent, tokenId, checkerLines) {
  if (!Number.isInteger(tokenId)) {
    return { agent, tokenId: NONE, fails: 0, heart: "never minted", streak: NONE, place: NONE, marks: NONE };
  }
  const mine = stateLines(checkerLines).filter((l) => l.tokenId === tokenId);
  const last = mine[mine.length - 1] ?? null;
  const fails = mine.filter((l) => l.ok === false).length;
  const place = last?.place ?? 0;
  const held = markBitsOf(last?.marks ?? 0).filter((id) => id <= 10).map((id) => LADDER[id].name);
  return {
    agent, tokenId, fails,
    // A token queued in this fast day is not on chain yet, and the level the
    // chain answers for it is zero rather than a level it has lost.
    heart: last ? (last.pending ? "not on chain yet" : `${last.level}/${FINISH_LEVEL}`) : NONE,
    streak: last?.streak ?? NONE,
    place: place ? `${ordinal(place)} (${LADDER[finisherMark(place)].name})` : NONE,
    marks: held.length ? held.join(", ") : NONE,
  };
}

const td = (text, cls = null) => `<td${cls ? ` class="${cls}"` : ""}>${esc(text)}</td>`;

function table(headings, rows) {
  const head = `<tr>${headings.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  return `<table>\n${head}\n${rows.join("\n")}\n</table>`;
}

/**
 * The whole page, as one self-contained string.
 *
 * `runnerLines` and `checkerLines` are the two JSONL logs parsed; `state` is
 * state.json, which is the only place the agent behind a token id is recorded.
 */
export function renderReport(runnerLines, checkerLines, state) {
  const rows = stateLines(checkerLines);
  const milestones = checkerLines.filter((l) => l.milestone);
  // Both kinds of FAIL: a token that differed, and a pass that never got far
  // enough to read one. Sorted together, with a dayless pass line last.
  const fails = [...rows.filter((l) => l.ok === false), ...passLines(checkerLines)]
    .sort((a, b) => (a.chainDay ?? Infinity) - (b.chainDay ?? Infinity));
  const decoded = milestones.filter((l) => l.decoded === true).length;
  const failedDecodes = milestones.filter((l) => l.decoded === false).length;
  const lastDay = rows.reduce((max, l) => Math.max(max, l.chainDay ?? 0), 0);
  const fastDays = state?.startDay && lastDay ? lastDay - state.startDay : null;
  // Only from a row that PASSED. A place read in a failing row is the value the
  // finding is about, so calling the band proven from it would report the bug as
  // the proof.
  // A HOLD is not a pass either: its chain values are the stale ones.
  const passing = rows.filter((l) => l.ok && !l.hold);
  const holds = rows.filter((l) => l.hold).length;
  const placesSeen = new Set(passing.map((l) => l.place).filter((p) => p > 0));
  const marksSeen = new Set(passing.flatMap((l) => markBitsOf(l.marks ?? 0)));

  const summary = table(["Fast days covered", "Tokens", "Checker FAILs", "Gas-stop HOLDs", "Milestones", "QR decodes"], [
    `<tr>${td(fastDays === null ? NONE : fastDays)}${td(Object.keys(state?.tokens ?? {}).length)}` +
      `${td(fails.length, fails.length ? "fail" : null)}${td(holds)}${td(milestones.length)}` +
      `${td(`${decoded} decoded, ${failedDecodes} failed`, failedDecodes ? "fail" : null)}</tr>`,
  ]);

  const agents = table(["Agent", "Token", "Heart", "Streak", "Place", "Marks held", "FAILs"], agentOrder(state).map((agent) => {
    // A run stopped before state.json was ever written still gets a page: it is
    // how the operator finds out what happened.
    const row = agentRow(agent, state?.tokens?.[agent], checkerLines);
    return `<tr><th>${esc(agent)}</th>${td(row.tokenId)}${td(row.heart)}${td(row.streak)}` +
      `${td(row.place)}${td(row.marks)}${td(row.fails, row.fails ? "fail" : null)}</tr>`;
  }));

  const marks = table(["Mark", "Route", "Gate", "This run"], REQUESTABLE_IDS.map((id) => {
    const m = LADDER[id];
    const gate = m.route === "earned" ? `run ${m.minStreak}` : [m.price, m.minLevel ? `level ${m.minLevel}` : null].filter(Boolean).join(", ");
    const status = markStatus(runnerLines, id, marksSeen);
    return `<tr><th>${esc(m.name)}</th>${td(m.route)}${td(gate)}${td(status, status === "proven live" ? null : "thin")}</tr>`;
  }));

  const finishers = table(["Mark", "Places", "This run"], FINISHER_IDS_BY_PLACE.map((id) => {
    const m = LADDER[id];
    const live = [...placesSeen].some((p) => finisherMark(p) === id);
    return `<tr><th>${esc(m.name)}</th>${td(m.places)}${td(live ? "proven live" : "not reached", live ? null : "thin")}</tr>`;
  }));

  const paths = table(["Path", "This run"], [
    ...RUN_PATHS.map(([name, predicate]) => {
      const status = seen(runnerLines, predicate);
      return `<tr><th>${esc(name)}</th>${td(status, status === "proven live" ? null : "thin")}</tr>`;
    }),
    ...MILESTONE_PATHS.map(([key, name]) => {
      const status = seen(milestones, (l) => l.milestone === key);
      return `<tr><th>${esc(name)}</th>${td(status, status === "proven live" ? null : "thin")}</tr>`;
    }),
  ]);

  const milestoneTable = milestones.length
    ? table(["Day", "Agent", "Token", "Milestone", "QR decode"], milestones.map((l) =>
        `<tr>${td(l.chainDay ?? NONE)}${td(l.agent ?? NONE)}${td(l.tokenId ?? NONE)}${td(l.milestone)}` +
        `${td(l.decoded === null || l.decoded === undefined ? "not run" : l.decoded ? `decoded (exit ${l.exit})` : `FAILED (exit ${l.exit})`, l.decoded === false ? "fail" : null)}</tr>`))
    : "<p class=\"thin\">No milestone has been reached yet.</p>";

  const findingTable = fails.length
    ? table(["Day", "Agent", "Token", "Findings"], fails.map((l) =>
        `<tr>${td(l.chainDay ?? NONE)}${td(l.agent ?? NONE)}${td(l.tokenId ?? NONE)}` +
        `${td((l.findings ?? []).map(describeFinding).join("; "))}</tr>`))
    : "<p>No token has ever differed from what the rules say it should be.</p>";

  const refused = new Map();
  for (const line of runnerLines) {
    if (line.ok !== false || !line.action) continue;
    const key = `${line.action}|${line.reason ?? "no reason given"}`;
    refused.set(key, (refused.get(key) ?? 0) + 1);
  }
  const refusals = refused.size
    ? table(["Action", "Reason", "Times"], [...refused.entries()].map(([key, count]) => {
        const [action, reason] = key.split("|");
        return `<tr>${td(action)}${td(reason)}${td(count)}</tr>`;
      }))
    : "<p>The runner was never refused.</p>";

  return `<!doctype html>
<meta charset="utf-8">
<title>The accelerated year</title>
<style>
 :root{color-scheme:light dark;--bg:#faf9f8;--fg:#221d1f;--thin:#6b6167;--line:#e3dedf;--bad:#a8232b;--badbg:#fdf0f0}
 @media (prefers-color-scheme: dark){:root{--bg:#191617;--fg:#ece7e8;--thin:#a1969b;--line:#3a3436;--bad:#ff8b8b;--badbg:#2c1e20}}
 body{font:14px/1.55 system-ui,sans-serif;margin:32px;background:var(--bg);color:var(--fg)}
 h1{font-size:21px;margin:0 0 6px}
 h2{font-size:16px;margin:32px 0 8px}
 p{max-width:82ch}
 p.lede{color:var(--thin);margin:0 0 8px}
 table{border-collapse:collapse;margin:4px 0 8px}
 th,td{padding:5px 12px 5px 0;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
 th{font-weight:600}
 td.thin,p.thin{color:var(--thin)}
 td.fail{color:var(--bad);background:var(--badbg);font-weight:600}
 code{font:12px ui-monospace,monospace}
</style>
<h1>The accelerated year</h1>
<p class="lede">Twelve scripted agents and one child, one fast day at a time, on
Base Sepolia. Everything below is read from the runner's log and the checker's
log: one line per token per pass, compared against a tally built from the
check-ins the door accepted.</p>
${summary}
<h2>The agents</h2>
${agents}
<h2>The Marks asked for</h2>
${marks}
<h2>Finishing places</h2>
<p class="thin">Chamber and Aorta need 15 and 65 finishers, which eleven agents
cannot reach. They stay covered by the contract tests and the rendered sheets.</p>
${finishers}
<h2>The paths</h2>
${paths}
<p class="thin">${esc(FADE_NOTE)}</p>
<h2>Milestones</h2>
${milestoneTable}
<h2>Findings</h2>
${findingTable}
<h2>Refusals</h2>
${refusals}
`;
}

export function main() {
  const paths = yearPaths();
  const mine = checkerPaths(paths);
  const html = renderReport(readJsonl(paths.runnerLog), readJsonl(mine.log), loadState(paths.state));
  mkdirSync(mine.dir, { recursive: true });
  writeFileSync(mine.report, html);
  console.log(`wrote ${mine.report}`);
  return mine.report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
