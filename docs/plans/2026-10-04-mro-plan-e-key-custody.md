# Plan E: key custody

> After completing any operator-only step, tell Claude so it can update memory
> immediately.

**Why:** this is the last plan before the mainnet deploy. Ruling 1 (2026-09-30)
asked for two protections, and this plan builds both.

1. **The owner becomes a 2-of-3 Safe.** A stolen owner key can do three things
   in one transaction each, and none can be undone: `sunset()` closes the
   piece, `setRenderer` then `freezeRenderer` replaces every token's art for
   good, and `transferOwnership` hands the contract to the thief. A Safe needs
   two of three signers for each of these, so one stolen or lost device does
   nothing. The same Safe is the TREASURY, so the money gets the same
   protection.
2. **The Clock runs as its own Unix user.** Today anything running as the main
   user can read the Clock's key, and a stolen Clock key can mint out the
   collection. After this plan, only the Clock's own user can read it.

**Decided by the operator 2026-10-04:** a 2-of-3 Safe (the Ledger, the Trezor,
and a spare), acting as both owner and treasury.

**Starts after** Night 2's `verify-border` passes and `followups` is merged.
The work happens in a worktree on a branch `plan-e`.

## What was checked, live, 2026-10-04

- Safe's own config gives version **1.5.0** as the default on Base (8453) and
  Base Sepolia (84532). Both chains have Safe's transaction service running.
- Safe charges no fees. Creating a Safe costs gas, in real ETH on Base.
- A Transaction Builder file with ONE transaction executes as a plain call from
  the Safe. Two or more are wrapped in a MultiSend, which changes the hash. So
  every file this plan writes holds exactly one transaction. A raw `data` field
  is accepted, and no checksum is needed.
- **What the devices show:** a Trezor signs the Safe's transaction hash
  directly and shows that one hash. A Ledger shows two hashes (domain and
  message), and needs blind signing switched on. So the tool prints all three.
- **Safe's website disables Trezor on Base Sepolia** (enabled on mainnet). It
  also disables Safe's phone app as a signer on both Base chains. So the
  rehearsal signs with the Ledger and the spare, and the Trezor proves itself
  on the first mainnet transaction.
- USDC's `transferWithAuthorization` (what x402 payments use) has no rule
  against paying a contract address, so a Safe can be the treasury.
- The contract is `Ownable2Step`, and its handover is already tested in
  `test/MachineReadableOnly.t.sol`.

## Open question for the operator

**The spare signer.** Recommended: a third hardware wallet (a Ledger Nano S
Plus is $69 on Ledger's US shop), kept somewhere other than the other two. The
alternative is a browser wallet key (MetaMask or Rabby) on the operator's PC,
which Safe's own guidance accepts for an individual. It is cheaper, but it is a
key on a computer. The plan works either way, and Phase 2 waits for this
answer.

## What cannot be undone

- **Nothing on mainnet happens in this plan.** The mainnet Safe is created on
  deploy day, following the rewritten runbook.
- The Sepolia token's ownership moves to the Sepolia Safe in Task 8. That is
  reversible: the Safe can hand it back.
- Phase 3 moves the live mirror database. That is reversible, and the old file
  is kept until the first night on the new layout passes.
- **Two files are deleted, and approving this plan approves those deletions:**
  `contracts/script/SwapRenderer.s.sol` and
  `contracts/script/SetClockWarden.s.sol`. They sign with the deployer's hot
  key, which will no longer be the owner. The Safe tool replaces them.

## The cost

- **Emergency speed.** Swapping a stolen Clock key takes two approvals:
  roughly 10 to 20 minutes instead of 2. The runbook is rewritten around that
  time.
- **The Safe website is part of what the operator trusts** (the Bybit lesson).
  The defence is one habit, built into the tool: it computes the hash locally,
  checks it against the Safe contract's own `getTransactionHash`, and the
  operator signs only if the device shows the same hash.
- **Every Clock code change needs one sudo command from the operator**, because
  the Clock's code copy must be one the main user cannot write. That is the
  point of the separation, and its price.

## Phase 1 -- the tooling (Claude alone)

1. **The deploy hands ownership to the Safe in its own broadcast.**
   - `DeployPlan5.s.sol` reads `OWNER_ADDRESS`. It is required on 8453 and
     optional on Sepolia. As the broadcast's last call, after `setUpgrade` and
     `setSplitAnchor` (both owner-only), it calls `transferOwnership(owner)`.
   - It refuses an owner with no code on chain, because a Safe is a contract,
     so a typed EOA or a typo is caught before the send. `Ownable2Step` is the
     second net: a wrong pending owner simply never accepts.
   - `deploy-mainnet.sh` takes `--owner <safe>`, EIP-55 only, like `--warden`.
   - Test first: after the script, `pendingOwner` is the Safe and `owner` is
     still the deployer.

2. **`warden/tools/safe-tx.mjs`: one owner action, as one Safe transaction.**
   - Actions: `accept-ownership`, `set-warden`, `set-renderer`,
     `set-supply-cap`, `pause`, `unpause`.
   - It reads the chain first:
     - the Safe's threshold, owners and nonce;
     - the contract's `owner` and `pendingOwner`;
     - an `eth_call` of the action FROM the Safe, so a call that would revert
       never reaches a device.
   - It writes a one-transaction Transaction Builder file to a directory
     outside the repository.
   - It prints the Safe transaction hash (for the Trezor) and the domain and
     message hashes (for the Ledger). Each is computed locally AND read from
     the Safe's own `getTransactionHash`. If they differ, it refuses.
   - Tests first: the EIP-712 encoding pinned to a vector, a refusal when the
     Safe is not the owner, a refusal on a reverting simulation, and a refusal
     on a hash mismatch.

3. **The scripts that signed as the owner go.** `swap-renderer.sh` and DEPLOY.md
   section 9b call `safe-tx.mjs`. `SwapRenderer.s.sol` and
   `SetClockWarden.s.sol` are deleted (listed above).

4. **The fork rehearsal runs a REAL Safe.** On the mainnet fork it:
   - creates a 2-of-3 Safe from the canonical 1.5.0 factory, with three test
     keys;
   - deploys with `--owner` that Safe;
   - builds `accept-ownership` and `set-warden` with `safe-tx.mjs`;
   - signs each with two test keys and executes it through `execTransaction`;
   - checks `owner()` and `warden()` from the chain.

   This proves the tool's hash against Safe's real contracts, end to end.

5. **The runbook.**
   - DEPLOY.md section 10 gains:
     - "create the Safe" (the operator, with each device);
     - `--owner`;
     - the accept-ownership step, signed with the Ledger AND the Trezor (the
       Trezor's first real signature);
     - `TREASURY_ADDRESS` set to the Safe.
   - Section 9b is rewritten as a timed Safe procedure.
   - Section 11 swaps the renderer through the Safe.
   - DEPLOY.html is re-rendered.

6. **Gates:** all four suites, the size gate, the fork rehearsal at 0 FAILs,
   the publish guard. Commit on `plan-e`.

## Phase 2 -- the Sepolia rehearsal with the real devices

7. **[OPERATOR] Create a 2-of-3 Safe on Base Sepolia** at app.safe.global,
   following the steps Claude gives one at a time. The owners are the Ledger,
   the spare, and the Trezor's address (added by address, since the website
   cannot connect a Trezor on Sepolia). Threshold 2. No modules, no recovery,
   no spending limits: each is a second way into the Safe.

8. **Hand the live Sepolia token to the Safe.**
   - Claude sends `transferOwnership(safe)` from the deployer key (testnet
     gas).
   - The operator imports the `accept-ownership` file, checks the hash on the
     Ledger against the one the tool printed, and signs with the Ledger and
     the spare.
   - Claude confirms `owner()` from the chain.

9. **The emergency drill, timed.** The same path as a Clock-key rotation, using
   a harmless call: `set-supply-cap` to its current value. It runs from
   "Claude prints the file" to "mined", and the time is written into section
   9b.

## Phase 3 -- the Clock under its own user

10. **[OPERATOR, one sudo command] Create the user and prove the shared database
    first.** A script Claude writes:
    - creates the group `mro` and the system user `mro-clock`;
    - adds the main user to `mro`;
    - makes `/var/lib/mro` (setgid, group `mro`, mode 2770);
    - then, as each user in turn, writes to one test SQLite database in WAL
      mode, including its `-wal` and `-shm` side files, and prints PASS or
      FAIL.

    **If it fails, stop and re-plan.** Whether two users can share a WAL
    database is the one assumption here that has not been measured.

11. **The installer** (`warden/deploy/install-clock-user.sh`, run with sudo,
    re-runnable after every Clock code change):
    - copies the code to `/opt/mro-clock` (owned by root, so neither the main
      user nor the Clock can change it);
    - copies a Node binary the Clock can run;
    - moves the split seed, and `CLOCK_PRIVATE_KEY` out of `warden/.env`, into
      `/etc/mro-clock/clock.env` (mode 600, owned by `mro-clock`). Neither
      value is ever printed;
    - makes the question bank readable by the group;
    - installs system units with `User=mro-clock` and the current hardening.
      They are installed DISABLED.

12. **The cutover on the live Sepolia piece:**
    - stop the Warden briefly;
    - move `state.db` and its cursor and lock to `/var/lib/mro`;
    - the operator updates `STATE_DB_PATH`;
    - re-create the Warden;
    - disable the old user timer and enable the system timer.

    Checks:
    - the next 00:05 run succeeds;
    - `test -r` as the main user shows the Clock's file is NOT readable, which
      checks access without reading it;
    - the operator removes the old `CLOCK_PRIVATE_KEY` line from `warden/.env`.

13. **Docs and memory:**
    - DEPLOY.md gets the new layout and the sudo step for code updates;
    - the Warden's and Clock's `.env.example` files are split;
    - update the `warden-deployed` and `clock-timer-installed` memories.

## Phase 4 -- review and merge

14. A fresh reviewer goes over the branch, and its findings are fixed. All four
    suites pass, then the commits. Merge to `main` and push only with the
    operator's approval.

Phases 1, 2 and 3 each end with a summary and a check-in, because each can
change the next: Phase 2 tests Phase 1's tool on real devices, and Phase 3
starts with a test that can stop it.
