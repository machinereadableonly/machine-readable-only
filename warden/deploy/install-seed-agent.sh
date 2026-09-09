#!/usr/bin/env bash
#
# Install the seed agent: C4.5.
#
# The seed agent is the operator's own returning agent. Without it the
# collection is a set of identical tokens that never change; with it there is
# one token visibly coming back every day, and its check-in doubles as the
# daily proof that the Clock's 00:05 write landed -- which is read off a log by
# hand today.
#
# WHAT THIS DOES NOT DO: it does not mint token #1, and it does not enable the
# timer. Minting is a real-funds action on mainnet and is the operator's gate; a timer
# beating a token that does not exist yet would fail every day and teach
# everyone to ignore it. This installs the machinery, proves it works, and
# stops. `warden/DEPLOY.md` carries the deploy-day procedure that finishes it.
#
# It needs no root and spends nothing. The one thing it changes outside this
# box is registering the seed agent's public key at the door -- free, the same
# path every other agent takes, and forgotten after 30 days if unused.
#
# Safe to re-run: it never overwrites an existing identity or config.
#
#     bash warden/deploy/install-seed-agent.sh

set -euo pipefail

REPO_WARDEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$REPO_WARDEN/.." && pwd)"
CLIENT="$REPO_ROOT/client"
NODE="$HOME/.nvm/versions/node/v24.14.1/bin/node"

UNIT_SRC="$REPO_WARDEN/deploy/mro-seed.service"
TIMER_SRC="$REPO_WARDEN/deploy/mro-seed.timer"
ENV_TEMPLATE="$REPO_WARDEN/deploy/mro-seed.env.example"
ROTATE_TEMPLATE="$REPO_WARDEN/deploy/mro-seed-logrotate.conf.example"

UNIT_DIR="$HOME/.config/systemd/user"
MRO_DIR="$HOME/.mro"
ENV_FILE="$MRO_DIR/seed.env"
IDENTITY="$MRO_DIR/seed-identity.jwk.json"
LOG_DIR="$HOME/logs"
LOG="$LOG_DIR/mro-seed.log"
CONF="$LOG_DIR/mro-seed-logrotate.conf"

# A token id that does not exist, used to prove the FAILURE path end to end.
# Deploy day replaces it with the real one; until then the unit has nothing
# legitimate to beat, which is why the timer stays disabled.
REHEARSAL_TOKEN=999999

fail=0
step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   OK   %s\n' "$1"; }
bad()  { printf '   FAIL %s\n' "$1"; fail=1; }

step "0. preconditions"

if [ "$(id -u)" -eq 0 ]; then
    echo "   FAIL this installs a USER unit. Run it as the owning user, not with sudo." >&2
    exit 1
fi

[ -x "$NODE" ] || { echo "   FAIL no node at $NODE" >&2; exit 1; }
ok "node at $NODE"

[ -f "$CLIENT/src/cli.mjs" ] || { echo "   FAIL no client checkout at $CLIENT" >&2; exit 1; }
ok "client checkout present"

# Without linger the user manager is torn down at logout and NO user timer ever
# fires. It was the precondition nobody had recorded when the Clock's timer went
# in, so it is checked rather than assumed here.
if [ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null)" = "yes" ]; then
    ok "linger is enabled, so user timers survive logout"
else
    bad "linger is OFF. Without it this timer will never fire. Fix with: loginctl enable-linger $USER"
fi

step "1. the identity, outside the worktree"
mkdir -p "$MRO_DIR"
chmod 700 "$MRO_DIR"
if [ -f "$IDENTITY" ]; then
    ok "identity already exists; left untouched"
else
    ok "no identity yet; creating one"
fi
# Created through the client's OWN code, not a reimplementation of it, so the
# key format cannot drift from what the client expects to load.
( cd "$CLIENT" && "$NODE" -e '
  import("./src/keys.mjs").then(async (keys) => {
    const path = process.argv[1];
    const { identity } = await keys.ensureIdentity(path);
    console.log("   OK   key id " + identity.keyId);
  });' "$IDENTITY" )
chmod 600 "$IDENTITY"
ok "$IDENTITY is mode $(stat -c%a "$IDENTITY")"

step "2. register that key at the door"
# Registration is idempotent, free, and exactly what the piece invites every
# other agent to do. It is needed BEFORE the rehearsal below, because an
# unregistered key is refused at the door and exits 1 -- which would prove the
# wrong thing. Measured 2026-09-09: unregistered exits 1, registered but no
# such token exits 2.
SITE="$(grep -E '^MRO_SEED_SITE=' "$ENV_TEMPLATE" | head -1 | cut -d= -f2-)"
( cd "$CLIENT" && "$NODE" -e '
  Promise.all([import("./src/keys.mjs"), import("./src/door.mjs")]).then(async ([keys, door]) => {
    const { identity } = await keys.ensureIdentity(process.argv[1]);
    await door.registerKey({ origin: process.argv[2], privateJwk: identity.privateJwk });
    console.log("   OK   registered at " + process.argv[2]);
  });' "$IDENTITY" "$SITE" )

step "3. the runtime config"
if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE already exists; left untouched"
else
    # Written from the tracked template so the schema has one home, with the
    # token replaced by one that does not exist. Deploy day sets the real id.
    sed "s/^MRO_SEED_TOKEN=.*/MRO_SEED_TOKEN=$REHEARSAL_TOKEN/" "$ENV_TEMPLATE" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "wrote $ENV_FILE with the rehearsal token $REHEARSAL_TOKEN"
fi

step "4. the rotation config"
mkdir -p "$LOG_DIR"
sed "s#__LOG_DIR__#$LOG_DIR#" "$ROTATE_TEMPLATE" > "$CONF"
chmod 600 "$CONF"
ok "wrote $CONF"
if [ -f "$LOG" ]; then
    chmod 600 "$LOG"
    ok "$LOG is now mode $(stat -c%a "$LOG")"
else
    ok "no log yet; UMask will create it 0600"
fi

step "5. install the unit and timer"
mkdir -p "$UNIT_DIR"
cp "$UNIT_SRC" "$UNIT_DIR/mro-seed.service"
cp "$TIMER_SRC" "$UNIT_DIR/mro-seed.timer"
systemctl --user daemon-reload
ok "installed and daemon reloaded"
for u in "$UNIT_DIR/mro-seed.service" "$UNIT_DIR/mro-seed.timer"; do
    if systemd-analyze --user verify "$u" 2>&1 | grep -q .; then
        systemd-analyze --user verify "$u" || true
        bad "systemd-analyze verify had something to say about $(basename "$u") (above)"
    else
        ok "systemd-analyze verify clean: $(basename "$u")"
    fi
done

step "6. PROVE the sandbox directives work in a user unit here"
# This project has already been bitten by a directive that cannot work
# unprivileged (ProtectKernelModules, 623f9a5), and systemd fails the WHOLE
# unit at 218/CAPABILITIES rather than degrading -- so an unverified directive
# is a timer that never runs.
probe="$LOG_DIR/.seed-umask-probe.$$"
rm -f "$probe"
systemd-run --user --quiet --wait --collect \
    -p UMask=0077 -p ProtectSystem=strict -p ProtectHome=read-only \
    -p ReadWritePaths="$LOG_DIR" -p SystemCallFilter='~@module' \
    /bin/sh -c "echo probe > $probe"
if [ -f "$probe" ] && [ "$(stat -c%a "$probe")" = "600" ]; then
    ok "a file created under the unit's directives is mode 600"
else
    bad "expected mode 600, got $(stat -c%a "$probe" 2>/dev/null || echo 'no file')"
fi
rm -f "$probe"

step "7. THE REHEARSAL -- does a refusal actually reach systemd?"
# This is the check the whole installer exists for. The alarm being depended on
# is "the unit failed", so the thing to prove is that a REFUSAL BY THE SITE --
# not a crash, not a network error -- surfaces as a failed unit.
#
# It runs the REAL unit, not a hand-written imitation of it, so a directive that
# breaks the run is caught here rather than at 12:00 UTC in a log nobody reads.
# The env file currently names a token that does not exist, which is exactly the
# refusal being rehearsed.
systemctl --user reset-failed mro-seed.service 2>/dev/null || true
systemctl --user start mro-seed.service 2>/dev/null || true

RESULT="$(systemctl --user show mro-seed.service -p Result --value)"
STATUS="$(systemctl --user show mro-seed.service -p ExecMainStatus --value)"
CURRENT_TOKEN="$(grep -E '^MRO_SEED_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"

echo "   Result=$RESULT  ExecMainStatus=$STATUS  (token $CURRENT_TOKEN)"

if [ "$CURRENT_TOKEN" = "$REHEARSAL_TOKEN" ]; then
    if [ "$RESULT" = "exit-code" ] && [ "$STATUS" = "2" ]; then
        ok "a refusal by the site reaches systemd as a FAILED unit (status 2)"
    elif [ "$STATUS" = "1" ]; then
        bad "status 1 means the client THREW rather than being refused -- usually an unregistered key or an unreachable site. Read: tail -20 $LOG"
    else
        bad "expected Result=exit-code and status 2; a passing run here would mean token $REHEARSAL_TOKEN somehow exists"
    fi
else
    ok "token is $CURRENT_TOKEN, not the rehearsal id -- deploy day has happened"
    if [ "$RESULT" = "success" ]; then
        ok "the real check-in SUCCEEDED"
    else
        bad "the real check-in failed: Result=$RESULT status=$STATUS. Read: tail -20 $LOG"
    fi
fi

step "8. the timer is installed and DELIBERATELY NOT ENABLED"
systemctl --user list-timers mro-seed.timer --no-pager || true
if systemctl --user is-enabled mro-seed.timer >/dev/null 2>&1; then
    ok "the timer is ENABLED -- deploy day has happened"
else
    ok "installed, not enabled. Nothing runs on a schedule yet, which is correct"
    echo "        while token #1 does not exist. DEPLOY.md enables it after the mint."
fi

printf '\n'
if [ "$fail" = 0 ]; then
    echo "ALL CHECKS PASSED. Nothing was minted and nothing was spent."
    echo ""
    echo "What is left, and it is the operator's call, not this script's:"
    echo "  1. mint token #1 from a wallet you control (real funds on mainnet)"
    echo "  2. put its id in $ENV_FILE"
    echo "  3. systemctl --user enable --now mro-seed.timer"
    echo "  4. re-run this script; step 7 then checks the REAL check-in instead"
    echo "See the deploy-day section of warden/DEPLOY.md for the ordered version."
else
    echo "SOMETHING FAILED ABOVE -- tell Claude what it said before enabling the timer."
    exit 1
fi
