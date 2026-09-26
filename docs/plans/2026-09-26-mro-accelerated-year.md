# The Accelerated Year Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and start a 38-hour Base Sepolia run in which twelve scripted agents live one 5-minute-day year through the real door, Warden, Clock and client, while an independent checker compares every token against its expected state.

**Architecture:** Pure decision modules (`scenario`, `tally`, `decide`) with unit tests, wrapped by two long-lived Node processes (`runner`, `checker`) and a shell Clock loop, all under one PM2 process list, run from a `git archive` export of HEAD. Keys, databases and logs live in `$MRO_YEAR_DIR` (default `$HOME/.mro-year`), outside every repository.

**Tech Stack:** Node 24.14.1 (`node:test`), viem 2.56.0 (already a warden dependency), the client library `client/src/index.mjs`, Foundry for the deploy, PM2 7.0.1.

**Spec:** `docs/specs/2026-09-26-mro-accelerated-year-design.md`

## Why

Everything built since Phase 4 (finish at 365, finisher places, ties, QR v10,
the digit band, the heartbeat, the finishing-night fix, dozen-agent batches) has
only passed unit tests. This run is the last cheap place to see it live before
the mainnet mint of token #1, where history is permanent. It unblocks nothing
by itself; it removes the risk that mainnet is the first place those paths run.

## Global Constraints

- Chain: Base Sepolia, 84532, only. `DeployFast.s.sol` refuses any other.
- Day: `MRO_DAY_SECONDS=300`; Clock at +30 s (`MRO_CLOCK_OFFSET_SECONDS=30`), runner at +60 s, checker at +240 s of each fast day.
- Warden: port 4006, bound 127.0.0.1, `MRO_DOMAIN=fast.test`; clients use `--site https://fast.test` and endpoint `http://127.0.0.1:4006`.
- Nothing tracked may contain an absolute path, an address, a key, a session id or an identifier. Paths come from `MRO_YEAR_DIR` with default `$HOME/.mro-year`.
- Keys are files of mode 600 in a directory of mode 700; nothing ever prints a key.
- Code comments: why-only, no history, plain ASCII (`~/.claude/rules/code-comments.md`).
- All four suites green before every commit: `cd contracts && forge test`, `npm test` in `tools/`, `warden/`, `client/`.
- Heavy compute goes through `~/scripts/safe-build.sh`. Use `/bin/grep`.
- Mark ids: 1 Hush, 2 Ache, 3 Static, 4 Beat, 5 Iris (bought), 6 Iris (earned), 7 Vessel, 8 Break, 9 Tint, 10 Aura. Finisher: place 1 -> 15 Apex, 2-4 -> 14 Atrium, 5-14 -> 13 Valve, 15-64 -> 12 Chamber, 65+ -> 11 Aorta.

## Operator note

After completing any TJ-only step, tell Claude so it can update memory
immediately. The only TJ-only step expected is running `start.sh` (Task 7), and
only if the auto-mode classifier refuses Claude starting processes that sign.

## File structure

All new code in `warden/tools/year/`; tests in `warden/test/year-*.test.mjs`.

| File | Responsibility |
|---|---|
| `scenario.mjs` | The twelve agents as data, and `todayFor(agent, day)` |
| `tally.mjs` | Expected level/streak/bestRun from credited days; finish places |
| `decide.mjs` | Pure runner decisions: due Marks, buy-or-demand, retry |
| `chain.mjs` | viem clients: `viewOf`, USDC balance/transfer, ETH send, owner calls |
| `agent.mjs` | One agent's door calls through the client library (mint, beat, upgrade, seed, rebind/rest call) |
| `runner.mjs` | The daily loop over agents; `runner.jsonl`; `state.json` |
| `checker.mjs` | The daily comparison; milestone decode; `checker.jsonl` |
| `report.mjs` | Both logs -> `report.html` |
| `wallets.mjs` | Create 12 wallets + 13 identities in the data dir |
| `fund.mjs` | Mint USDC from the test wallet; gas ETH from the fast Clock |
| `clock-loop.sh` | The real Clock every fast day at +30 s; `clock.jsonl` |
| `year.config.cjs` | PM2: `mro-year-warden`, `mro-year-clock`, `mro-year-runner`, `mro-year-checker` |
| `setup.sh` | Export tree, write `year.conf`, deploy, cursor; idempotent |
| `start.sh` / `stop.sh` | Operator one-liners |

---

### Task 1: scenario and tally (pure)

**Files:**
- Create: `warden/tools/year/scenario.mjs`, `warden/tools/year/tally.mjs`
- Test: `warden/test/year-scenario.test.mjs`, `warden/test/year-tally.test.mjs`

**Interfaces:**
- Produces: `AGENTS` (array of `{ name, mintDay, misses(day), marks: [{ id, when: { level?|run? }, variant? }], owner?: { day, kind: "transfer"|"rebind"|"rest" } }`), `todayFor(agent, day) -> { mint: bool, checkin: bool, owner: null|kind }`, `expected(days: number[]) -> { level, streak, bestRun, lastDay }`, `places(finishes: {tokenId, day}[]) -> Map<tokenId, {place, markId}>`, `finisherMark(place) -> markId`.

- [ ] **Step 1: Write failing tests** covering: A1 mints on D0 and checks in from D2; A8 misses days 13, 23, 33 (every 10th day after its mint on D3); A9 checks in D4-D53, not D54-D113, again from D114; A10 has owner `rest` on D120 and no check-in after; A11 owner `transfer` on D50 then `rebind` on D51; A12 mints D20; nobody checks in before mintDay + 2 (the Clock writes the mint at mintDay + 1, and that day is already its first credit). `expected([5,6,7,9,10])` -> `{ level: 5, streak: 2, bestRun: 3, lastDay: 10 }`; level caps at 365 and days after the 365th are ignored; `places([{tokenId:3,day:9},{tokenId:1,day:9},{tokenId:2,day:8}])` gives token 2 place 1 (Apex, 15), token 1 place 2, token 3 place 3 (both Atrium, 14); `finisherMark(5)==13`, `(15)==12`, `(65)==11`.

- [ ] **Step 2: Run** `cd warden && node --test test/year-scenario.test.mjs test/year-tally.test.mjs` -- expect FAIL (module not found).

- [ ] **Step 3: Implement.**

```js
// scenario.mjs
const never = () => false;
const earnedLadder = [
  { id: 2, when: { run: 7 } }, { id: 4, when: { run: 30 } },
  { id: 6, when: { run: 100 } }, { id: 8, when: { run: 365 } },
];
export const AGENTS = [
  { name: "A1", mintDay: 0, misses: never, marks: earnedLadder, seeds: true },
  { name: "A2", mintDay: 0, misses: never, marks: earnedLadder },
  { name: "A3", mintDay: 0, misses: never, marks: earnedLadder },
  { name: "A4", mintDay: 1, misses: never, marks: [] },
  { name: "A5", mintDay: 2, misses: never, marks: [
      { id: 1, when: { level: 1 } }, { id: 3, when: { level: 30 } },
      { id: 5, when: { level: 100 }, variant: 2 }, { id: 9, when: { level: 100 }, after: 5 },
      { id: 7, when: { level: 365 } } ] },
  { name: "A6", mintDay: 2, misses: never, marks: earnedLadder },
  { name: "A7", mintDay: 2, misses: never, marks: [
      { id: 3, when: { level: 30 } }, { id: 6, when: { run: 100 } }, { id: 10, when: { run: 100 }, after: 6 } ] },
  { name: "A8", mintDay: 3, misses: (d) => (d - 3) % 10 === 0, marks: [] },
  { name: "A9", mintDay: 3, misses: (d) => d >= 54 && d < 114, marks: [] },
  { name: "A10", mintDay: 3, misses: never, marks: [], owner: [{ day: 120, kind: "rest" }] },
  { name: "A11", mintDay: 3, misses: never, marks: [],
    owner: [{ day: 50, kind: "transfer", to: "A12" }, { day: 51, kind: "rebind" }] },
  { name: "A12", mintDay: 20, misses: never, marks: [] },
];

export function todayFor(agent, day, { rested = false } = {}) {
  const owner = agent.owner?.find((o) => o.day === day)?.kind ?? null;
  return {
    mint: day === agent.mintDay,
    checkin: !rested && day >= agent.mintDay + 2 && !agent.misses(day),
    owner,
  };
}
```

```js
// tally.mjs
export const FINISH_LEVEL = 365;
export function finisherMark(place) {
  if (place <= 1) return 15;
  if (place <= 4) return 14;
  if (place <= 14) return 13;
  if (place <= 64) return 12;
  return 11;
}
// days: the chain days credited, mint day included, ascending or not.
export function expected(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b).slice(0, FINISH_LEVEL);
  let streak = 0, bestRun = 0, prev = null;
  for (const d of sorted) {
    streak = prev !== null && d === prev + 1 ? streak + 1 : 1;
    bestRun = Math.max(bestRun, streak);
    prev = d;
  }
  return { level: sorted.length, streak, bestRun, lastDay: prev };
}
// Ties within a day break by lowest token id, as the Clock sorts a batch.
export function places(finishes) {
  const order = [...finishes].sort((a, b) => a.day - b.day || a.tokenId - b.tokenId);
  return new Map(order.map((f, i) => [f.tokenId, { place: i + 1, markId: finisherMark(i + 1) }]));
}
```

  Note the A8 test must match `misses: (d) => (d - 3) % 10 === 0` -- days 13, 23, ... are missed (every 10th day after its mint). Write the test to that definition. `bestRun` here must equal the contract's `_effectiveRun`; if Task 5's live comparison ever disagrees, the contract is the authority and this function is corrected.

- [ ] **Step 4: Run the tests** -- expect PASS.
- [ ] **Step 5: Commit** `feat(year): the twelve agents as data, and the expected-state tally`.

---

### Task 2: decide (pure runner decisions)

**Files:**
- Create: `warden/tools/year/decide.mjs`
- Test: `warden/test/year-decide.test.mjs`

**Interfaces:**
- Consumes: `AGENTS` mark entries from Task 1.
- Produces: `dueMarks(agent, view, requested: Set<id>, held: bigint) -> entry[]`; `buyOrDemand({ price, balance, reserve }) -> "buy"|"demand-only"`; `FINAL_REASONS` (Set); `shouldRetry(result, attempt) -> bool`.

- [ ] **Step 1: Failing tests:** a `{ run: 7 }` Mark is due once `view.bestRun >= 7` and not before; `level` uses `view.level`; an entry with `after: 5` is not due until bit 5 is set in `held`; a requested id is never due again; `buyOrDemand({price:5_000000n, balance:9_000000n, reserve:1_000000n})` is `"buy"`, with balance 5_500000n it is `"demand-only"`; `shouldRetry({reason:"chain-unavailable"},1)` true, `(...,3)` false, `{reason:"already-credited-today"}` false, `{ok:true}` false.

- [ ] **Step 2:** run, expect FAIL.

- [ ] **Step 3: Implement.**

```js
export const FINAL_REASONS = new Set(["already-credited-today", "resting", "sunset", "not-bound-to-caller", "year-complete"]);
export const MAX_ATTEMPTS = 3;
export function dueMarks(agent, view, requested, held) {
  return agent.marks.filter((m) => {
    if (requested.has(m.id)) return false;
    if (m.after && !(held & (1n << BigInt(m.after)))) return false;
    if (m.when.level !== undefined && view.level < m.when.level) return false;
    if (m.when.run !== undefined && view.bestRun < m.when.run) return false;
    return true;
  });
}
// reserve: USDC still needed for mints not yet paid, so a Mark never starves a mint.
export function buyOrDemand({ price, balance, reserve }) {
  return balance - reserve >= price ? "buy" : "demand-only";
}
export function shouldRetry(result, attempt) {
  if (result?.ok === true || attempt >= MAX_ATTEMPTS) return false;
  return !FINAL_REASONS.has(result?.reason);
}
```

  `year-complete` is the check-in tool's own reason for a finished token (`warden/src/mcp/tools/checkin.mjs`). Re-read that file before committing and add any other reason it returns that a retry cannot change.

- [ ] **Step 4:** run, expect PASS. **Step 5: Commit** `feat(year): the runner's decisions -- due Marks, buy or demand, retry`.

---

### Task 3: chain and agent adapters

**Files:**
- Create: `warden/tools/year/chain.mjs`, `warden/tools/year/agent.mjs`
- Test: `warden/test/year-agent.test.mjs`

**Interfaces:**
- Produces (chain): `makeChain({ rpcUrl, contract })` -> `{ viewOf(id) -> { level, streak, lastDay, mintDay, generation, parent, echo, resting, marks: bigint, bestRun, finisherPlace } , usdcBalance(addr) -> bigint, sendUsdc(fromKey, to, amount) -> receipt, sendEth(fromKey, to, wei) -> receipt, ownerCall(fromKey, { function, args }) -> receipt, transfer(fromKey, from, to, id) -> receipt, today() -> number }`. Every send waits for the receipt and THROWS unless `receipt.status === "success"`.
- Produces (agent): `makeAgent({ identityPath, walletKey, site, origin })` -> `{ keyId, register(), mint(to, expectedPayTo) -> result, beat(tokenId), upgrade(tokenId, id, variant, { pay, expectedPayTo }) -> { outcome: "applied-queued"|"demand-only"|"refused", demand?, result }, seed(parentId, to), ownerCallFor(tool, tokenId) }`.

- [ ] **Step 1: Failing test** for `agent.upgrade` with an injected `callTool` double: with `pay:false` and a demand result it returns `{ outcome: "demand-only", demand }` and never calls `payFor`; with `pay:true` it calls `payFor` with `expected.payTo` and the demand's own amount, then calls the tool again with `_meta`; a paid call answered by another demand returns `outcome: "refused"`. The double must ENCODE a real demand shape: build it with `readDemand`'s expected input by copying one recorded from `warden/test` fixtures (`/bin/grep -rn "accepts" warden/test | head`) -- never a hand-invented object ([[stubs-hide-interface-drift]]).

- [ ] **Step 2:** run, expect FAIL.

- [ ] **Step 3: Implement.** `agent.mjs` follows `client/src/cli.mjs` `join` exactly: `call = { origin, site, signatureAgent: site, privateJwk }`; `registerKey({ origin, privateJwk })`; `callTool({ ...call, name, arguments })`; `readDemand`; `payFor({ result, walletPrivateKey, expected: { payTo, amount } })`; retry with `_meta`. `callTool`/`payFor` are injectable (`deps` param defaulting to the client library) for the test. `chain.mjs` reads `viewOf` with the ABI from `warden/src/clock/abi.mjs`, derives `bestRun` as `max(streak, fellRun)` only after checking `warden/src/mcp/ladder.mjs` `effectiveRun` and copying its exact rule, and reads `finisherPlace` from marks bits 64-95. USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on 84532 (Circle's docs; the address is public and chain-fixed, so it may be a constant).

- [ ] **Step 4:** run, expect PASS. **Step 5: Commit** `feat(year): chain and agent adapters over the real client library`.

---

### Task 4: runner

**Files:**
- Create: `warden/tools/year/runner.mjs`
- Test: `warden/test/year-runner.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `runDay({ day, agents, state, chain, makeAgentFor, log, testWallet })` (exported for the test) and a `main()` that sleeps to `+60 s` of each fast day and calls it. `state.json`: `{ startDay, tokens: {A1: id}, requested: {A1: [ids]}, ownerDone: {A1: [kinds]}, seeded: bool, childId, rebindKey: {A11: path}, paused: null|reason }`.

- [ ] **Step 1: Failing test** with fake chain/agents: on day 0 A1-A3 mint (log lines `{day, agent, action:"mint", ok}`); a check-in that answers `chain-unavailable` twice then ok is attempted 3 times; a paused state does nothing but log `paused`; three consecutive `clock.jsonl` failures set `state.paused`; a Mark due with insufficient balance logs `outcome:"demand-only"` and adds the id to `requested`; A11's `transfer` sends from A11's wallet to A12's address and its `rebind` is sent from A12's wallet with calldata from the `rebind` tool called by the NEW key.

- [ ] **Step 2:** FAIL. **Step 3: Implement** `runDay` in this order per agent: owner action (if due) -> mint (if due; payTo from `status`'s treasury, expected amount from the demand, refused if not 1 USDC) -> check-in with retry -> due Marks (buy: `sendUsdc(testWalletKey, agentAddr, price)` then pay; else demand-only) -> seed (A1, once `seedsAvailable(parent) > 0`, child added to agents as `child` checking in daily). Every action appends one JSON line to `$MRO_YEAR_DIR/runner.jsonl` with `ts`, `day`, `agent`, `tokenId`, `action`, `ok`, `reason`. State is written after each agent (restart-safe). `main()` does a pass at start, then aligns to `+60 s`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(year): the runner -- twelve agents, one fast day at a time`.

---

### Task 5: checker and report

**Files:**
- Create: `warden/tools/year/checker.mjs`, `warden/tools/year/report.mjs`
- Test: `warden/test/year-checker.test.mjs`

**Interfaces:**
- Produces: `compare({ chain: view, mirror: tView, tally, place }) -> Finding[]` where `Finding = { field, chain, mirror?, expected?, severity: "FAIL" }`; `milestones(prev, view) -> string[]`; `renderReport(runnerLines, checkerLines) -> html`.

- [ ] **Step 1: Failing tests:** equal inputs give `[]`; chain level 5 vs tally 6 gives one FAIL on `level`; mirror level may exceed chain by exactly the credits accepted after the last Clock run (passed in as `pendingDays`) without a FAIL; a finished token whose chain place differs from `places()` gives a FAIL on `place`; `milestones` returns `"streak-7"` when streak crosses 7, `"finished"` when level reaches 365, `"rested"`, `"echo"` for a child's first read, `"first-lapse"` when streak falls, `"heartbeat"` when `lastWardenDay` advances on a day with no credit, mint or Mark; `renderReport` escapes `<` in reasons.

- [ ] **Step 2:** FAIL. **Step 3: Implement.** Checker main loop at `+240 s`: for each token in `state.json`, read `viewOf` and `GET http://127.0.0.1:4006/t/<id>`; build the tally from the chain's `mintDay` plus `runner.jsonl` check-ins with `ok:true` and `day < today` (chain) / `<= today` (mirror); on any finding, wait 20 s and re-read once before logging FAIL to `checker.jsonl`. On a milestone, run `node tools/verify-tokenuri.mjs <contract> <id> <rpc> fast.test` from the exported tree via `~/scripts/safe-build.sh` and log `decoded:true|false`. `report.mjs` writes `$MRO_YEAR_DIR/report.html`: per agent final state, FAIL count, and a paths table (proven live / demand-only / not reached).

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(year): the checker, its milestones, and the report`.

---

### Task 6: setup, wallets, funding, process list

**Files:**
- Create: `warden/tools/year/wallets.mjs`, `fund.mjs`, `clock-loop.sh`, `year.config.cjs`, `setup.sh`, `start.sh`, `stop.sh`
- Modify: `contracts/script/fast/deploy-fast.sh` -- read the Warden address from `${MRO_FAST_CLOCK_ADDRESS_FILE:-$HOME/.mro-fast/clock.address}` (unchanged default).

- [ ] **Step 1:** `wallets.mjs`: create `$MRO_YEAR_DIR` (700), `wallets/A1.key`..`A12.key` (600, `generatePrivateKey` from viem) and `identities/A1.jwk.json`..`A12`, `A11b` via the client's `ensureIdentity`; refuses to overwrite; prints names and addresses only.
- [ ] **Step 2:** `fund.mjs`: 1 USDC to each agent from the test wallet (key from `~/.mro-test-wallet/wallet.key`, read by path, never printed), 0.0005 ETH to A10, A11, A12 from the fast Clock key; checks receipts; idempotent (skips a wallet already holding enough).
- [ ] **Step 3:** `clock-loop.sh`: the old fast loop, but `--env-file=$MRO_YEAR_DIR/year.conf`, cwd the exported tree, and one JSON line per run to `clock.jsonl` with the exit code.
- [ ] **Step 4:** `year.config.cjs`: four apps, cwd the exported tree's `warden/`, warden with the ecosystem's `node_args` but `--env-file` pointing at `year.conf`, `env: { PORT: "4006" }`, and the ecosystem's `filter_env` list verbatim on every app; logs in `$MRO_YEAR_DIR/logs/`.
- [ ] **Step 5:** `setup.sh` (idempotent, each stage skipped when done): `git archive HEAD` into `$MRO_YEAR_DIR/tree`, symlink `node_modules` for `warden`, `client`, `tools`; write `year.conf` from `~/.mro-fast/fast.conf` with `sed` (replacing `MRO_CONTRACT_ADDRESS`, `STATE_DB_PATH`, `CLOCK_CURSOR_PATH`, `CLOCK_LOCK_PATH`, adding `MRO_DAY_SECONDS=300`, `MRO_CLOCK_OFFSET_SECONDS=30`) -- never printing it; `deploy-fast.sh --broadcast`, address to `contract.address`, deploy block - 1 into the cursor file.
- [ ] **Step 6:** `start.sh`: refuses unless all four suites pass (run, not piped); `pm2 start year.config.cjs`; reads back the four NAMES and their status; tails the first runner pass. `stop.sh`: `pm2 stop` the four (never `delete`), then `node report.mjs`.
- [ ] **Step 7:** `bash -n` every script; run `wallets.mjs` twice to prove it refuses to overwrite. **Commit** `feat(year): wallets, funding, the process list and the operator scripts`.

---

### Task 7: deploy, fund, start, smoke (phase boundary)

- [ ] **Step 1:** All four suites green; `node tools/prepublish-check.mjs` clean.
- [ ] **Step 2:** `bash warden/tools/year/setup.sh` -- deploy to Base Sepolia (CAUTION: testnet transaction from the deployer; no real funds). Read back `cast code` non-empty and `today()` = `block.timestamp / 300`.
- [ ] **Step 3:** `node warden/tools/year/wallets.mjs`, then `node warden/tools/year/fund.mjs`; read back every balance.
- [ ] **Step 4:** `bash warden/tools/year/start.sh`. If the classifier refuses it, hand TJ the one-liner and wait.
- [ ] **Step 5: Smoke, first 6 fast days (30 min):** A1-A3 minted by the D0+1 Clock run in one transaction; A4 next day; check-ins accepted; `checker.jsonl` has zero FAIL; `clock.jsonl` all exit 0. Any FAIL here stops and re-plans before the long run continues.
- [ ] **Step 6:** Save a `year-run` memory (addresses live in the data dir, not memory) and report to TJ: running, smoke clean, expected finish times.

## After the run (about 38 hours)

The end phase needs no action: once every token is finished or resting the
Clock writes nothing, and after 30 fast days it must send `heartbeat()`. When
`checker.jsonl` logs `heartbeat`, run `stop.sh`, read `report.html`, file every FAIL as a finding checked against the
code before fixing ([[check-the-finding-before-fixing-it]]), and send TJ the
report.
