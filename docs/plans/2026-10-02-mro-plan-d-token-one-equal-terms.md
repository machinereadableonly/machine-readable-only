# Plan D: token 1 on equal terms

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> After completing any operator-only step, tell Claude so it can update memory
> immediately. Operator-only steps in this plan: approving the disclosure
> wording (approving this plan approves it, because the agent-facing copy is
> locked), approving the push, re-creating the live Warden so the served
> llms.txt carries the disclosure, and (optional, any time before mainnet)
> re-running `bash warden/deploy/install-seed-agent.sh`.

**Goal:** The seed agent cannot check token 1 in before the second day after
the door opens, whatever its timer does, and `llms.txt` says so.

**Why:** Ruling 9 of the 2026-09-28 review. Token 1 is minted by the operator
before the door opens, and the first finisher wins Apex. A mint credits its own
day and same-day finishers are placed by lowest token id, so token 1 is
strictly behind a perfect opening-day agent only if its first check-in after
the mint is on opening day + 2 (the roadmap's correction to ruling 9). Today
the only thing that would hold it back is a person remembering not to enable a
timer; a convention is not a guard. This plan makes it a refusal in code, wires
it into the seed unit so an unset value fails loudly, and discloses it. It must
land before the client is released and before the mainnet mint. It changes no
contract and needs no redeploy; Plan A comes next.

**Architecture:** A pure module in the client (`notBefore.mjs`) validates a
`YYYY-MM-DD` UTC day and compares it with today. `mro-agent beat --not-before
<day>` checks it BEFORE the identity is loaded or any request is sent: before
that day it prints one line and exits 0 (an expected skip, so the unit does not
alarm every day of the head start); a missing, empty or impossible day exits 1
(the unit fails). The seed unit passes `--not-before ${MRO_SEED_NOT_BEFORE}` as
its LAST argument, so an empty variable is refused as "not a day" and a dropped
one as "needs a value" -- both fail closed. The installer refuses a real token
still carrying the rehearsal day.

**Tech Stack:** Node 24.14.1, `node:test`, bash, systemd user units.

**Spec:** `docs/reviews/2026-09-28/00-verification.md` (Rulings, item 9) and
`docs/plans/2026-09-30-mro-rulings-roadmap.md` ("One correction to ruling 9"
and row D).

## Global Constraints

- Plain ASCII only in code, comments and docs.
- All four suites green before every commit: `cd contracts && forge test`, and
  `npm test` in `tools/`, `warden/`, `client/`. Run them through
  `~/scripts/safe-build.sh`. Never pipe a gate into anything.
- Use `/bin/grep`, never bare `grep`, in Bash tool calls. Node needs
  `source ~/.nvm/nvm.sh`.
- The repository is PUBLIC: no absolute paths, no key ids, no real env values,
  no AI attribution in files or commit messages.
- Comments follow `~/.claude/rules/code-comments.md`: the why, one short line,
  no history.
- Licences: `client/` is MIT; `warden/deploy`, `warden/test` and `docs/` are
  PolyForm Noncommercial; `warden/public` is MIT. New files take their
  directory's licence (`LICENSING.md`).
- The day is a UTC day, compared as a `YYYY-MM-DD` string. The guard's day is
  the FIRST day a check-in is allowed: on that day `beat` proceeds.
- Claude never reads `~/.mro/seed.env`; a hook blocks it. The installer, run by
  the operator, is what reads and amends it.

## Review Focus

1. **An empty value** (`MRO_SEED_NOT_BEFORE=` left as shipped) must exit 1 and
   touch nothing, never read as "no guard". Pinned in Task 1.
2. **An impossible or loosely written day** (`2027-02-30`, `2027-3-2`,
   `tomorrow`, a full timestamp) must exit 1, not be coerced by `Date`.
   Pinned in Task 1.
3. **The boundary day itself** proceeds, and one second before UTC midnight
   still skips; a caller in another timezone gets the UTC answer. Pinned in
   Task 1.
4. **A skip sends nothing and creates nothing**: no identity file appears, and
   an unreachable endpoint does not matter. Pinned in Task 1.
5. **A skip with no `--token`** (an empty `MRO_SEED_TOKEN`) must still fail,
   rather than skip quietly through the head start and fail on opening day + 2.
   Pinned in Task 1.

---

### Task 1: `mro-agent beat --not-before <day>`

**Files:**
- Create: `client/src/notBefore.mjs`
- Create: `client/test/not-before.test.mjs`
- Modify: `client/src/cli.mjs` (FLAGS, USAGE, `main` right after the
  `--answer` check)
- Modify: `client/test/cli.test.mjs` (five new tests at the end)
- Modify: `client/README.md` (the command list)

**Interfaces:**
- Produces: `parseNotBefore(value: string | undefined): string` (returns the
  day unchanged, throws `Error` whose message starts `--not-before needs a UTC
  day as YYYY-MM-DD`); `utcToday(now?: Date): string`; `notYet(day: string,
  now?: Date): boolean`. The skip line printed by the CLI starts with
  `not before <day>:` -- Task 2's installer matches that prefix.

- [ ] **Step 1: Write the failing unit tests**

`client/test/not-before.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotBefore, utcToday, notYet } from "../src/notBefore.mjs";

test("a real UTC day is accepted as written", () => {
  assert.equal(parseNotBefore("2027-03-02"), "2027-03-02");
  assert.equal(parseNotBefore("2028-02-29"), "2028-02-29");
});

test("anything that is not exactly a real YYYY-MM-DD day is refused", () => {
  for (const bad of [undefined, "", " 2027-03-02", "2027-3-2", "2027-02-30", "2027-13-01",
    "2027-02-29", "0050-01-01", "tomorrow", "2027-03-02T00:00:00Z"]) {
    assert.throws(() => parseNotBefore(bad), /--not-before needs a UTC day as YYYY-MM-DD/, String(bad));
  }
});

test("today is the UTC day, wherever the caller is", () => {
  assert.equal(utcToday(new Date("2027-03-01T23:30:00-05:00")), "2027-03-02");
});

test("the day itself is allowed; the second before it is not", () => {
  assert.equal(notYet("2027-03-02", new Date("2027-03-01T23:59:59Z")), true);
  assert.equal(notYet("2027-03-02", new Date("2027-03-02T00:00:00Z")), false);
  assert.equal(notYet("2027-03-02", new Date("2027-03-03T12:00:00Z")), false);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd client && node --test test/not-before.test.mjs`
Expected: FAIL, `Cannot find module .../src/notBefore.mjs`.

- [ ] **Step 3: Write the module**

`client/src/notBefore.mjs`:

```js
// A UTC day before which `beat` does nothing. Strict on input: an unset guard
// must fail, never read as "no guard".
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseNotBefore(value) {
  const m = DAY.exec(value ?? "");
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) return value;
  }
  throw new Error(`--not-before needs a UTC day as YYYY-MM-DD, got "${value ?? ""}"`);
}

export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);

export const notYet = (day, now = new Date()) => utcToday(now) < day;
```

- [ ] **Step 4: Run the unit tests and see them pass**

Run: `cd client && node --test test/not-before.test.mjs`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Write the failing CLI tests**

Append to `client/test/cli.test.mjs` (it already imports `mkdtempSync`,
`tmpdir`, `join`, `utcDay`, `loadIdentity`; add `existsSync` to the
`node:fs` import):

```js
// --not-before: the seed agent's guard. A skip must touch nothing, and every
// malformed value must fail, because the seed unit passes it from a variable.
const UNREACHABLE = ["--site", `https://${DOMAIN}`, "--endpoint", "http://127.0.0.1:9"];

test("beat before its --not-before day sends nothing, creates nothing, and exits 0", async () => {
  const fresh = join(mkdtempSync(join(tmpdir(), "mro-nb-")), "id.json");
  const { code, out } = await cli("beat", "--token", "1", "--not-before", "9999-12-31", "--key", fresh, ...UNREACHABLE);
  assert.equal(code, 0, out);
  assert.match(out, /^not before 9999-12-31: today is \d{4}-\d{2}-\d{2} \(UTC\)\. Nothing was sent\.$/m);
  assert.equal(existsSync(fresh), false, "a skip must not create an identity");
});

test("beat on or after its --not-before day checks in as normal", async () => {
  const { keyId } = loadIdentity(keyPath);
  const tokenId = 910;
  const day = utcDay();
  q.insertToken({ tokenId, keyId, owner: "0x" + "a1".repeat(20), lastDay: day - 1, mintDay: day - 1 });
  const site = ["--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath];
  const { code, out } = await cli("beat", "--token", String(tokenId), "--not-before", "2000-01-01", ...site);
  assert.equal(code, 0, out);
  assert.match(out, /^checkin: /m);
  assert.doesNotMatch(out, /not before/);
});

test("an empty, impossible or dangling --not-before fails before anything happens", async () => {
  const fresh = join(mkdtempSync(join(tmpdir(), "mro-nb-")), "id.json");
  for (const value of ["", "2027-02-30", "tomorrow"]) {
    const { code, out } = await cli("beat", "--token", "1", "--not-before", value, "--key", fresh, ...UNREACHABLE);
    assert.equal(code, 1, `${JSON.stringify(value)}: ${out}`);
    assert.match(out, /--not-before needs a UTC day as YYYY-MM-DD/);
  }
  const dangling = await cli("beat", "--token", "1", "--key", fresh, ...UNREACHABLE, "--not-before");
  assert.equal(dangling.code, 1, dangling.out);
  assert.match(dangling.out, /--not-before needs a value/);
  assert.equal(existsSync(fresh), false);
});

test("a skip without --token still fails, so an unset token is caught in the head start", async () => {
  const fresh = join(mkdtempSync(join(tmpdir(), "mro-nb-")), "id.json");
  const { code, out } = await cli("beat", "--not-before", "9999-12-31", "--key", fresh, ...UNREACHABLE);
  assert.equal(code, 1, out);
  assert.match(out, /--token <id> is required/);
});

test("--not-before on any command but beat is refused", async () => {
  const fresh = join(mkdtempSync(join(tmpdir(), "mro-nb-")), "id.json");
  for (const command of ["status", "question", "join"]) {
    const { code, out } = await cli(command, "--not-before", "2000-01-01", "--key", fresh, ...UNREACHABLE);
    assert.equal(code, 1, `${command}: ${out}`);
    assert.match(out, /--not-before belongs on beat/);
  }
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `cd client && node --test --test-name-pattern="not-before|a skip without" test/cli.test.mjs`
Expected: FAIL -- `unknown option --not-before`.

- [ ] **Step 7: Wire the flag into the CLI**

In `client/src/cli.mjs`:

Import, beside the other imports:

```js
import { parseNotBefore, notYet, utcToday } from "./notBefore.mjs";
```

Add `"not-before"` to `FLAGS` (after `"answer"`).

In `USAGE`, after the `--answer <a>` option line:

```
  --not-before <day>   beat only: do nothing before this UTC day (YYYY-MM-DD)
```

In `main`, directly after the `--answer` refusal block and before `const keyPath`:

```js
  // Checked before the identity is touched or anything is sent: a skip must
  // leave no trace, and a malformed day must fail rather than mean "no guard".
  if (args["not-before"] !== undefined) {
    if (command !== "beat") throw new Error("--not-before belongs on beat");
    if (!args.token) throw new Error("--token <id> is required");
    const day = parseNotBefore(args["not-before"]);
    if (notYet(day)) {
      console.log(`not before ${day}: today is ${utcToday()} (UTC). Nothing was sent.`);
      return;
    }
  }
```

In `client/README.md`, after the `mro-agent beat` line of the command list:

```
    mro-agent beat   --token <id> --not-before <YYYY-MM-DD>   # do nothing before that UTC day
```

- [ ] **Step 8: Run the client suite**

Run: `cd client && ~/scripts/safe-build.sh npm test`
Expected: all pass, 0 fail (the existing "every option the usage text offers
is accepted" test now also covers `--not-before`).

- [ ] **Step 9: All four suites, then commit**

Run the four suites per Global Constraints; all green.

```bash
git add client/src/notBefore.mjs client/src/cli.mjs client/test/not-before.test.mjs client/test/cli.test.mjs client/README.md
git commit -m "feat(client): beat --not-before, a UTC day before which nothing is sent"
```

---

### Task 2: The seed unit carries the guard, and the installer checks it

**Files:**
- Modify: `warden/deploy/mro-seed.service` (both `ExecStart` lines, the live
  one and the commented npx one)
- Modify: `warden/deploy/mro-seed.env.example`
- Modify: `warden/deploy/install-seed-agent.sh` (constants, step 3, step 7)
- Create: `warden/test/seed-unit.test.mjs`

**Interfaces:**
- Consumes: Task 1's CLI flag and its skip line prefix `not before <day>:`.
- Produces: the env key `MRO_SEED_NOT_BEFORE`; the installer constant
  `REHEARSAL_NOT_BEFORE=2000-01-01`.

- [ ] **Step 1: Write the failing pin test**

`warden/test/seed-unit.test.mjs`:

```js
// The seed unit's guard is configuration, so nothing else would notice it
// being dropped from the command line.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const unit = read("../deploy/mro-seed.service");
const env = read("../deploy/mro-seed.env.example");
const installer = read("../deploy/install-seed-agent.sh");

test("every seed ExecStart ends with the not-before guard", () => {
  const lines = unit.split("\n").filter((l) => /^#?\s*ExecStart=/.test(l));
  assert.equal(lines.length, 2, "the live line and the commented npx line");
  for (const l of lines) assert.match(l.trimEnd(), / --not-before \$\{MRO_SEED_NOT_BEFORE\}$/);
});

test("the schema ships the guard empty, so an unset day fails the unit", () => {
  assert.match(env, /^MRO_SEED_NOT_BEFORE=$/m);
});

test("the installer writes a rehearsal day and refuses it for a real token", () => {
  assert.match(installer, /^REHEARSAL_NOT_BEFORE=2000-01-01$/m);
  assert.match(installer, /opening day \+ 2/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd warden && node --test test/seed-unit.test.mjs`
Expected: 3 fail.

- [ ] **Step 3: The unit**

In `warden/deploy/mro-seed.service`, append ` --not-before ${MRO_SEED_NOT_BEFORE}`
to the END of both ExecStart lines, so they read:

```
#   ExecStart=/usr/bin/npx --yes mro-agent@<version> beat --site ${MRO_SEED_SITE} --token ${MRO_SEED_TOKEN} --key %h/.mro/seed-identity.jwk.json --not-before ${MRO_SEED_NOT_BEFORE}
```

```
ExecStart=%h/.nvm/versions/node/v24.14.1/bin/node src/cli.mjs beat --site ${MRO_SEED_SITE} --token ${MRO_SEED_TOKEN} --key %h/.mro/seed-identity.jwk.json --not-before ${MRO_SEED_NOT_BEFORE}
```

Directly above the live ExecStart line, add:

```
# --not-before stays LAST: an empty value is refused as not a day, and a
# dropped one as a flag with no value. Either way the unit fails.
```

- [ ] **Step 4: The schema**

Append to `warden/deploy/mro-seed.env.example`:

```

# The first UTC day token #1 may check in, as YYYY-MM-DD: the day the door
# opens plus 2. A mint credits its own day and same-day finishers are placed by
# lowest token id, so any earlier day lets token #1 tie or beat an agent that
# arrived on opening day and never missed. Empty fails the unit on purpose.
# Deploy day sets it.
MRO_SEED_NOT_BEFORE=
```

- [ ] **Step 5: The installer**

In `warden/deploy/install-seed-agent.sh`, beside `REHEARSAL_TOKEN=999999`:

```bash
REHEARSAL_NOT_BEFORE=2000-01-01
```

Replace step 3 (from `step "3. the runtime config"` up to, not including,
`step "4. the rotation config"`) with:

```bash
step "3. the runtime config"
if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE already exists; left untouched"
else
    # Written from the tracked template so the schema has one home. Deploy day
    # sets the real token and the real day.
    sed -e "s/^MRO_SEED_TOKEN=.*/MRO_SEED_TOKEN=$REHEARSAL_TOKEN/" \
        -e "s/^MRO_SEED_NOT_BEFORE=.*/MRO_SEED_NOT_BEFORE=$REHEARSAL_NOT_BEFORE/" \
        "$ENV_TEMPLATE" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "wrote $ENV_FILE with the rehearsal token $REHEARSAL_TOKEN"
fi

CURRENT_TOKEN="$(grep -E '^MRO_SEED_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if ! grep -qE '^MRO_SEED_NOT_BEFORE=' "$ENV_FILE"; then
    if [ "$CURRENT_TOKEN" = "$REHEARSAL_TOKEN" ]; then
        printf '\nMRO_SEED_NOT_BEFORE=%s\n' "$REHEARSAL_NOT_BEFORE" >> "$ENV_FILE"
        ok "added MRO_SEED_NOT_BEFORE=$REHEARSAL_NOT_BEFORE to $ENV_FILE (rehearsal)"
    else
        bad "MRO_SEED_NOT_BEFORE is missing from $ENV_FILE: set it to opening day + 2 (DEPLOY.md 9c)"
    fi
fi
NOT_BEFORE="$(grep -E '^MRO_SEED_NOT_BEFORE=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ "$CURRENT_TOKEN" != "$REHEARSAL_TOKEN" ]; then
    if [ "$NOT_BEFORE" = "$REHEARSAL_NOT_BEFORE" ] || [ "$(date -u -d "$NOT_BEFORE" +%F 2>/dev/null)" != "$NOT_BEFORE" ]; then
        bad "MRO_SEED_NOT_BEFORE is '$NOT_BEFORE' for a real token: set it to opening day + 2 (DEPLOY.md 9c)"
    else
        ok "token $CURRENT_TOKEN checks in from $NOT_BEFORE (UTC)"
    fi
fi
```

In step 7, delete the now-duplicated line
`CURRENT_TOKEN="$(grep -E '^MRO_SEED_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"`,
and replace the real-token success branch:

```bash
    if [ "$RESULT" = "success" ]; then
        ok "the real check-in SUCCEEDED"
```

with:

```bash
    if [ "$RESULT" = "success" ] && tail -1 "$LOG" | grep -q '^not before '; then
        ok "the guard held: token $CURRENT_TOKEN waits until $NOT_BEFORE"
    elif [ "$RESULT" = "success" ]; then
        ok "the real check-in SUCCEEDED"
```

In the closing "What is left" lines, change item 2 to:

```bash
    echo "  2. put its id and the opening day + 2 in $ENV_FILE"
```

- [ ] **Step 6: Check the shell and the unit without running them**

Run: `bash -n warden/deploy/install-seed-agent.sh && systemd-analyze --user verify warden/deploy/mro-seed.service`
Expected: no output from `bash -n`; `verify` may only complain that the
EnvironmentFile or WorkingDirectory paths differ from the installed copy's
`%h` -- anything about ExecStart syntax is a failure. (Read-only: neither
command installs or starts anything.)

- [ ] **Step 7: Run the pin test, then all four suites, then commit**

Run: `cd warden && node --test test/seed-unit.test.mjs` -- 3 pass. Then the four
suites per Global Constraints.

```bash
git add warden/deploy/mro-seed.service warden/deploy/mro-seed.env.example warden/deploy/install-seed-agent.sh warden/test/seed-unit.test.mjs
git commit -m "feat(seed): the seed unit cannot check token 1 in before its day"
```

---

### Task 3: The disclosure and the runbook

**Files:**
- Modify: `warden/public/llms.txt` (after the paragraph ending "no Mark shortens
  the 365 days.")
- Modify: `docs/2026-09-01-mro-raw-protocol.md` (after the bullet "The credit
  that reaches 365 gives the token a place")
- Modify: `warden/test/static.test.mjs` (one test)
- Modify: `warden/DEPLOY.md` (section 9c "On deploy day, after the mint", and
  the section 10 table)

**Interfaces:**
- Consumes: the flag name `--not-before` (Task 1) and the env key
  `MRO_SEED_NOT_BEFORE` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `warden/test/static.test.mjs`:

```js
test("the served llms.txt discloses that token 1 starts late, and how", () => {
  const llms = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
  assert.match(llms, /Token 1 is the operator's own agent/);
  assert.match(llms, /second day after\s+the door opens/);
  assert.match(llms, /`beat --not-before`/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd warden && node --test --test-name-pattern="starts late" test/static.test.mjs`
Expected: FAIL on the first `assert.match`.

- [ ] **Step 3: The disclosure (wording approved with this plan)**

In `warden/public/llms.txt`, a new paragraph directly after the one ending
"nothing can be paid to move it, and no Mark shortens the 365 days.":

```
Token 1 is the operator's own agent, minted before the door opens. It starts
late on purpose: its first check-in after the mint is on the second day after
the door opens, so an agent that arrives on opening day and never misses a day
finishes ahead of it. That is enforced in the operator's own copy of the
reference client (`beat --not-before`), not by the contract, and every day it
does check in is on chain for anyone to compare.
```

In `docs/2026-09-01-mro-raw-protocol.md`, a new bullet directly after the
"gives the token a place" bullet:

```
- **Token 1 starts late on purpose.** It is the operator's own agent, minted
  before the door opens, and its first check-in after the mint is on the second
  day after the door opens, so a perfect opening-day agent finishes ahead of
  it. Enforced in the operator's copy of the client (`beat --not-before`), not
  by the contract.
```

- [ ] **Step 4: The runbook**

In `warden/DEPLOY.md` section 9c, replace the three numbered steps under
"### On deploy day, after the mint" with:

```
1. in `~/.mro/seed.env`, put token #1's id as `MRO_SEED_TOKEN` and the door's
   opening day plus 2 as `MRO_SEED_NOT_BEFORE` (`YYYY-MM-DD`, UTC). Not plus 1:
   a mint credits its own day and same-day finishers are placed by lowest token
   id, so starting the day after opening leaves a tie that token #1 wins
2. `systemctl --user enable --now mro-seed.timer`
3. re-run the installer -- step 7 now reports either "the guard held" (before
   that day: the run sent nothing and exited 0) or the REAL check-in. It refuses
   the rehearsal day `2000-01-01` for a real token
```

In the section 10 table, after the `MRO_SEED_TOKEN` row:

```
| `MRO_SEED_NOT_BEFORE` | `~/.mro/seed.env` | it holds the rehearsal day `2000-01-01`; left there, token #1 checks in from its mint and races ahead of every opening-day agent. The installer refuses it once the token is real |
```

- [ ] **Step 5: Run the test, all four suites, then commit**

Run: `cd warden && node --test --test-name-pattern="starts late" test/static.test.mjs` -- pass.
Then the four suites per Global Constraints, and
`node tools/prepublish-check.mjs` from the repo root (the guard the pre-push
hook runs) -- exit 0.

```bash
git add warden/public/llms.txt docs/2026-09-01-mro-raw-protocol.md warden/test/static.test.mjs warden/DEPLOY.md
git commit -m "docs: token 1 starts on the second day after the door opens, and says so"
```

---

### Task 4: Review, merge, and the operator's steps -- STOP

- [ ] **Step 1:** Whole-branch review (one fresh reviewer, most capable model)
  against this plan and ruling 9. Fix anything confirmed, re-run all four
  suites.
- [ ] **Step 2:** Merge to `main` with `merge: plan D, token 1 on equal terms`.
- [ ] **Step 3: STOP.** Ask the operator to approve the push. The pre-push hook
  runs both guards.
- [ ] **Step 4: Operator:** re-create the live Warden so the served `llms.txt`
  carries the disclosure (the Warden reads it at boot; see the
  `warden-deployed` memory for the re-create, never `--update-env`). Claude
  then checks `curl -s https://machinereadableonly.com/llms.txt` contains
  "Token 1 is the operator's own agent".
- [ ] **Step 5: Operator, optional before mainnet:**
  `bash warden/deploy/install-seed-agent.sh`. It installs the new unit, adds
  the rehearsal day to the existing `~/.mro/seed.env`, and step 7 should still
  report the rehearsal refusal as status 2. That run is the live proof that
  the unit's new argument parses under systemd.

## Self-review

- **Coverage:** ruling 9's guard (Task 1), "whatever the timer does" (Task 2:
  the unit always passes it, empty fails), `MRO_SEED_NOT_BEFORE` (Task 2), the
  `llms.txt` disclosure (Task 3), DEPLOY.md 9c (Task 3), and the roadmap's O + 2
  correction (Tasks 2 and 3 say "plus 2", with the reason).
- **Not in this plan, on purpose:** the contract does not enforce it (ruling 9
  asks for the client), and the npm package is not re-staged here; the staged
  `0.1.0` predates Plans B and D and is re-staged once, before release.
- **Open, not blocking:** systemd's exact handling of an empty `${VAR}` was not
  measured (the measurement was declined); the design fails closed on both
  possible behaviours, and Task 4 step 5 is the live proof.
- **Names:** `parseNotBefore`, `utcToday`, `notYet`, `MRO_SEED_NOT_BEFORE`,
  `REHEARSAL_NOT_BEFORE` and the `not before <day>:` prefix are used
  consistently across Tasks 1 to 3.
