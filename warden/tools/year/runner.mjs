// The runner: twelve scripted agents living one fast day at a time through the
// real door. Every judgement it makes belongs to scenario/tally/decide; what is
// here is the order of the day, the money, and the record.
//
// Every seam that touches the world is injectable, so one fast day can be run
// with no chain, no key and no network.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeErrorText } from "../../src/clock/redact.mjs";
import { makeAgent, markAmount, MINT_AMOUNT } from "./agent.mjs";
import { addressOf, makeChain } from "./chain.mjs";
import { buyOrDemand, dueMarks, MAX_ATTEMPTS, shouldRetry } from "./decide.mjs";
import { AGENTS, todayFor } from "./scenario.mjs";
import { expected } from "./tally.mjs";

/// The fast stack's own door: the SITE is what a signature covers, the origin is
/// only where the bytes go.
export const SITE = "https://fast.test";
export const ORIGIN = "http://127.0.0.1:4006";

/// The payTo the Warden accepts on Base Sepolia when no treasury is configured.
export const DEAD_TREASURY = "0x000000000000000000000000000000000000dEaD";

export const MINT_USDC = BigInt(MINT_AMOUNT);
export const RETRY_PAUSE_MS = 30_000;
export const DAY_SECONDS = 300;
export const OFFSET_SECONDS = 60;
/// How long before the fast day ends the pass stops asking. The next Clock run
/// is 30 s past the boundary, and a credit landing after it belongs to that day.
export const DEADLINE_MARGIN_SECONDS = 20;
/// The least of a fast day the FIRST pass will start on. A pass that begins near
/// a boundary can put A1-A3's mints on either side of it, and a token's mint day
/// is written once and for ever.
export const FIRST_PASS_MIN_MS = 90_000;

/// The parent of the run's one child, taken from the table rather than named.
const PARENT = AGENTS.find((a) => a.seeds).name;
const CHILD = "child";

/// A refusal no agent can work around: the piece itself is closed.
const isFatal = (reason) => reason === "paused" || reason === "sunset";

const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/// A 32-byte hex string in an error is a key, whatever the error thinks it is.
const KEY_SHAPED = /0x[0-9a-fA-F]{64}/g;
const safeReason = (err) => safeErrorText(err).replace(KEY_SHAPED, "<redacted-hex>");

export function yearPaths(dir = process.env.MRO_YEAR_DIR ?? join(homedir(), ".mro-year")) {
  return {
    dir,
    state: join(dir, "state.json"),
    runnerLog: join(dir, "runner.jsonl"),
    clockLog: join(dir, "clock.jsonl"),
    contract: join(dir, "contract.address"),
    treasury: join(dir, "treasury.address"),
    wallet: (name) => join(dir, "wallets", `${name}.key`),
    identity: (name) => join(dir, "identities", `${name}.jwk.json`),
  };
}

export function emptyState() {
  return {
    startDay: null, tokens: {}, requested: {}, ownerDone: {}, done: {},
    seeded: false, childId: null, childDay: null, rebindKey: {}, paused: null,
  };
}

/// Whether this agent's year is over: the door refused a check-in with
/// `year-complete`, or its owner sealed the token, which can never be credited
/// again. Both are one-way.
export const agentIsDone = (state, name) =>
  state.done?.[name] === true || (state.ownerDone?.[name] ?? []).includes("rest");

/// When the last of the twelve is done. The child's own check-ins stop here: while
/// anything is still being credited no day is silent, and the heartbeat -- the
/// whole point of the run's end phase -- can never fire.
export const foundingAllDone = (state) => AGENTS.every((a) => agentIsDone(state, a.name));

export function loadState(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    // Anything but a missing file is a state we must not silently start over from.
    if (err.code !== "ENOENT") throw err;
    return emptyState();
  }
  return { ...emptyState(), ...JSON.parse(text) };
}

/// Written through a temp file and a rename, so a kill mid-write cannot leave a
/// half-written run history.
export function writeState(path, state) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}

export function makeLog(path) {
  mkdirSync(dirname(path), { recursive: true });
  return (fields) => appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...fields })}\n`);
}

/// A log line that will not parse is skipped rather than ending the run.
export function readJsonl(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return [];
  }
  return text.split("\n").filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/// Three consecutive non-zero exits: nothing the agents do today can be
/// credited, so the run stops rather than spending a year of days on nothing.
export function clockFailing(lines) {
  const last = lines.slice(-3);
  return last.length === 3 && last.every((line) => line?.exit !== 0);
}

/// The next wake, always inside a later fast day than `nowMs`: a pass that ran
/// past its own boundary skips that day instead of overlapping the next one.
export function nextWakeMs(nowMs, daySeconds = DAY_SECONDS, offsetSeconds = OFFSET_SECONDS) {
  const period = daySeconds * 1000;
  const wake = Math.floor(nowMs / period) * period + offsetSeconds * 1000;
  return wake > nowMs ? wake : wake + period;
}

/// When this pass must stop asking: short of the fast day's end, so nothing is
/// still in flight when the Clock writes the day.
export function passDeadlineMs(nowMs, daySeconds = DAY_SECONDS, marginSeconds = DEADLINE_MARGIN_SECONDS) {
  const period = daySeconds * 1000;
  return Math.ceil((nowMs + 1) / period) * period - marginSeconds * 1000;
}

/**
 * Whether the fast day still has room for the run's FIRST pass.
 *
 * Every later pass wakes at a known offset into a day, but the first one runs
 * wherever the operator happened to start the stack. A pass that begins seconds
 * before a boundary mints A1 on one chain day and A3 on the next: two permanent
 * mintDay FAILs, day one lost for those tokens, and a run of 365 -- Break --
 * unreachable for the whole year. Deferring costs one fast day out of 450.
 */
export function firstPassFits(nowMs, daySeconds = DAY_SECONDS, minimumMs = FIRST_PASS_MIN_MS) {
  return passDeadlineMs(nowMs, daySeconds) - nowMs >= minimumMs;
}

/**
 * The fast day, validated: a bad value refuses to start rather than aligning a
 * process to a day length nothing else in the run is using.
 *
 * `Number("soon")` is NaN, which reaches nextWakeMs as a NaN sleep -- and
 * setTimeout(NaN) fires at once, so the whole run becomes a hot loop against the
 * door. `minimumSeconds` is the caller's own offset into the day: a day no longer
 * than that leaves the pass nothing to run in.
 */
export function daySecondsFrom(env = process.env, minimumSeconds = OFFSET_SECONDS) {
  const raw = env.MRO_DAY_SECONDS;
  if (raw === undefined) return DAY_SECONDS;
  // An empty string reaches this as 0, which the bound below refuses.
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= minimumSeconds) {
    throw new Error(
      `MRO_DAY_SECONDS must be a number of seconds greater than the ${minimumSeconds} s offset this process runs at, got ${JSON.stringify(raw)}`
    );
  }
  return seconds;
}

/**
 * The agents of the run: the twelve, plus the child once it exists.
 *
 * `identity` is the key an agent signs with and `wallet` the key it pays and
 * owns with. They are the same name until a rebind, and the child borrows both
 * from its parent: it is bound to the key that seeded it.
 */
export function agentSpecs(state) {
  const specs = AGENTS.map((a) => ({ ...a, identity: state.rebindKey?.[a.name] ?? a.name, wallet: a.name }));
  if (state.seeded && state.childDay !== null) {
    specs.push({
      // Read at the call, not here: the day the twelfth founding agent ends is the
      // day the child stops, and that can be this very pass.
      name: CHILD, mintDay: state.childDay, misses: () => foundingAllDone(state), marks: [],
      identity: PARENT, wallet: PARENT,
    });
  }
  return specs;
}

/// The chain days a token has been credited: its mint day, plus every check-in
/// the door accepted. The mirror is never asked -- that is the checker's job.
export function creditedDays(lines, tokenId, mintDay) {
  const days = new Set([mintDay]);
  for (const line of lines) {
    if (line.action === "checkin" && line.ok && line.tokenId === tokenId) days.add(line.chainDay);
  }
  return [...days].sort((a, b) => a - b);
}

/// The earliest owner action still owed. A restart that lands after the day one
/// was due still performs it, in table order, one per pass.
function nextOwner(spec, day, done) {
  return [...(spec.owner ?? [])].sort((a, b) => a.day - b.day).find((o) => o.day <= day && !done.includes(o.kind)) ?? null;
}

/// USDC still owed to mints nobody has paid for, so no Mark can spend a mint's dollar.
function mintReserve(agents, state) {
  const owing = agents.filter((s) => s.name !== CHILD && state.tokens[s.name] === undefined);
  return MINT_USDC * BigInt(owing.length);
}

/**
 * One fast day.
 *
 * `day` is the run day and `chainDay` the contract's own; both are recorded on
 * every line, because the checker's tally is in chain days and the scenario is
 * written in run days.
 *
 * Every agent is asked once before any failure is asked again: one slow door
 * must not spend the day's budget before the twelfth agent has had its turn.
 */
export async function runDay({
  day, chainDay, agents, state, chain, makeAgentFor, log, testWallet,
  keyFor, addressFor, treasury = DEAD_TREASURY,
  readLog = () => [], readClockLog = () => [], sleep = defaultSleep, save = () => {},
  now = Date.now, deadline,
}) {
  const today = chainDay ?? (await chain.today());
  const line = (agent, fallbackToken, fields) => {
    const { action, ok = false, reason = null, tokenId = fallbackToken, ...rest } = fields;
    log({ day, chainDay: today, agent, tokenId, action, ok, reason, ...rest });
  };
  const runLine = (fields) => line(null, null, fields);

  if (!state.paused && clockFailing(await readClockLog())) {
    pause(state, "clock-failing", runLine);
    return state;
  }
  if (state.paused) {
    runLine({ action: "run-paused", reason: state.paused });
    return state;
  }

  const ctx = {
    day, today, state, chain, makeAgentFor, testWallet, keyFor, addressFor, treasury, sleep, line, now,
    deadline: deadline ?? passDeadlineMs(now()),
    reserve: mintReserve(agents, state),
    logLines: memo(readLog),
  };

  const pending = [];
  for (const spec of agents) {
    const unfinished = await runAgent(spec, ctx);
    if (unfinished) pending.push(unfinished);
    save(state);
    // A pause ends the day for everyone, and whoever was still waiting on a retry
    // loses it. Unsaid, the log shows one attempt and no outcome at all.
    if (state.paused) {
      for (const item of pending) item.missed();
      return state;
    }
  }
  await retrySweep(pending, ctx, save);
  return state;
}

/// The second sweep: one round of retries per attempt, all agents together, for
/// as long as the day has room for another.
async function retrySweep(pending, ctx, save) {
  let waiting = pending;
  for (let attempt = 2; attempt <= MAX_ATTEMPTS && waiting.length; attempt++) {
    if (ctx.now() + RETRY_PAUSE_MS >= ctx.deadline) break;
    await ctx.sleep(RETRY_PAUSE_MS);
    const still = [];
    for (let i = 0; i < waiting.length; i++) {
      const item = waiting[i];
      if (ctx.now() >= ctx.deadline) {
        still.push(item);
        continue;
      }
      if (!(await item.retry(attempt))) still.push(item);
      save(ctx.state);
      // The pause ends the sweep, but every agent still waiting -- retried and
      // still failing, or not reached at all -- has lost the day and says so.
      if (ctx.state.paused) {
        for (const rest of [...still, ...waiting.slice(i + 1)]) rest.missed();
        return;
      }
    }
    waiting = still;
  }
  for (const item of waiting) item.missed();
}

/// A refusal the operator has to clear: loud in the log and loud on stderr.
function pause(state, reason, runLine) {
  state.paused = reason;
  runLine({ action: "run-paused", reason });
  console.error(`RUN PAUSED: ${reason} -- clear state.json's paused field to resume`);
}

/// Loud, but not a pause: this agent loses a day, the other eleven do not.
function loud(line, action, reason) {
  line({ action, reason });
  console.error(`RUNNER: ${action} -- ${reason}`);
}

async function runAgent(spec, ctx) {
  const { state } = ctx;
  const name = spec.name;
  const wallet = spec.wallet ?? name;
  const token = () => state.tokens[name] ?? null;
  const line = (fields) => ctx.line(name, token(), fields);

  let built = null;
  const agent = () => (built ??= ctx.makeAgentFor({ name, identity: state.rebindKey?.[name] ?? spec.identity ?? name, wallet }));
  const rebuild = () => { built = null; };

  const done = state.ownerDone[name] ?? [];
  // Read before the owner action runs: the day a token is sealed still ends in a
  // check-in, and the `resting` refusal that answers it is a path worth proving.
  const plan = todayFor(spec, ctx.day, { rested: done.includes("rest") });

  // From nextOwner, not from `plan.owner`: an action whose day passed while the
  // runner was down is still owed, and is taken one per pass in table order.
  const owner = nextOwner(spec, ctx.day, done);
  if (owner && token() !== null) {
    if (await doOwner(spec, owner, { ctx, name, wallet, token, agent, rebuild, line })) {
      (state.ownerDone[name] ??= []).push(owner.kind);
    }
    if (state.paused) return null;
  }

  // A token that never landed is minted on a later day too: a settlement can
  // fail after the authorisation was signed, and the next pass is the retry.
  let minted = false;
  if (name !== CHILD && token() === null && ctx.day >= spec.mintDay) {
    minted = await doMint({ ctx, name, wallet, agent, line });
    if (state.paused) return null;
  }

  // A token minted this pass is not on chain until the Clock writes it, so
  // nothing that reads the chain about it can run today.
  if (minted) return null;

  let unfinished = null;
  if (plan.checkin && token() !== null) {
    const args = { ctx, name, token, agent, line };
    if (!(await attemptCheckin(args, 1))) {
      unfinished = {
        retry: (attempt) => attemptCheckin(args, attempt),
        missed: () => line({ action: "checkin", reason: "missed-deadline" }),
      };
    }
    if (state.paused) return null;
  }

  if (spec.marks.length && token() !== null) {
    await doMarks(spec, { ctx, name, wallet, token, agent, line });
    if (state.paused) return unfinished;
  }
  if (spec.seeds && !state.seeded && token() !== null) {
    await doSeed({ ctx, wallet, token, agent, line });
  }
  return unfinished;
}

async function doOwner(spec, owner, { ctx, name, wallet, token, agent, rebuild, line }) {
  const id = token();
  try {
    if (owner.kind === "transfer") {
      const to = ctx.addressFor(owner.to);
      // A send whose response was lost still moved the token, so who holds it is
      // asked before a second one is sent.
      if (sameAddress(await ctx.chain.ownerOf(id), to)) {
        line({ action: "transfer", ok: true, reason: "already-held", holder: owner.to });
        return true;
      }
      await ctx.chain.transfer(ctx.keyFor(wallet), ctx.addressFor(wallet), to, id);
      line({ action: "transfer", ok: true, holder: owner.to });
      return true;
    }

    if (owner.kind === "rebind") {
      // The calldata binds the token to the key that ASKED for it, so the new
      // identity makes the request; the wallet that now holds the token sends it.
      const identity = `${name}b`;
      const holder = spec.owner?.find((o) => o.kind === "transfer")?.to ?? wallet;
      const rebinder = ctx.makeAgentFor({ name: identity, identity, wallet });
      await rebinder.register();
      const call = await rebinder.ownerCallFor("rebind", id);
      if (!call?.ok) return refusedOwnerCall(ctx, line, "rebind", call);
      await ctx.chain.ownerCall(ctx.keyFor(holder), call);
      ctx.state.rebindKey[name] = identity;
      rebuild();
      line({ action: "rebind", ok: true, holder });
      return true;
    }

    const call = await agent().ownerCallFor(owner.kind, id);
    if (!call?.ok) return refusedOwnerCall(ctx, line, owner.kind, call);
    await ctx.chain.ownerCall(ctx.keyFor(wallet), call);
    line({ action: owner.kind, ok: true });
    return true;
  } catch (err) {
    line({ action: owner.kind, reason: safeReason(err) });
    return false;
  }
}

function refusedOwnerCall(ctx, line, action, call) {
  const reason = call?.reason ?? "no-answer";
  line({ action, reason });
  if (isFatal(reason)) pause(ctx.state, reason, line);
  return false;
}

/**
 * Move USDC to `address` until it holds `need`, and no further.
 *
 * Only the shortfall travels: a Mark re-ordered after a refusal, or a mint
 * retried on a later day, must not send its price a second time. Every movement
 * is one `fund` line.
 */
async function topUp(ctx, line, address, need, extra = {}) {
  const held = await ctx.chain.usdcBalance(address);
  if (held >= need) return true;
  const short = need - held;
  if ((await ctx.chain.usdcBalance(ctx.testWallet.address)) < short) return false;
  await ctx.chain.sendUsdc(ctx.testWallet.key, address, short);
  line({ action: "fund", ok: true, amount: String(short), ...extra });
  return true;
}

/**
 * The tokens the door says are this key's own, when our record of one was lost.
 *
 * The Warden writes the row and takes the payment before it answers, so an answer
 * lost in transit leaves a token that exists on both sides of the door and in no
 * state file -- and an agent with no token id never checks in again for the rest
 * of the run. `status` with no argument answers from the VERIFIED key id, so this
 * can only ever find our own.
 */
async function ownTokens(agent) {
  const answer = await agent().status();
  return (answer?.tokens ?? []).filter((t) => Number.isInteger(t?.tokenId));
}

/// The founding token of this key: a child carries a parent, a mint does not.
async function adoptMinted({ ctx, name, agent, line, reason }) {
  try {
    const mine = (await ownTokens(agent)).find((t) => (t.parentId ?? null) === null);
    if (!mine) return false;
    ctx.state.tokens[name] = mine.tokenId;
    line({ action: "token-adopted", ok: true, reason, tokenId: mine.tokenId });
    return true;
  } catch (err) {
    line({ action: "token-adopted", reason: safeReason(err) });
    return false;
  }
}

async function doMint({ ctx, name, wallet, agent, line }) {
  const address = ctx.addressFor(wallet);
  try {
    if (!(await topUp(ctx, line, address, MINT_USDC))) {
      // Not a pause: USDC arriving later is used, and the mint falls due again
      // on every later day until it lands.
      loud(line, "mint", "mint-unfunded");
      return false;
    }
    await agent().register();
    const result = await agent().mint(address, ctx.treasury);
    const ok = result?.ok === true && Number.isInteger(result.tokenId);
    if (ok) ctx.state.tokens[name] = result.tokenId;
    line({ action: "mint", ok, reason: ok ? null : (result?.reason ?? "no-token-id"), tokenId: ok ? result.tokenId : null });
    if (isFatal(result?.reason)) pause(ctx.state, result.reason, line);
    // `already-minted` is the plainest case, but any refusal can follow a mint the
    // door completed and we never heard about.
    if (!ok && !ctx.state.paused) await adoptMinted({ ctx, name, agent, line, reason: result?.reason ?? "no-answer" });
    return ok;
  } catch (err) {
    line({ action: "mint", reason: safeReason(err) });
    await adoptMinted({ ctx, name, agent, line, reason: "no-answer" });
    return false;
  }
}

/// One attempt. True when the check-in is settled for today, either way.
async function attemptCheckin({ ctx, name, token, agent, line }, attempt) {
  let result;
  try {
    result = await agent().beat(token());
  } catch (err) {
    result = { ok: false, reason: safeReason(err) };
  }
  const ok = result?.ok === true;
  line({ action: "checkin", ok, reason: ok ? null : (result?.reason ?? "no-answer"), attempt });

  // The one refusal that is an ENDING rather than a failure: this token's year is
  // over and nothing will ever credit it again. The child's own days end when the
  // last of these arrives.
  if (result?.reason === "year-complete") (ctx.state.done ??= {})[name] = true;

  if (ok) return true;
  if (isFatal(result?.reason)) {
    pause(ctx.state, result.reason, line);
    return true;
  }
  return !shouldRetry(result, attempt);
}

async function doMarks(spec, { ctx, name, wallet, token, agent, line }) {
  const id = token();
  let view;
  try {
    view = await ctx.chain.viewOf(id);
  } catch (err) {
    line({ action: "mark", reason: safeReason(err) });
    return;
  }

  // The level is the chain's own; the run is the tally's, because the chain
  // exposes no bestRun and its runFloor reads low after a second lapse.
  //
  // Today's credit is left out: the Clock has not written it yet, so a Mark
  // ordered on it is refused by a gate reading the chain -- after the USDC for
  // it has already been sent.
  const days = creditedDays(ctx.logLines(), id, view.mintDay).filter((d) => d < ctx.today);
  const marksView = { level: view.level, bestRun: expected(days).bestRun };
  const requested = new Set(ctx.state.requested[name] ?? []);

  for (const mark of dueMarks(spec, marksView, requested, view.marks)) {
    const price = BigInt(markAmount(mark.id));
    const address = ctx.addressFor(wallet);
    try {
      let pay = false;
      if (price > 0n) {
        // The decision is about the USDC that still has to MOVE: an agent left
        // holding the price by a refused attempt is already funded.
        const held = await ctx.chain.usdcBalance(address);
        const short = price > held ? price - held : 0n;
        pay = short === 0n ||
          buyOrDemand({ price: short, balance: await ctx.chain.usdcBalance(ctx.testWallet.address), reserve: ctx.reserve }) === "buy";
        // topUp answers whether the money MOVED. The bank is read once to decide
        // and once to send, so a balance that fell between the two would otherwise
        // have the agent sign for USDC its wallet does not hold.
        if (pay && short > 0n && !(await topUp(ctx, line, address, price, { markId: mark.id }))) {
          pay = false;
          line({ action: "fund", reason: "mark-unfunded", markId: mark.id, amount: String(short) });
        }
      }
      const out = await agent().upgrade(id, mark.id, mark.variant ?? 0, { pay, expectedPayTo: ctx.treasury });
      const asked = out?.outcome === "applied-queued" || out?.outcome === "demand-only";
      // A payment that settled buys exactly one attempt: the demand is gone from
      // the second answer, so whatever it says, this Mark is never paid for again.
      const settled = out?.paid === true && !out?.demand;
      const reason = out?.result?.ok === true ? null : (out?.result?.reason ?? null);
      line({
        action: "mark", ok: asked, reason, markId: mark.id,
        outcome: out?.outcome ?? "none", price: String(price), settled,
      });

      // A refusal BEFORE any payment is left for the next pass: the run gate can
      // open a day later, and nothing was spent.
      if (asked || settled) {
        (ctx.state.requested[name] ??= []).push(mark.id);
        requested.add(mark.id);
      }
      if (isFatal(reason)) {
        pause(ctx.state, reason, line);
        return;
      }
    } catch (err) {
      line({ action: "mark", reason: safeReason(err), markId: mark.id, price: String(price) });
    }
  }
}

/// The child of this parent, among the tokens the door says are ours.
async function adoptChild({ ctx, parentId, agent, line }) {
  try {
    const child = (await ownTokens(agent)).find((t) => t.parentId === parentId);
    if (!child) return false;
    recordChild(ctx, child.tokenId);
    line({ action: "token-adopted", ok: true, reason: "seed-already-spent", tokenId: child.tokenId });
    return true;
  } catch (err) {
    line({ action: "token-adopted", reason: safeReason(err) });
    return false;
  }
}

/// The child is the run's thirteenth agent from here on, so the day is recorded
/// with it: `childDay` is what its check-ins start from.
function recordChild(ctx, childId) {
  ctx.state.seeded = true;
  ctx.state.childId = childId;
  ctx.state.childDay = ctx.day;
  ctx.state.tokens[CHILD] = childId;
}

async function doSeed({ ctx, wallet, token, agent, line }) {
  const id = token();
  try {
    if ((await ctx.chain.seedsAvailable(id)) <= 0) {
      // Before the parent's year is over no seed is due and none is missing: that
      // is A1's ordinary state for 365 days, so nothing is asked and nothing said.
      if (!ctx.logLines().some((l) => l.action === "seed")) return;
      // A seed is spent once per agent-year and the chain offers no second one, so
      // a seed asked for and then reading zero was SPENT -- on a child whose answer
      // we lost. Never silent: a child nobody can find is the run's one
      // unrecoverable loss.
      if (!(await adoptChild({ ctx, parentId: id, agent, line }))) {
        loud(line, "seed", "no-seed-available");
      }
      return;
    }
    const result = await agent().seed(id, ctx.addressFor(wallet));
    const child = result?.ok === true ? result.tokenId : null;
    const reason = child !== null ? null : (result?.reason ?? "no-token-id");
    line({ action: "seed", ok: child !== null, reason, tokenId: child ?? id });
    if (child === null) {
      if (isFatal(reason)) pause(ctx.state, reason, line);
      return;
    }
    recordChild(ctx, child);
  } catch (err) {
    line({ action: "seed", reason: safeReason(err) });
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/// One call per pass, and only if something asks.
function memo(fn) {
  let value;
  return () => (value ??= fn());
}

const readKey = (path) => readFileSync(path, "utf8").trim();

/// The key never reaches the message: viem's own error for a malformed private
/// key quotes the value it was given.
function addressOfKey(name, key) {
  try {
    return addressOf(key);
  } catch {
    throw new Error(`the ${name} key file does not hold a usable private key`);
  }
}

function readAddressFile(path, fallback) {
  try {
    return readFileSync(path, "utf8").trim() || fallback;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return fallback;
  }
}

export async function main() {
  const paths = yearPaths();
  const log = makeLog(paths.runnerLog);
  const contract = readAddressFile(paths.contract, "");
  if (!contract) throw new Error(`no contract address at ${paths.contract}: run setup.sh first`);
  const treasury = readAddressFile(paths.treasury, DEAD_TREASURY);

  const chain = makeChain({ rpcUrl: process.env.BASE_RPC_URL ?? "https://sepolia.base.org", contract });
  const testKey = readKey(process.env.MRO_TEST_WALLET_KEY_FILE ?? join(homedir(), ".mro-test-wallet", "wallet.key"));
  const testWallet = { key: testKey, address: addressOfKey("test wallet", testKey) };

  const keyFor = (name) => readKey(paths.wallet(name));
  const addresses = new Map();
  const addressFor = (name) => {
    if (!addresses.has(name)) addresses.set(name, addressOfKey(name, keyFor(name)));
    return addresses.get(name);
  };
  const agentsBuilt = new Map();
  const makeAgentFor = ({ identity, wallet }) => {
    const cacheKey = `${identity}|${wallet}`;
    if (!agentsBuilt.has(cacheKey)) {
      agentsBuilt.set(cacheKey, makeAgent({
        identityPath: paths.identity(identity), walletKey: keyFor(wallet), site: SITE, origin: ORIGIN,
      }));
    }
    return agentsBuilt.get(cacheKey);
  };

  const state = loadState(paths.state);
  // Validated BEFORE the first pass, exactly as the checker does it: a NaN day
  // length would make every sleep fire at once and the run a hot loop.
  const daySeconds = daySecondsFrom(process.env);

  let first = true;
  for (;;) {
    // The first pass runs wherever in the fast day the operator started the stack,
    // and a mint day is written once and for ever. Too little of the day left, and
    // the run waits for the next one rather than splitting A1-A3 across a boundary.
    if (first && !firstPassFits(Date.now(), daySeconds)) {
      log({
        day: null, chainDay: null, agent: null, tokenId: null, action: "first-pass-deferred",
        // Nothing failed: this is a pass deliberately not taken.
        ok: true, reason: `under ${FIRST_PASS_MIN_MS / 1000} s of the fast day left`,
      });
      first = false;
      await defaultSleep(nextWakeMs(Date.now(), daySeconds) - Date.now());
      continue;
    }
    first = false;
    try {
      const chainDay = await chain.today();
      // Persisted before the pass: a pass that dies must not let the next one
      // read a later day as day zero.
      if (state.startDay === null) {
        state.startDay = chainDay;
        writeState(paths.state, state);
      }
      await runDay({
        day: chainDay - state.startDay, chainDay, agents: agentSpecs(state), state, chain,
        makeAgentFor, log, testWallet, keyFor, addressFor, treasury,
        readLog: () => readJsonl(paths.runnerLog),
        readClockLog: () => readJsonl(paths.clockLog),
        deadline: passDeadlineMs(Date.now(), daySeconds),
        save: () => writeState(paths.state, state),
      });
      writeState(paths.state, state);
    } catch (err) {
      // A pass that dies takes one fast day with it, not the run.
      log({
        day: null, chainDay: null, agent: null, tokenId: null,
        action: "pass-failed", ok: false, reason: safeReason(err),
      });
    }
    await defaultSleep(nextWakeMs(Date.now(), daySeconds) - Date.now());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("runner:", safeReason(err));
    process.exitCode = 1;
  });
}
