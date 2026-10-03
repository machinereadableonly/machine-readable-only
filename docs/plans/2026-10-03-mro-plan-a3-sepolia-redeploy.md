# Plan A3: the Base Sepolia redeploy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> After completing any operator-only step, tell Claude so it can update memory
> immediately. Operator-only steps in this plan: approving it (which approves
> the Sepolia broadcast and the choices below); backing the split seed up
> offline (Task 4, recommended, not blocking on testnet); running the one
> switchover script (Task 7); approving the push (Task 8); and topping up test
> USDC at faucet.circle.com if the test wallet is short (Task 9).

**Goal:** Put A1 and A2 on Base Sepolia: deploy the new pair with its split
anchor set in the same broadcast, adopt the address everywhere, switch the live
Warden and Clock onto it, merge `plan-a` to main, and prove the daily question
end to end with the test agent and `mro-agent verify-border`.

**Why:** A1 and A2 changed the token contract (answer bits, the split anchor,
the stored rest day, contractURI, the date floors). A contract change means a
new address, and until it is adopted the branch cannot be merged: the live
Warden's boot check refuses the new `viewOf` shape against the old pair, and
refuses any contract without a split anchor. The testnet redeploy is also the
dress rehearsal for the mainnet deploy, which runs the same deploy script.
This plan unblocks Plan E (key custody) and, after it, mainnet.

| Plan | What | Deploys? |
|---|---|---|
| A1 (built, `plan-a`) | Rulings 2 and 3, the date floors, contractURI | No |
| A2 (built, `plan-a`) | The daily question on chain | No |
| **A3 (this)** | Anchor in the deploy, Builder Code, gates, the Sepolia redeploy, adoption, switchover, merge, live proof | **Yes, Base Sepolia (testnet ETH only)** |

**What approving this plan also approves.**

1. **The broadcast.** Task 5 sends real Base Sepolia transactions (testnet
   ETH, no real value) and replaces the live testnet pair. Every token on the
   current pair (`0x6a6f90E9...`) is superseded, as on every earlier redeploy.
2. **The anchor is set inside the deploy, not by a separate `cast send`.**
   `DeployPlan5.s.sol` takes `SPLIT_ANCHOR` and calls `setSplitAnchor` in the
   same broadcast, so no contract ever exists without its anchor, and the
   mainnet deploy (`deploy-mainnet.sh`, same script) gets the same guarantee.
   DEPLOY.md section 11 steps 3a/3b become "make the seed, then deploy".
3. **The Builder Code goes in now** (Task 2): `BUILDER_CODE = "bc_dfhlohlh"`,
   so every Clock write on the new pair carries the ERC-8021 suffix
   `0x62635f6466686c6f686c680b0080218021802180218021802180218021`.
4. **The Sepolia seed lives at the default path, `~/.mro-split/seed`.** The
   mainnet deploy needs its OWN seed; DEPLOY.md section 10's cutover table
   gains the row that says so (move the Sepolia seed aside, make a new one).
5. **Tonight's Clock run (00:05 UTC) on the OLD pair writes nothing** if the
   switchover has not happened by then: the Clock runs from this checkout,
   which is on `plan-a`, and the old pair has no split anchor. Harmless: the
   switchover clears the old pair's queued rows anyway.
6. **The merge.** Task 8 fast-forwards `main` to `plan-a` locally; the PUSH
   still waits for your explicit yes at that moment.

**Architecture:** Two small code changes first (anchor in the deploy script,
Builder Code), then the existing runbook, DEPLOY.md section 11, in order:
gates, seed, deploy, verify, adopt, rehearse, switch over, prove.

**Tech Stack:** Foundry 1.7.1 (`forge script`, `cast`), Node 24.14.1, PM2,
systemd user timer, Base Sepolia (chain 84532).

**Spec:** `docs/specs/2026-10-02-mro-daily-question-design.md` (section 11
validation, the 2026-10-03 amendments); `warden/DEPLOY.md` section 11 (the
redeploy order); `docs/plans/2026-09-30-mro-rulings-roadmap.md` row A.

## Global Constraints

- Plain ASCII in code, comments and docs.
- All four suites green through `~/scripts/safe-build.sh` before every commit:
  `cd contracts && forge test`; `npm test` in `tools/`, `warden/`, `client/`.
  Never pipe a gate into anything.
- `export PATH=$HOME/.foundry/bin:$PATH`; `source ~/.nvm/nvm.sh`; `/bin/grep`.
- The repository is PUBLIC: no absolute paths, session ids, real env values or
  AI attribution in tracked files or commits. The split seed and the question
  bank never enter the repo, a log or a commit. The Builder Code and the anchor
  are public by design and may appear.
- Claude never reads `warden/.env`, `contracts/.env`, `~/.mro-split/seed` or
  `~/.mro-test-wallet/wallet.key`; scripts that load them print no value.
- Every deploy script states its chain: `EXPECTED_CHAIN_ID=84532`.
- `anvil` always with `--prune-history` (the size check script already does).
- The re-create of the live Warden (`pm2 delete` + `pm2 start`) is the
  operator's step, in one script he runs. Never `pm2 restart --update-env`.
- Never push without the operator's explicit approval at that moment.

## Review Focus

1. **The deploy run without a seed, or with a zero anchor:** it refuses before
   broadcasting anything. Pinned in Task 1.
2. **A resumed or repeated deploy:** a second run deploys a fresh pair rather
   than re-writing a configured one; `--resume` is refused by the wrapper.
   Pinned in Task 1.
3. **The Warden booting against the new pair:** decoder verified AND split
   anchor present, proven by `rehearse-start.sh` before PM2 sees it. Task 6.
4. **The first night on the new pair:** the Clock reveals keys, writes the
   test token's mint with its coin flip, and its log line names the Builder
   Code. Read off the Clock log and the chain in Task 9.
5. **`verify-border` on a real Sepolia token:** every square `ok` (or
   `pending` for a day whose key is not out yet), read from chain data alone.
   Task 9.

---

### Task 1: The deploy sets the split anchor

**Files:**
- Modify: `contracts/script/DeployPlan5.s.sol` (read `SPLIT_ANCHOR`, call `setSplitAnchor`, return the pair)
- Create: `contracts/test/DeployPlan5.t.sol`
- Modify: `contracts/script/deploy-plan7.sh`, `contracts/script/deploy-mainnet.sh` (compute the anchor from the seed file; refuse `--resume`)
- Modify: `warden/DEPLOY.md` (+ `.html`): section 11 steps 3a/3b, section 10 cutover row

**Interfaces:**
- Produces: `DeployPlan5.run() returns (Renderer r, MachineReadableOnly t)`; env `SPLIT_ANCHOR` (bytes32, required, non-zero); the wrappers export it from `node ../warden/tools/split-seed.mjs anchor "${MRO_SPLIT_SEED_FILE:-$HOME/.mro-split/seed}"`.

- [ ] **Step 1: Write the failing test** `contracts/test/DeployPlan5.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployPlan5} from "../script/DeployPlan5.s.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice The deploy script, run as the deploy runs it: the pair, the ladder
/// and the split anchor in one broadcast.
contract DeployPlan5Test is Test {
    // Anvil's account 0 and 1: published, throwaway, local only.
    uint256 constant KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant WARDEN = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    bytes32 constant ANCHOR = keccak256("a test anchor");

    function setUp() public {
        vm.setEnv("EXPECTED_CHAIN_ID", vm.toString(block.chainid));
        vm.setEnv("WARDEN_ADDRESS", vm.toString(WARDEN));
        vm.setEnv("SPIKE_DEPLOYER_KEY", vm.toString(KEY));
        vm.deal(vm.addr(KEY), 10 ether);
    }

    function test_theDeploySetsTheAnchorInTheSameBroadcast() public {
        vm.setEnv("SPLIT_ANCHOR", vm.toString(ANCHOR));
        (, MachineReadableOnly t) = new DeployPlan5().run();
        assertEq(t.splitAnchor(), ANCHOR);
        assertEq(t.splitAnchorDay(), t.today());
        assertEq(t.upgradeOf(15).maxSupply, 1, "and the ladder is written");
    }

    function test_aZeroAnchorIsRefusedBeforeAnythingIsSent() public {
        vm.setEnv("SPLIT_ANCHOR", vm.toString(bytes32(0)));
        DeployPlan5 d = new DeployPlan5();
        vm.expectRevert(bytes("SPLIT_ANCHOR must be set: run warden/tools/split-seed.mjs first"));
        d.run();
    }
}
```

- [ ] **Step 2: Run, watch it fail.** `cd contracts && forge test --match-path test/DeployPlan5.t.sol -vv`. Expected: compile FAIL (`run()` returns nothing).

- [ ] **Step 3: Implement.** In `DeployPlan5.run()`: change the signature to `returns (Renderer r, MachineReadableOnly t)`; before `vm.startBroadcast`, read `bytes32 anchor = vm.envOr("SPLIT_ANCHOR", bytes32(0));` and `require(anchor != bytes32(0), "SPLIT_ANCHOR must be set: run warden/tools/split-seed.mjs first");`; after the ladder loop, `t.setSplitAnchor(anchor);`; log `console.log("anchor  "); console.logBytes32(anchor);`. One NatSpec line on the contract: "Deploy the pair, write the ladder and fix the split anchor, in one broadcast."

  In both wrappers, before `forge script`:

```bash
SEED_FILE="${MRO_SPLIT_SEED_FILE:-$HOME/.mro-split/seed}"
if [ ! -f "$SEED_FILE" ]; then
  echo "FAIL: no split seed. Make one first: node ../warden/tools/split-seed.mjs new $SEED_FILE" >&2
  exit 1
fi
SPLIT_ANCHOR=$(node ../warden/tools/split-seed.mjs anchor "$SEED_FILE" | sed -n 's/^anchor //p')
export SPLIT_ANCHOR
echo "anchor   $SPLIT_ANCHOR"
```

  and refuse a resume (a resumed broadcast would re-send `setUpgrade` and
  `setSplitAnchor` to a configured contract, which both refuse):

```bash
case " $* " in *" --resume "*) echo "FAIL: never resume a deploy; a fresh run deploys a fresh pair" >&2; exit 1;; esac
```

  `deploy-plan7.sh`'s argument check already refuses anything but `--broadcast`; add the `case` line to `deploy-mainnet.sh`, whose argument handling differs, and say in its header that the anchor comes from the seed. DEPLOY.md section 11: 3a stays (make the seed); 3b becomes "the deploy reads the anchor from it and sets it in the same broadcast; confirm with `cast call <token> "splitAnchor()(bytes32)"`". Section 10 cutover table gains: `| the split seed | ~/.mro-split/seed | it is the SEPOLIA chain's seed; move it aside (never delete it while the testnet pair is in use) and make a new one with split-seed.mjs new before deploy-mainnet.sh, which reads it |`. Re-render DEPLOY.html.

- [ ] **Step 4: Both tests pass; all four suites; commit.**

```bash
git add contracts/ warden/DEPLOY.md warden/DEPLOY.html
git commit -m "feat(deploy): the split anchor is set in the deploy's own broadcast"
```

---

### Task 2: The Builder Code

**Files:**
- Modify: `warden/src/clock/builder-code.mjs` (`BUILDER_CODE`)
- Modify: `warden/test/clock-builder-code.test.mjs`
- Modify: `warden/DEPLOY.md` (+ `.html`): the `BUILDER_CODE` cutover row says it is set

- [ ] **Step 1: Read the live docs first** (https://docs.base.org/specifications/builder-codes/overview) and confirm the suffix layout `code bytes, length byte, schema 0x00, 0x8021 x 8`. Record what you checked in the ledger.
- [ ] **Step 2: Failing test** in `clock-builder-code.test.mjs`:

```js
test("the piece's Builder Code is set, and its suffix is the one Base issued", () => {
  assert.equal(BUILDER_CODE, "bc_dfhlohlh");
  assert.equal(builderCodeSuffix(), "0x62635f6466686c6f686c680b0080218021802180218021802180218021");
});
```

  Run `cd warden && node --test test/clock-builder-code.test.mjs`; expected FAIL (`null`).
- [ ] **Step 3:** `export const BUILDER_CODE = "bc_dfhlohlh";`. Any existing test that pins `null` is updated to the issued code, each named in the ledger. DEPLOY.md's row: the code is issued and set; the row stays as a check that it survives the cutover.
- [ ] **Step 4: All four suites; commit.**

```bash
git add warden/
git commit -m "feat(clock): every write carries the piece's Builder Code"
```

---

### Task 3: The gates over A1, A2 and A3

No code. Each command's output is read and recorded in the ledger.

- [ ] `cd contracts && ~/scripts/safe-build.sh forge build --sizes` -- both contracts show positive runtime margin.
- [ ] `bash contracts/script/anvil-size-check.sh` -- non-empty code for both, a real `tokenURI` back. Then `du -sh ~/.foundry/anvil/tmp` stays small.
- [ ] The four suites through `safe-build.sh`.
- [ ] `node tools/prepublish-check.mjs` and `node ~/scripts/id-scan.mjs` -- clean.
- [ ] `git log main..plan-a --format=%B | /bin/grep -iE "co-authored|anthropic|claude"` -- no output (attribution check; its exit status is not a gate).

Expected: all pass. Any failure stops the plan here.

---

### Task 4: The Sepolia split seed

- [ ] `node warden/tools/split-seed.mjs new ~/.mro-split/seed` -- prints ONLY `anchor 0x...`. Record the anchor (public) in the ledger.
- [ ] `stat -c %a ~/.mro-split/seed` -- `600`.
- [ ] **Operator, recommended, not blocking on testnet:** copy `~/.mro-split/seed` to offline storage with WinSCP. On mainnet this step is mandatory.

---

### Task 5: Deploy on Base Sepolia

- [ ] `bash contracts/script/deployer-balance.sh` -- enough testnet ETH (the last pair cost well under 0.01). Stop if short and tell the operator.
- [ ] `bash contracts/script/deploy-plan7.sh` -- simulation: prints the chain (84532), the warden, the anchor, and the two addresses forge would create.
- [ ] `bash contracts/script/deploy-plan7.sh --broadcast` -- record renderer, token, and the deploy block (from `contracts/broadcast/DeployPlan5.s.sol/84532/run-latest.json`).
- [ ] `bash contracts/script/verify-plan7.sh <renderer> <token> 0xb919443Ecb8B73a6179a523734f2184d26fF4D7A` -- verified on Basescan and Blockscout.
- [ ] `cd warden && node tools/check-deployed-abi.mjs <token>` -- exit 0. `node tools/read-ladder.mjs <token>` -- all 15 records match.
- [ ] `cast call <token> "splitAnchor()(bytes32)" --rpc-url https://sepolia.base.org` equals the Task 4 anchor; `splitAnchorDay()` equals `today()`; `lastRevealBlock()` is 0.

---

### Task 6: Adopt and rehearse

- [ ] `bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>` -- rewrites llms.txt, the protocol doc, its HTML and skill copy, the two tools, CLAUDE.md and `DEPLOY_BLOCK[84532]`.
- [ ] `REHEARSE_OVERRIDE="MRO_CONTRACT_ADDRESS=<token>" bash warden/tools/rehearse-start.sh` -- the log shows `decoder verified against <token>` and the boot passes the split anchor check.
- [ ] All four suites; `node tools/prepublish-check.mjs`; commit on `plan-a`:

```bash
git add -A contracts/ warden/ docs/ skills/ CLAUDE.md
git commit -m "chore: adopt the A3 pair on Base Sepolia"
```

  (Check `git status` first: nothing outside those paths, nothing under `.superpowers/`.)

---

### Task 7: The switchover -- OPERATOR runs one script

Claude writes `<scratchpad>/a3-switchover.sh` and hands over ONE line:
`! bash <scratchpad>/a3-switchover.sh <token>`. The script, in order, stopping
at the first failure and printing no secret:

1. `pm2 stop mro-warden` -- nothing serves while the mirror changes.
2. `bash warden/deploy/set-contract-address.sh <token>` -- the one env edit (it backs up outside the worktree).
3. `node warden/tools/mirror-snapshot.mjs ~/backups/state.db.pre-a3.$(date -u +%Y%m%dT%H%M%SZ)`.
4. `node warden/tools/mirror-reset-chain.mjs warden/state.db --yes`.
5. `pm2 delete mro-warden && pm2 start warden/ecosystem.config.cjs && pm2 save`.
6. Wait 10 s; `pm2 describe mro-warden` status and restarts.
7. Probe the public site: `/llms.txt` contains `<token>` and `Your answers become the border`; print `LIVE OK` or `NOT LIVE -- tell Claude`.

Claude then confirms from outside: `curl` of `/llms.txt` and `/.well-known/mcp/server-card.json` through Cloudflare, and the Warden's boot lines in its log (`decoder verified`, day match). The Clock needs nothing: it reads the same env file at 00:05.

---

### Task 8: Merge, then ask to push

- [ ] `git checkout main && git merge --ff-only plan-a` (main has not moved since `ad1db7e`; if it has, STOP and report).
- [ ] The checkout stays on `main`, which is what the Warden and the Clock now run.
- [ ] **Ask the operator before pushing.** On a yes: `git push origin main` (the pre-push hook runs both guards; a finding stops the push).
- [ ] Leave `plan-a` in place until the operator says otherwise (deleting a branch is a deletion).

---

### Task 9: Prove it live

Spans two Clock nights; check in with the operator after each.

- [ ] **Day 0, after the switchover.** Test USDC: `cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e "balanceOf(address)(uint256)" 0xc1B97157DD95D94BAA9BcfC75044Bbc9238A9b3a --rpc-url https://sepolia.base.org` -- at least 1,000,000. If short, ask the operator for the faucet (one instruction).
- [ ] `bash ~/.mro-test-wallet/mro-agent.sh join --to "$(cat ~/.mro-test-wallet/address)" --expect-payto 0x000000000000000000000000000000000000dEaD --expect-amount 1000000` -- one paid mint; record the token id. `question` on the mint day is refused (the day is credited), which is the documented coin-flip day.
- [ ] **Night 1 (00:05 UTC).** From `~/logs/mro-clock.log`: `builder code bc_dfhlohlh`, a reveal sent, the mint written. On chain: `lastRevealBlock() > 0`, `splitKeysRevealed()` equals today minus the anchor day.
- [ ] **Day 1.** `mro-agent.sh question --token <id>`, then within 30 s `mro-agent.sh beat --token <id> --answer <one of them>`; the reply says `answered: true`.
- [ ] **Night 2.** `node client/src/cli.mjs verify-border <id> --contract <token>` -- square 1 (mint day) and square 2 (day 1) both `ok`, exit 0. Paste the output into the ledger.
- [ ] Update memory (`resume-checklist`, `build-status`, `warden-deployed`): the A3 pair is live, Plan A is done, E is next.

---

## Self-review

- **Roadmap row A coverage:** the size gate and strict-limit deploy (Task 3), the Sepolia redeploy (Task 5), `adopt-deployment.sh` (Task 6), `setSplitAnchor` (Tasks 1, 4, 5), re-pointing the test agent (Task 9). The question spec's section 11 live item -- `verify-border` reproduces every square of a Sepolia token from chain data alone -- is Task 9; its "FAILS on a deliberately wrong bit" half is pinned by `client/test/verify-border.test.mjs`, since a wrong bit cannot be written on chain on purpose.
- **Deferred A1 note** (a re-run of `DeployPlan5` reverts on a configured contract): closed by Task 1's resume refusal; a plain re-run deploys a fresh pair.
- **Placeholders:** `<token>`, `<renderer>`, `<deploy-block>` and `<id>` are values produced by Tasks 5 and 9, recorded in the ledger as they appear.
- **Names:** `SPLIT_ANCHOR`, `MRO_SPLIT_SEED_FILE`, `BUILDER_CODE`, `builderCodeSuffix`, `split-seed.mjs new|anchor` are used identically throughout.
