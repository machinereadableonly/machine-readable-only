# Plan G deploy: the fix sprint and the rulings, live on Base Sepolia

> After completing any operator-only step, tell Claude so it can update memory
> immediately.

## Why

The fix sprint and Plan G are built and pushed, but nothing runs them yet. The
live Warden is the 2026-10-08 process and the Clock is the copy installed on
2026-10-07. Until both run `main`, Base Sepolia is not rehearsing what mainnet
will run, so this deploy is the gate for everything after it: the Warden under
its own user (D1, DEPLOY section 13), the next Sepolia pair (D15), and the
mainnet rehearsal.

The Clock and the Warden must change together. `main` changed how requests are
signed (D16) and binds each payment to what it pays for (D17), and the Clock
re-verifies every queued row against the evidence the Warden stored with it.
DEPLOY section 12: rows queued by the old Warden carry no evidence, so the new
Clock holds them, and on Sepolia that costs those tokens a day.

## The one trade-off: when

| Window | Cost |
|---|---|
| **2026-10-11, 00:30 to 12:00 UTC (recommended)** | None. The 00:05 run empties the queue, and the test agent's daily check-in comes at 12:17, after the switch |
| Today, after 15:30 UTC | Test token 1's 12:17 check-in is already queued by the old Warden. The new Clock holds it, token 1 misses a day, its run resets, and the night reports a failure |

The installer refuses to run between 23:45 and 00:30 UTC either way.

## What is already proven (2026-10-10)

- All four suites green at `bfd25a1`.
- `rehearse-start.sh` PASS: `main`'s Warden booted against a copy of the live
  database with the new secrets (decoder, day, treasury and payment checks).
- The Clock installer's dry run passes.
- The one PM2 daemon carries group `mro`, so a delete and start keeps the
  Warden's access to `/var/lib/mro`.

## Nothing here is irreversible

Every step has a way back (below). The Clock's chain writes after the switch
are permanent, as every night's are, on testnet.

## Steps

### Before the window (Claude, today)

1. **Push `bfd25a1`** (the installer dry-run fix). Needs the operator's yes:
   it is outward-facing.
2. Write and test a helper that adds `MRO_QUESTION_BANK=/etc/mro/bank.json` to
   the Warden's settings, printing presence only, as the secrets helper did.

### In the window (2026-10-11, 00:30 to 12:00 UTC)

3. **Claude:** read the 00:05 run's log line and confirm the queue holds no
   row awaiting a write or a payment. If it does, stop and report.
4. **Claude:** re-run `rehearse-start.sh`. It must PASS.
5. **Operator:** run the bank-setting helper (one line, at the `!` prompt).
6. **Operator:** run the Clock installer in a real terminal, because `sudo`
   asks for a password and the `!` prompt cannot answer one:
   `sudo bash warden/deploy/install-clock-user.sh --commit <sha>` from the
   repository root, with the sha Claude gives. Expect a final `PASS` line.
   The timer stays enabled; the installer does not turn it off.
7. **Claude (CAUTION, live site):** restart the Warden the way DEPLOY section 5
   requires after an `ecosystem.config.cjs` change, which `46d57c4` made:
   `pm2 delete mro-warden`, `pm2 start ecosystem.config.cjs` from `warden/`,
   `pm2 save`. A few seconds of downtime.
8. **Claude:** check the site answers 200, `/mcp` answers 401 with a
   challenge, and the boot lines match the rehearsal.
9. **Claude:** run test token 1's check-in by hand through the new client, so
   the day's row is created by the new Warden. The 12:17 cron then finds the
   day already done.

### The night after (2026-10-12, 00:05 UTC)

10. **Claude:** read the Clock log: the row proved and credited, nothing held,
    nothing FAILED. Then `verify-border 1 --chain 84532`.

## The way back

- **Warden will not boot after step 7:** `pm2 logs mro-warden` names the
  missing setting. If it cannot be fixed on the spot, run the 2026-10-08 code:
  check out `8866ebc` in the checkout, `pm2 delete mro-warden`, `pm2 start
  ecosystem.config.cjs`, `pm2 save`. The settings stay as they are: the old
  code ignores `QUESTION_SECRET`, and `/etc/mro/bank.json` exists by then. Put
  the Clock back too (next item), because the two change together.
- **Clock wrong after step 6:** the installer keeps the previous code as
  `/opt/mro-clock.prev`. Disable the timer
  (`sudo systemctl disable --now mro-clock.timer`), move the previous copy
  back, enable the timer.

## Not in this plan

- D1, the Warden under its own user (DEPLOY section 13). It comes next, once
  this has run a night.
- The Renderer pass, which waits on the operator's sheet.
