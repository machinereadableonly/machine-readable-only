# Plan: take the five unscoped credentials out of the Warden

2026-09-11. Status: APPROVED by the operator 2026-09-12, and executed.

Phase 1 results, 2026-09-12: the throwaway app showed 5 names with no filter,
5 with `filter_env: true`, and none with the list. The rehearsal booted the
real Warden on a copy of production state with the five removed: PASS, payment
ready via the testnet facilitator.

## Why this matters

The Warden is the one process in this project that faces the internet. A
review on 2026-09-05 noticed it holds five credentials it has no use for, and
nothing since has recorded fixing it. Checked today (names only, no values):
**it is still true**, for the live Warden and for all three fast-days test
processes:

    CDP_API_KEY_ID  CDP_API_KEY_SECRET  CLOUDFLARE_API_TOKEN_MRO  GH_TOKEN  GITHUB_TOKEN_MRO

They arrive because every session shell loads the operator's infra secrets file
with `set -a`, and PM2 copies the whole shell environment of whoever ran
`pm2 start` into the app. `main.mjs` removes only the Clock key.

What it costs if left: a bug that leaks the process environment (a crash
dump, an error page) would hand out a live Cloudflare token for the domain
and push access to the public repository -- neither of which the Warden
ever needs. It also blocks mainnet quietly, see the second finding.

## What the investigation found

1. **PM2's "drop everything" switch is broken in the installed version.**
   The docs say `filter_env: true` drops all inherited variables. In PM2
   7.0.1 (`lib/Common.js:182`) the code tests `filter_env.length`, which a
   boolean does not have, so `true` silently does NOTHING. The list form --
   `filter_env: ["TOKEN", ...]`, dropping any variable whose name contains a
   fragment -- does work.
2. **The shell's copy beats the Warden's own settings file.** Node's official
   docs for `--env-file`: "If the same variable is defined in the environment
   and in the file, the value from the environment takes precedence." So when
   the operator fixes the refused CDP key in the Warden's own file, the stale
   copy inherited from the shell would still win, and the fix would look like
   it failed. Removing the shell copy is a precondition for the CDP fix.
3. **PM2's saved process list (`~/.pm2/dump.pm2`, mode 600) stores all five
   in plain text** for the Warden, because `pm2 save` snapshots the
   environment. It is what `pm2 resurrect` restores after a reboot.
4. **`warden/DEPLOY.md` says PM2 "supplies only NODE_ENV and PORT".** False
   today; it supplies the whole shell.

The Warden needs none of the five on Base Sepolia. On mainnet it needs the two
CDP values, and they belong in its own settings file, which `--env-file`
already loads.

## Steps

Phase 1 -- prove the mechanism before touching the live service

1. Start a throwaway PM2 app (`mro-envprobe`, prints its own variable NAMES)
   three times: no filter, `filter_env: true`, and the list form. Expected:
   five names, five names, none. That proves both the bug and the fix on this
   box rather than from reading code. Delete the probe afterwards.
2. Rehearse the Warden booting WITHOUT the five, using
   `warden/tools/rehearse-start.sh` against a copy of production state, with
   the five removed from its environment. Expected: every boot check passes.

I stop here only if either result contradicts the plan.

Phase 2 -- the change

3. `warden/ecosystem.config.cjs`: add
   `filter_env: ["TOKEN", "SECRET", "_KEY", "PASSWORD", "CDP_", "CLOUDFLARE"]`,
   with a comment saying why the list form and never `true`.
4. A warden test that loads the ecosystem file and asserts `filter_env` is a
   LIST that removes each of the five names under PM2's substring rule. Proven
   by breaking it: set it to `true` and watch the test go red.
5. Correct `DEPLOY.md` step 5, and add the precedence rule (the shell beats
   the file) to `.claude/rules/warden.md`.
6. All four suites green and `prepublish-check` clean, then commit.

Phase 3 -- apply it to the live service

7. Restart the live Warden from the new file: `pm2 delete mro-warden`, then
   `pm2 start ecosystem.config.cjs`, then `pm2 save`. A plain restart may keep
   the old environment, so delete-and-start is the deterministic form. The
   site is down for a few seconds. The 00:05 Clock is a separate systemd
   service and is unaffected.
8. Re-run the names-only check: the Warden must show none of the five, and the
   saved list must show none for `mro-warden`. Then the site's own checks
   (`llms.txt` through Cloudflare, boot log clean).
9. The fast-days processes, per the operator's answer below.
10. File a cross-project note for the hub: every PM2 app on the box started
    from a session shell inherits the whole infra secrets file, and
    `dump.pm2` stores it in plain text. The root fix is in the session
    launcher, not in each project.
11. Update memory (the review note closed; the precedence rule in the CDP note).

## Trade-offs and what cannot be undone

- Nothing here is irreversible. The ecosystem change is one git revert; the
  PM2 restart can be redone from the old file.
- The live site is down for a few seconds in step 7.
- `pm2 save` in step 7 snapshots EVERY running PM2 process, including other
  projects' -- it records them as they are and changes nothing about them.
  If the fast-days stack is still running then, it joins the reboot list.
- The push to GitHub is separate and still needs the operator's approval.

## Decision needed from the operator

**ANSWERED 2026-09-12: switch it off.** Its files stay in `~/.mro-fast`.

**The fast-days test stack** (three processes) holds the same five. It has
done its job -- it proved the first-day fix this afternoon. Either:

- **Stop it** (recommended): `pm2 delete` the three processes. Their files
  in `~/.mro-fast` stay, so it can be restarted later, and it stays out of the
  reboot list.
- **Keep it running**: restart all three with the same filter.
