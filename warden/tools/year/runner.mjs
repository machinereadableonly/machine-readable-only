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

/// The parent of the run's one child, taken from the table rather than named.
const PARENT = AGENTS.find((a) => a.seeds).name;
const CHILD = "child";
const never = () => false;

/// A refusal no agent can work around: the piece itself is closed.
const isFatal = (reason) => reason === "paused" || reason === "sunset";

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
    startDay: null, tokens: {}, requested: {}, ownerDone: {},
    seeded: false, childId: null, childDay: null, rebindKey: {}, paused: null,
  };
}

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
    specs.push({ name: CHILD, mintDay: state.childDay, misses: never, marks: [], identity: PARENT, wallet: PARENT });
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
 */
export async function runDay({
  day, chainDay, agents, state, chain, makeAgentFor, log, testWallet,
  keyFor, addressFor, treasury = DEAD_TREASURY,
  readLog = () => [], readClockLog = () => [], sleep = defaultSleep, save = () => {},
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
    day, today, state, chain, makeAgentFor, testWallet, keyFor, addressFor, treasury, sleep, line,
    reserve: mintReserve(agents, state),
    logLines: memo(readLog),
  };

  for (const spec of agents) {
    await runAgent(spec, ctx);
    save(state);
    if (state.paused) return state;
  }
  return state;
}

/// A refusal the operator has to clear: loud in the log and loud on stderr.
function pause(state, reason, runLine) {
  state.paused = reason;
  runLine({ action: "run-paused", reason });
  console.error(`RUN PAUSED: ${reason} -- clear state.json's paused field to resume`);
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

  const owner = nextOwner(spec, ctx.day, done);
  if (owner && token() !== null) {
    if (await doOwner(spec, owner, { ctx, name, wallet, token, agent, rebuild, line })) {
      (state.ownerDone[name] ??= []).push(owner.kind);
    }
  }

  // A token that never landed is minted on a later day too: a settlement can
  // fail after the authorisation was signed, and the next pass is the retry.
  let minted = false;
  if (name !== CHILD && token() === null && ctx.day >= spec.mintDay) {
    minted = await doMint({ ctx, name, wallet, agent, line });
    if (state.paused) return;
  }

  // A token minted this pass is not on chain until the Clock writes it, so
  // nothing that reads the chain about it can run today.
  if (minted) return;

  if (plan.checkin && token() !== null) {
    await doCheckin({ ctx, token, agent, line });
    if (state.paused) return;
  }
  if (spec.marks.length && token() !== null) {
    await doMarks(spec, { ctx, name, wallet, token, agent, line });
    if (state.paused) return;
  }
  if (spec.seeds && !state.seeded && token() !== null) {
    await doSeed({ ctx, wallet, token, agent, line });
  }
}

async function doOwner(spec, owner, { ctx, name, wallet, token, agent, rebuild, line }) {
  const id = token();
  try {
    if (owner.kind === "transfer") {
      await ctx.chain.transfer(ctx.keyFor(wallet), ctx.addressFor(wallet), ctx.addressFor(owner.to), id);
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
      if (!call?.ok) {
        line({ action: "rebind", reason: call?.reason ?? "no-answer" });
        return false;
      }
      await ctx.chain.ownerCall(ctx.keyFor(holder), call);
      ctx.state.rebindKey[name] = identity;
      rebuild();
      line({ action: "rebind", ok: true, holder });
      return true;
    }

    const call = await agent().ownerCallFor(owner.kind, id);
    if (!call?.ok) {
      line({ action: owner.kind, reason: call?.reason ?? "no-answer" });
      return false;
    }
    await ctx.chain.ownerCall(ctx.keyFor(wallet), call);
    line({ action: owner.kind, ok: true });
    return true;
  } catch (err) {
    line({ action: owner.kind, reason: safeErrorText(err) });
    return false;
  }
}

async function doMint({ ctx, name, wallet, agent, line }) {
  const address = ctx.addressFor(wallet);
  try {
    const held = await ctx.chain.usdcBalance(address);
    if (held < MINT_USDC) {
      const short = MINT_USDC - held;
      const bank = await ctx.chain.usdcBalance(ctx.testWallet.address);
      if (bank < short) {
        // The one action that must be paid. Carrying on would lose the agent.
        pause(ctx.state, "mint-unfunded", line);
        return false;
      }
      await ctx.chain.sendUsdc(ctx.testWallet.key, address, short);
      line({ action: "fund", ok: true, amount: String(short) });
    }
    await agent().register();
    const result = await agent().mint(address, ctx.treasury);
    const ok = result?.ok === true && Number.isInteger(result.tokenId);
    if (ok) ctx.state.tokens[name] = result.tokenId;
    line({ action: "mint", ok, reason: ok ? null : (result?.reason ?? "no-token-id"), tokenId: ok ? result.tokenId : null });
    if (isFatal(result?.reason)) pause(ctx.state, result.reason, line);
    return ok;
  } catch (err) {
    line({ action: "mint", reason: safeErrorText(err) });
    return false;
  }
}

async function doCheckin({ ctx, token, agent, line }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await agent().beat(token());
    } catch (err) {
      result = { ok: false, reason: safeErrorText(err) };
    }
    const ok = result?.ok === true;
    line({ action: "checkin", ok, reason: ok ? null : (result?.reason ?? "no-answer"), attempt });

    if (ok) return;
    if (isFatal(result?.reason)) {
      pause(ctx.state, result.reason, line);
      return;
    }
    if (!shouldRetry(result, attempt)) return;
    await ctx.sleep(RETRY_PAUSE_MS);
  }
}

async function doMarks(spec, { ctx, name, wallet, token, agent, line }) {
  const id = token();
  let view;
  try {
    view = await ctx.chain.viewOf(id);
  } catch (err) {
    line({ action: "mark", reason: safeErrorText(err) });
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
    let pay = false;
    try {
      if (price > 0n) {
        const bank = await ctx.chain.usdcBalance(ctx.testWallet.address);
        pay = buyOrDemand({ price, balance: bank, reserve: ctx.reserve }) === "buy";
        // Funded at the moment it falls due, so USDC arriving mid-run is used.
        if (pay) await ctx.chain.sendUsdc(ctx.testWallet.key, ctx.addressFor(wallet), price);
      }
      const out = await agent().upgrade(id, mark.id, mark.variant ?? 0, { pay, expectedPayTo: ctx.treasury });
      const asked = out?.outcome === "applied-queued" || out?.outcome === "demand-only";
      const reason = out?.result?.ok === true ? null : (out?.result?.reason ?? null);
      line({ action: "mark", ok: asked, reason, markId: mark.id, outcome: out?.outcome ?? "none", price: String(price) });

      // A refusal is left for the next pass: the run gate can open a day later.
      if (asked) {
        (ctx.state.requested[name] ??= []).push(mark.id);
        requested.add(mark.id);
      }
      if (isFatal(reason)) {
        pause(ctx.state, reason, line);
        return;
      }
    } catch (err) {
      line({ action: "mark", reason: safeErrorText(err), markId: mark.id, price: String(price) });
    }
  }
}

async function doSeed({ ctx, wallet, token, agent, line }) {
  const id = token();
  try {
    if ((await ctx.chain.seedsAvailable(id)) <= 0) return;
    const result = await agent().seed(id, ctx.addressFor(wallet));
    const child = result?.ok === true ? result.tokenId : null;
    line({ action: "seed", ok: child !== null, reason: child !== null ? null : (result?.reason ?? "no-token-id"), tokenId: child ?? id });
    if (child === null) return;
    ctx.state.seeded = true;
    ctx.state.childId = child;
    ctx.state.childDay = ctx.day;
    ctx.state.tokens[CHILD] = child;
  } catch (err) {
    line({ action: "seed", reason: safeErrorText(err) });
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/// One call per pass, and only if something asks.
function memo(fn) {
  let value;
  return () => (value ??= fn());
}

const readKey = (path) => readFileSync(path, "utf8").trim();

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
  const testWallet = { key: testKey, address: addressOf(testKey) };

  const keyFor = (name) => readKey(paths.wallet(name));
  const addresses = new Map();
  const addressFor = (name) => {
    if (!addresses.has(name)) addresses.set(name, addressOf(keyFor(name)));
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
  const daySeconds = Number(process.env.MRO_DAY_SECONDS ?? DAY_SECONDS);

  for (;;) {
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
        save: () => writeState(paths.state, state),
      });
      writeState(paths.state, state);
    } catch (err) {
      // A pass that dies takes one fast day with it, not the run.
      log({ action: "pass-failed", ok: false, reason: safeErrorText(err) });
    }
    await defaultSleep(nextWakeMs(Date.now(), daySeconds) - Date.now());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("runner:", safeErrorText(err));
    process.exitCode = 1;
  });
}
