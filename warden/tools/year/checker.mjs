// The independent checker: the one part of the run that believes nothing.
//
// It reads each token from the chain and from the Warden's mirror and compares
// both against a tally it builds itself from the runner's log. Nothing here is
// asked of the service under test, so a bug the Warden and its database share
// cannot hide inside their agreement.
//
// IT CANNOT WRITE, and not by discipline: every send in the chain adapter takes
// the sending key as its first argument, and the checker is never given a key, a
// key path or a wallet. `main` hands the pass `readersOf(chain)` -- viewOf, today
// and lastWardenDay -- so the three reads are the whole of its reach. A checker
// that could write could paper over what it found.
import { mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { safeErrorText } from "../../src/clock/redact.mjs";
import { makeChain } from "./chain.mjs";
import {
  creditedDays, daySecondsFrom as daySecondsAbove, isEntry, loadState, makeLog, nextWakeMs, readJsonl, yearPaths,
  ORIGIN, SITE,
} from "./runner.mjs";
import { expected, places, FINISH_LEVEL } from "./tally.mjs";

/// How far into the fast day the pass runs. The Clock writes at +30 s and the
/// runner acts from +60 s, so by +240 s the day's writes have landed and there
/// is still room to re-read a disagreement before the boundary.
export const OFFSET_SECONDS = 240;

/// A public RPC is not read-after-write consistent, so one disagreement is not a
/// finding yet. This is how long the checker waits before believing it.
export const REREAD_PAUSE_MS = 20_000;

/// A decode that hangs must not eat the pass. It is killed and recorded failed.
export const DECODE_TIMEOUT_MS = 60_000;

/// The runs the artwork changes colour at. A crossing is a milestone.
export const STREAK_MILESTONES = [3, 7, 30, 100];

/**
 * The bits the chain and the mirror both hold: one per Mark id, 1 through 15.
 *
 * The contract packs more into the same word -- the Iris shape at bit 16, the
 * Tint ink at bit 24, the earned Iris's run at bit 32 and the finishing ordinal
 * at bit 64 -- and the mirror stores only `1 << upgradeId`. Comparing the whole
 * word would fail on every marked token. The MIRROR side is compared unmasked,
 * so a stray bit it should never hold (bit 0 is not a Mark) is still a finding.
 */
export const MARK_BITS = 0xfffen;

const MAX_MARK_ID = 15;

/// The log and the page, beside the runner's own, outside every repository.
export function checkerPaths(paths = yearPaths()) {
  return { dir: paths.dir, log: join(paths.dir, "checker.jsonl"), report: join(paths.dir, "report.html") };
}

/**
 * A Marks word from the mirror, whatever shape SQLite handed it over in.
 *
 * `null` rather than a throw for anything unusable: an unreadable field is a
 * finding, and a finding is what the caller is already collecting.
 */
export function toBig(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isInteger(value) ? BigInt(value) : null;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/// The Mark ids a word carries, for the report and for a legible finding.
export function markBitsOf(word) {
  const bits = toBig(word) ?? 0n;
  const held = [];
  for (let id = 1; id <= MAX_MARK_ID; id++) if (bits & (1n << BigInt(id))) held.push(id);
  return held;
}

/// The actions that put a token on the Clock's queue: a mint, and a seed for the
/// one child. The day the LAST of them landed is what a pending token is measured
/// against, so a mint retried on a later day is not judged from the first attempt.
const QUEUEING_ACTIONS = ["mint", "seed"];

/// Every runner action the Clock turns into a chain write. A day carrying one of
/// these cannot be a heartbeat day, whatever the reads happen to show.
const WRITING_ACTIONS = ["mint", "seed", "mark", "checkin"];

export function queuedDay(lines, tokenId) {
  const queued = lines.filter((line) => line.ok && QUEUEING_ACTIONS.includes(line.action) && line.tokenId === tokenId);
  return queued.length ? queued[queued.length - 1].chainDay : null;
}

/// The three reads, and nothing else. Passing this rather than the adapter is
/// what makes the checker's read-only claim structural instead of a promise.
export const readersOf = (chain) => ({
  viewOf: chain.viewOf, today: chain.today, lastWardenDay: chain.lastWardenDay,
});

export const tokensOf = (state) =>
  Object.entries(state?.tokens ?? {})
    .filter(([, id]) => Number.isInteger(id))
    .map(([agent, tokenId]) => ({ agent, tokenId }));

/**
 * Every way this token differs from what the rules say it should be.
 *
 * `tally` is what the CHAIN should hold: the days credited before today, because
 * the Clock writes a day at the start of the next one. `mirrorTally` is what the
 * MIRROR should hold: the same days plus any the Warden has accepted today. The
 * mirror standing a day ahead is the ordinary state of every token -- the Warden
 * credits a day when it accepts it -- and is not a finding.
 *
 * `place` is what `places()` says this token's finishing place and Mark are, or
 * null for a token whose year is not over.
 *
 * `queued` is the day the runner recorded queueing this token's creation, from
 * `queuedDay()`. It is the ONLY independent witness to the mint day: both tallies
 * are SEEDED with the chain's own `mintDay`, so a mint written on the wrong day
 * shifts every expected value with it and cancels out of every other comparison.
 *
 * `prevChain` is the PREVIOUS pass's chain view, or null on a first read. The
 * mirror's marks, resting, generation, parent and finishing place are not credited
 * at the door like a check-in is: they are written by the Clock's RECONCILE, which
 * trails the head by twelve confirmations. So each of those five is allowed to
 * hold either what the chain says now or what it said last pass -- a lag of one
 * Clock run is the designed behaviour, and one that survives into the next pass is
 * a finding.
 */
export function compare({ chain, mirror, tally, mirrorTally = tally, place = null, queued = null, prevChain = null }) {
  const findings = [];
  const fail = (field, fields) => findings.push({ field, ...fields, severity: "FAIL" });
  /// True when the mirror holds neither this pass's value nor the last one's.
  const reconciled = (held, now, before) => held === now || (prevChain !== null && held === before);

  // The contract writes `mintDay = day` for both creation paths (mint and seed)
  // and the Clock passes the day the agent paid, which is the day the runner
  // recorded. They are the same number or one of the two is wrong.
  if (queued !== null && chain.mintDay !== queued) fail("mintDay", { chain: chain.mintDay, expected: queued });

  for (const field of ["level", "streak", "lastDay"]) {
    if (chain[field] !== tally[field]) fail(field, { chain: chain[field], expected: tally[field] });
  }
  // A FLOOR only: TokenView exposes no bestRun, just the run that most recently
  // fell, so it may read BELOW the longest run ever held -- never above it.
  if (chain.runFloor > tally.bestRun) fail("runFloor", { chain: chain.runFloor, expected: `<= ${tally.bestRun}` });

  const wanted = place?.place ?? 0;
  if (chain.finisherPlace !== wanted) fail("place", { chain: chain.finisherPlace, expected: wanted });
  if (place && !(chain.marks & (1n << BigInt(place.markId)))) {
    fail("finisherMark", { chain: markBitsOf(chain.marks).join(","), expected: place.markId });
  }

  // A string is the reason the read FAILED, where null is the Warden answering
  // 404 for a token the chain has. Neither can be compared field by field.
  if (!mirror || typeof mirror === "string") {
    fail("mirror", { mirror: mirror || null, expected: "a token view" });
    return findings;
  }
  for (const field of ["level", "streak", "lastDay"]) {
    if (mirror[field] !== mirrorTally[field]) fail(field, { mirror: mirror[field], expected: mirrorTally[field] });
  }
  const mirrorMarks = toBig(mirror.marks);
  if (mirrorMarks === null || !reconciled(mirrorMarks, chain.marks & MARK_BITS, (prevChain?.marks ?? 0n) & MARK_BITS)) {
    fail("marks", { chain: String(chain.marks & MARK_BITS), mirror: String(mirror.marks) });
  }
  if (!reconciled(mirror.resting, chain.resting, prevChain?.resting)) {
    fail("resting", { chain: chain.resting, mirror: mirror.resting });
  }
  if (!reconciled(mirror.generation, chain.generation, prevChain?.generation)) {
    fail("generation", { chain: chain.generation, mirror: mirror.generation });
  }
  // The mirror holds null for a founding token where the chain holds zero.
  if (!reconciled(mirror.parentId ?? 0, chain.parent, prevChain?.parent)) {
    fail("parent", { chain: chain.parent, mirror: mirror.parentId });
  }
  // Still against the place places() worked out, not against the chain's: the
  // previous pass's read is only what the lag is measured from.
  const mirrorPlace = mirror.finisher?.place ?? 0;
  if (!reconciled(mirrorPlace, wanted, prevChain?.finisherPlace)) {
    fail("place", { mirror: mirrorPlace, expected: wanted });
  }

  return findings;
}

/**
 * What this token did between two reads that is worth rendering and decoding.
 *
 * A milestone is a CROSSING, so a first read reports nothing: a checker restart
 * would otherwise re-fire every rung a token has ever passed and pay for a
 * decode of each. The one exception is a child, which is read for the first time
 * already carrying its echo -- there is no earlier view for it to cross from.
 *
 * A full fade is deliberately absent. It is the renderer's ink ladder applied to
 * a run that fell, not a stored field, so no read of a token can show it.
 */
export function milestones(prev, view) {
  if (!prev) return view.generation > 0 ? ["echo"] : [];
  const hit = [];
  for (const rung of STREAK_MILESTONES) {
    if (prev.streak < rung && view.streak >= rung) hit.push(`streak-${rung}`);
  }
  if (view.streak < prev.streak) hit.push("first-lapse");
  if (prev.level < FINISH_LEVEL && view.level >= FINISH_LEVEL) hit.push("finished");
  if (!prev.resting && view.resting) hit.push("rested");
  return hit;
}

/**
 * The heartbeat: `lastWardenDay` advancing when nothing else was written.
 *
 * Without it the 365-day absence clock would measure the AGENTS' silence rather
 * than the operator's, so seeing it land is one of the things this run exists
 * for. Nothing is claimed on the first pass, which has no earlier day to compare.
 */
export function heartbeatMilestone({ prevWardenDay, wardenDay, lastDaysMoved, wroteAnything }) {
  if (prevWardenDay === null || prevWardenDay === undefined) return null;
  if (wardenDay <= prevWardenDay) return null;
  return lastDaysMoved || wroteAnything ? null : "heartbeat";
}

/**
 * The fast day, validated: the runner's own check, with the CHECKER's floor.
 *
 * A day no longer than the offset is refused. The pass wakes at +240 s, so a
 * 240-second day would have it waking at or past the boundary -- reading the day
 * after the one it means to check, every time, and silently.
 */
export const daySecondsFrom = (env) => daySecondsAbove(env, OFFSET_SECONDS);

/// The repository's own tools directory, found from this file rather than
/// configured: the two move together or the decode is checking another tree.
export const toolsDir = () => fileURLToPath(new URL("../../../tools/", import.meta.url)).replace(/\/$/, "");

/**
 * The decode command for one token.
 *
 * The verifier is run as a CHILD PROCESS on purpose: it lives in another package
 * and pulls in the rasteriser and the ZXing decoder, neither of which belongs in
 * the Warden's dependency tree. Its PNG path is relative, so it runs from the
 * tools directory. The domain comes from the run's own site, so a bitmap solved
 * against another one fails rather than passing quietly.
 */
export function decodeArgs({ toolsDir: dir, contract, id, rpcUrl, site = SITE }) {
  return {
    command: "node",
    args: [join(dir, "verify-tokenuri.mjs"), contract, String(id), rpcUrl, new URL(site).host],
    cwd: dir,
  };
}

/// One decode at a time: rasterising in parallel is what takes this box down.
export function makeDecoder({ contract, rpcUrl, dir = toolsDir(), site = SITE, spawnImpl = spawn }) {
  return async ({ tokenId }) => {
    const { command, args, cwd } = decodeArgs({ toolsDir: dir, contract, id: tokenId, rpcUrl, site });
    // The verifier writes out/token-<id>.png by a RELATIVE path and does not make
    // the directory. `tools/out/` is gitignored, so the git-archive export this run
    // works from has no such directory -- and every decode failed on ENOENT, after
    // the render and the scan had already succeeded.
    try {
      mkdirSync(join(dir, "out"), { recursive: true });
    } catch (err) {
      // A directory that cannot be made is one failed decode, not a dead pass: a
      // throw here would end the whole pass and every token still to be read.
      return { decoded: false, exit: null, said: safeErrorText(err) };
    }
    return new Promise((resolve) => {
      let said = "";
      const child = spawnImpl(command, args, { cwd, timeout: DECODE_TIMEOUT_MS });
      child.stdout?.on("data", (chunk) => { said += chunk; });
      child.stderr?.on("data", (chunk) => { said += chunk; });
      // A verifier that could not even start is a failed decode, not a crash.
      child.on("error", (err) => resolve({ decoded: false, exit: null, said: safeErrorText(err) }));
      child.on("close", (exit) => resolve({ decoded: exit === 0, exit, said: said.trim().slice(0, 400) }));
    });
  };
}

/// The Warden's own answer for a token. A 404 is null, which compare() calls a
/// finding; any other refusal is a read failure and is reported as one.
export function mirrorReader({ origin = ORIGIN, fetchImpl = fetch } = {}) {
  return async (id) => {
    const res = await fetchImpl(`${origin}/t/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`the Warden answered ${res.status} for /t/${id}`);
    return res.json();
  };
}

export function emptyMemory() {
  return { wardenDay: null, tokens: new Map() };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One pass: every token read, compared, and its milestones decoded.
 *
 * `memory` carries the previous pass's views and warden day, so a milestone is a
 * crossing rather than a state. It is mutated, which is what makes a milestone
 * fire once across a run rather than once per pass.
 */
export async function runPass({
  chain, readMirror, state, readLog, log, memory,
  readClockLog = () => [],
  decode = async () => ({ decoded: null, exit: null }),
  sleep = defaultSleep,
}) {
  const today = await chain.today();
  const wardenDay = await chain.lastWardenDay();
  const lines = readLog();
  const stoppedRuns = gasStoppedRuns(readClockLog());
  const readOne = (tokenId) => readToken({ chain, readMirror, tokenId, lines, today });

  // Read everything first: the places a finish earns depend on every token's
  // tally, so no single token can be judged before all of them are in.
  const reads = [];
  for (const { agent, tokenId } of tokensOf(state)) reads.push({ agent, ...(await readOne(tokenId)) });

  // The previous pass's view of each token, which is what the mirror's
  // reconcile-only fields are allowed to still be holding. Read before the loop
  // below writes this pass's views over it.
  const previous = (tokenId) => memory.tokens.get(tokenId)?.view ?? null;
  let judged = judge(reads, previous, { stoppedRuns, today });
  // ONE pause for the whole pass, not one per token. A public RPC is not
  // read-after-write consistent, so a disagreement is re-read before it is
  // believed -- but twelve tokens disagreeing at 20 s each would spend four
  // minutes inside a fast day that is five long. The divergent set waits once,
  // together, and is then re-read as a set.
  if (judged.some((j) => j.findings.length)) {
    await sleep(REREAD_PAUSE_MS);
    const again = [];
    for (const j of judged) {
      again.push(j.findings.length ? { agent: j.read.agent, ...(await readOne(j.read.tokenId)) } : j.read);
    }
    judged = judge(again, previous, { stoppedRuns, today });
  }

  let lastDaysMoved = false;
  for (const { read: settled, findings } of judged) {
    const { agent, tokenId } = settled;
    const prev = memory.tokens.get(tokenId) ?? null;
    if (prev && settled.chain && prev.view.lastDay !== settled.chain.lastDay) lastDaysMoved = true;

    const failed = findings.filter((f) => f.severity === "FAIL");
    const held = findings.length > 0 && failed.length === 0;
    log({
      chainDay: today, agent, tokenId, ok: failed.length === 0,
      ...(settled.pending ? { pending: true } : {}),
      ...(held ? { hold: true } : {}),
      level: settled.chain?.level ?? null,
      streak: settled.chain?.streak ?? null,
      place: settled.chain?.finisherPlace ?? null,
      marks: settled.chain ? String(settled.chain.marks & MARK_BITS) : null,
      findings,
    });
    if (findings.length) {
      const verdict = held ? "HOLD (the Clock is gas-stopped)" : "FAIL";
      console.error(`CHECKER ${verdict}: ${agent} token ${tokenId} on day ${today} -- ${findings.map(describeFinding).join("; ")}`);
    }

    if (!settled.chain || !settled.onChain) continue;
    const fired = prev?.fired ?? new Set();
    for (const milestone of milestones(prev?.view ?? null, settled.chain)) {
      if (fired.has(milestone)) continue;
      fired.add(milestone);
      const { decoded, exit, said } = await decode({ tokenId, agent, milestone });
      log({ chainDay: today, agent, tokenId, milestone, decoded, exit });
      if (decoded === false) {
        console.error(`CHECKER DECODE FAILED: ${agent} token ${tokenId} at ${milestone} (exit ${exit}) ${said ?? ""}`.trim());
      }
    }
    memory.tokens.set(tokenId, { view: settled.chain, fired });
  }

  // The Clock's run at +30 s today drains what was queued yesterday, so a write
  // of either day's work means today's advance was not a heartbeat.
  //
  // A CREDITED CHECK-IN COUNTS, which is the point of asking the runner's log
  // rather than trusting `lastDaysMoved`: that only sees a token this pass read
  // AND read before, so a batchCheckIn for a token the checker has no earlier
  // view of would have left the day looking silent.
  const wroteAnything = lines.some(
    (line) => line.ok && WRITING_ACTIONS.includes(line.action) && (line.chainDay === today || line.chainDay === today - 1)
  );
  const beat = heartbeatMilestone({ prevWardenDay: memory.wardenDay, wardenDay, lastDaysMoved, wroteAnything });
  if (beat) log({ chainDay: today, agent: null, tokenId: null, milestone: beat, decoded: null, exit: null });
  memory.wardenDay = wardenDay;
  return memory;
}

/**
 * One token's two readings and the tallies they are judged against.
 *
 * A mirror that refuses comes back as the REASON rather than as a throw: the
 * chain's side of this token is still worth comparing, and the reason belongs in
 * the finding.
 */
async function readToken({ chain, readMirror, tokenId, lines, today }) {
  try {
    const view = await chain.viewOf(tokenId);
    const days = creditedDays(lines, tokenId, view.mintDay);
    const chainDays = days.filter((d) => d < today);
    let mirror = null;
    try {
      mirror = await readMirror(tokenId);
    } catch (err) {
      mirror = safeErrorText(err);
    }
    // ONE day of slack, not two. The Clock's run at +30 s of the day after a mint
    // writes it, so a token still missing at this pass on that day is late, and a
    // mint that never lands must not stay invisible behind a generous window.
    const queued = queuedDay(lines, tokenId);
    const onChain = view.level > 0;
    return {
      tokenId, chain: view, mirror, onChain, queued,
      pending: !onChain && queued !== null && today - queued <= 1,
      tally: expected(chainDays),
      mirrorTally: expected(days.filter((d) => d <= today)),
      finishDay: onChain ? (chainDays[FINISH_LEVEL - 1] ?? null) : null,
    };
  } catch (err) {
    return { tokenId, chain: null, mirror: null, tally: null, mirrorTally: null, finishDay: null, error: safeErrorText(err) };
  }
}

/// A chain that would not answer is itself the finding: nothing about this token
/// can be judged, and silence must not read as agreement.
function findingsFor(read, place, prevChain = null, { stoppedRuns = 0, today = null } = {}) {
  if (!read.chain) return [{ field: "read", chain: read.error, expected: "a token view", severity: "FAIL" }];
  // Nothing to compare: the chain has not been given this token yet, and it is
  // not due to have been.
  if (read.pending) return [];
  if (!read.onChain) {
    return [{
      field: "onChain", chain: "no such token",
      expected: `written by the Clock; queued on day ${read.queued ?? "never"}`,
      // Pending already covers one run; each gas-stopped run holds one more.
      severity: stoppedRuns > 0 && read.queued !== null && today - read.queued <= 1 + stoppedRuns ? "HOLD" : "FAIL",
    }];
  }
  const findings = compare({
    chain: read.chain, mirror: read.mirror, tally: read.tally, mirrorTally: read.mirrorTally,
    place, queued: read.queued, prevChain,
  });
  const lag = read.tally.lastDay - read.chain.lastDay;
  return lag > 0 && lag <= stoppedRuns ? holdLag(findings) : findings;
}

/// The chain-side fields a gas stop holds back. The mint day, every mirror field
/// and runFloor (an upper bound a lagging chain cannot breach) still FAIL.
const LAG_FIELDS = ["level", "streak", "lastDay", "place", "finisherMark"];

/// A token whose chain trails its credited days by no more than the gas-stopped
/// runs: its chain-side findings are the designed wait, not a fault.
function holdLag(findings) {
  return findings.map((f) =>
    f.chain !== undefined && f.mirror === undefined && LAG_FIELDS.includes(f.field) ? { ...f, severity: "HOLD" } : f
  );
}

/// How many of the Clock's most recent runs, in a row, its gas guard stopped.
function gasStoppedRuns(clockLines) {
  let n = 0;
  for (let i = clockLines.length - 1; i >= 0 && clockLines[i]?.gasStopped === true; i--) n++;
  return n;
}

/**
 * The whole pass judged at once.
 *
 * The places have to be worked out over every token together -- a finishing place
 * is a token's position among all of them -- so they are recomputed here rather
 * than carried, which keeps a re-read from being judged against the old order.
 */
function judge(reads, previous = () => null, hold = {}) {
  const finishes = reads
    .filter((r) => r.tally?.level >= FINISH_LEVEL)
    .map((r) => ({ tokenId: r.tokenId, day: r.finishDay }));
  const placeOf = places(finishes);
  return reads.map((read) => ({
    read,
    findings: findingsFor(read, placeOf.get(read.tokenId) ?? null, previous(read.tokenId), hold),
  }));
}

/// How a finding reads, on stderr and on the report's page alike: one definition,
/// so the line an operator sees at 3 a.m. matches the one in the morning's page.
export const describeFinding = (f) =>
  `${f.field}: ${[
    f.chain === undefined ? null : `chain ${f.chain}`,
    f.mirror === undefined ? null : `mirror ${f.mirror}`,
    f.expected === undefined ? null : `expected ${f.expected}`,
  ].filter(Boolean).join(", ")}`;

function readAddressFile(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return "";
  }
}

export async function main({ env = process.env } = {}) {
  const paths = yearPaths();
  const mine = checkerPaths(paths);
  const log = makeLog(mine.log);
  const contract = readAddressFile(paths.contract);
  if (!contract) throw new Error(`no contract address at ${paths.contract}: run setup.sh first`);
  // Validated BEFORE the first pass: a pass aligned to the wrong day length
  // would read the chain at the moment the Clock is writing it.
  const daySeconds = daySecondsFrom(env);
  const rpcUrl = env.BASE_RPC_URL ?? "https://sepolia.base.org";

  const chain = makeChain({ rpcUrl, contract });
  const readMirror = mirrorReader();
  const decode = makeDecoder({ contract, rpcUrl });
  const memory = emptyMemory();

  for (;;) {
    // A pass that dies takes one fast day with it, not the run -- and the log
    // says so, because a missing pass is otherwise indistinguishable from a
    // quiet one.
    try {
      await runPass({
        chain: readersOf(chain), readMirror, state: loadState(paths.state),
        readLog: () => readJsonl(paths.runnerLog), readClockLog: () => readJsonl(paths.clockLog), log, memory, decode,
      });
    } catch (err) {
      log({ chainDay: null, agent: null, tokenId: null, ok: false, findings: [{ field: "pass", chain: safeErrorText(err), severity: "FAIL" }] });
      console.error(`CHECKER PASS FAILED: ${safeErrorText(err)}`);
    }
    await defaultSleep(nextWakeMs(Date.now(), daySeconds, OFFSET_SECONDS) - Date.now());
  }
}

if (isEntry(import.meta.url)) {
  main().catch((err) => {
    console.error("checker:", safeErrorText(err));
    process.exitCode = 1;
  });
}
