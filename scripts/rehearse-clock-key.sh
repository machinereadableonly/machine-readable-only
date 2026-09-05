#!/usr/bin/env bash
# Rehearse scripts/make-clock-key.sh and setup-clock.sh against SCRATCH copies.
# Nothing here touches the real project's environment file.
#
# It proves four things:
#   A. Generation writes both CLOCK_PRIVATE_KEY and CLOCK_ADDRESS.
#   B. A re-run answers from CLOCK_ADDRESS and never reads the key.
#   C. A legacy file (key, no address) is backfilled correctly, via stdin.
#   D. The mode is 600 BEFORE the key is written -- proven by breaking the fix.
set -uo pipefail

# Both resolved from this script's own location, so the checkout can live
# anywhere. The scratch tree goes to a temp directory, never into the repo.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$(mktemp -d -t mro-clock-key-rehearsal-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT
PASS=0
FAIL=0

# A PUBLIC test key: foundry/anvil's published default account 0. It is not a
# secret and derives to a well-known address, which is what makes it a usable
# fixture for the backfill path.
TEST_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TEST_ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: expected '$3', got '$2'"; fi; }

# A fresh scratch project. `warden/node_modules` is symlinked so the deriving
# script can resolve viem exactly as it would in the real tree.
fresh() {
  local dir="$BASE/$1"
  rm -rf "$dir"
  mkdir -p "$dir/warden/tools"
  cp "$REPO/warden/tools/derive-address.mjs" "$dir/warden/tools/"
  ln -s "$REPO/warden/node_modules" "$dir/warden/node_modules"
  mkdir -p "$dir/scripts"
  cp "$REPO/scripts/make-clock-key.sh" "$REPO/scripts/setup-clock.sh" "$dir/scripts/"
  echo "$dir"
}

envfile() { echo "$1/warden/$(printf '.env')"; }

echo "== A. generation on a 644 file =="
D="$(fresh a)"; F="$(envfile "$D")"
printf 'MRO_DOMAIN=example.com\n' > "$F"; chmod 644 "$F"
OUT="$(MRO_PROJECT_DIR="$D" bash "$D/scripts/make-clock-key.sh" 2>&1)"
check "exit clean" "$?" "0"
check "mode after generation" "$(stat -c %a "$F")" "600"
check "CLOCK_PRIVATE_KEY written" "$(grep -c '^CLOCK_PRIVATE_KEY=' "$F")" "1"
check "CLOCK_ADDRESS written" "$(grep -c '^CLOCK_ADDRESS=' "$F")" "1"
GEN_ADDR="$(grep '^CLOCK_ADDRESS=' "$F" | cut -d= -f2-)"
GEN_KEY="$(grep '^CLOCK_PRIVATE_KEY=' "$F" | cut -d= -f2-)"
if printf '%s' "$OUT" | grep -qF "$GEN_KEY"; then bad "the key LEAKED to stdout"; else ok "no key on stdout"; fi
if printf '%s' "$OUT" | grep -qF "$GEN_ADDR"; then ok "the address is printed"; else bad "address not printed"; fi
# The generated pair must actually correspond.
check "generated address matches its key" \
  "$(printf '%s' "$GEN_KEY" | node "$D/warden/tools/derive-address.mjs")" "$GEN_ADDR"

echo "== B. re-run answers from CLOCK_ADDRESS, without touching the key =="
# Corrupt the stored key. If the re-run still prints the right address, it
# provably did not derive it from the secret.
sed -i 's/^CLOCK_PRIVATE_KEY=.*/CLOCK_PRIVATE_KEY=0xdeadbeef/' "$F"
OUT="$(MRO_PROJECT_DIR="$D" bash "$D/scripts/make-clock-key.sh" 2>&1)"
check "exit clean" "$?" "0"
if printf '%s' "$OUT" | grep -qF "$GEN_ADDR"; then ok "address answered from the recorded line"; else bad "did not print the recorded address"; fi
if printf '%s' "$OUT" | grep -q 'refusing to replace'; then ok "refuses to overwrite"; else bad "did not refuse"; fi
check "key still only written once" "$(grep -c '^CLOCK_PRIVATE_KEY=' "$F")" "1"

echo "== C. legacy file: key present, no address =="
D="$(fresh c)"; F="$(envfile "$D")"
{ printf 'MRO_DOMAIN=example.com\n'; printf 'CLOCK_PRIVATE_KEY=%s\n' "$TEST_KEY"; } > "$F"
chmod 644 "$F"
OUT="$(MRO_PROJECT_DIR="$D" bash "$D/scripts/make-clock-key.sh" 2>&1)"
check "exit clean" "$?" "0"
check "mode tightened" "$(stat -c %a "$F")" "600"
check "backfilled the right address" "$(grep '^CLOCK_ADDRESS=' "$F" | cut -d= -f2-)" "$TEST_ADDR"
if printf '%s' "$OUT" | grep -qF "$TEST_KEY"; then bad "the key LEAKED to stdout"; else ok "no key on stdout"; fi
# And the second run must now take the cheap path.
OUT2="$(MRO_PROJECT_DIR="$D" bash "$D/scripts/make-clock-key.sh" 2>&1)"
if printf '%s' "$OUT2" | grep -q 'Deriving it once'; then bad "derived a second time"; else ok "derives at most once"; fi

echo "== C2. the deriving script refuses bad input without echoing it =="
BADIN="0xnotarealkey"
OUT="$(printf '%s' "$BADIN" | node "$REPO/warden/tools/derive-address.mjs" 2>&1)"; RC=$?
check "non-zero exit on a malformed key" "$RC" "1"
if printf '%s' "$OUT" | grep -qF "$BADIN"; then bad "malformed input was echoed back"; else ok "input not echoed"; fi
OUT="$(printf '' | node "$REPO/warden/tools/derive-address.mjs" 2>&1)"; RC=$?
check "non-zero exit on empty stdin" "$RC" "1"

echo "== C3. a file carrying the names with EMPTY values still generates =="
# The failure this guards: `grep '^CLOCK_PRIVATE_KEY='` matches an empty value,
# which would refuse to generate and then derive from nothing.
D="$(fresh c3)"; F="$(envfile "$D")"
{ printf 'MRO_DOMAIN=example.com\n'; printf 'CLOCK_PRIVATE_KEY=\n'; printf 'CLOCK_ADDRESS=\n'; } > "$F"
OUT="$(MRO_PROJECT_DIR="$D" bash "$D/scripts/make-clock-key.sh" 2>&1)"
check "exit clean" "$?" "0"
if printf '%s' "$OUT" | grep -q 'refusing to replace'; then bad "treated an empty value as a key"; else ok "an empty value is not a key"; fi
check "a real key was generated" "$(grep -c '^CLOCK_PRIVATE_KEY=.' "$F")" "1"
NEWA="$(grep '^CLOCK_ADDRESS=.' "$F" | cut -d= -f2-)"
check "the generated pair matches" \
  "$(grep '^CLOCK_PRIVATE_KEY=.' "$F" | cut -d= -f2- | node "$D/warden/tools/derive-address.mjs")" "$NEWA"

echo "== C4. the schema file cannot reintroduce a duplicate name =="
for NAME in CLOCK_PRIVATE_KEY CLOCK_ADDRESS; do
  N="$(/bin/grep -c "^$NAME=" "$REPO/warden/.env.example" || true)"
  check "$NAME is not an assignable line in .env.example" "$N" "0"
done

echo "== D. the mode is 600 BEFORE the key is written (proved by breaking it) =="
# Instrument a copy: record the file's mode at the instant just before the
# append block that writes the key.
D="$(fresh d)"; F="$(envfile "$D")"
printf 'MRO_DOMAIN=example.com\n' > "$F"; chmod 644 "$F"
S="$D/scripts/make-clock-key.sh"
awk -v out="$D/mode-at-append" '
  /^# `cast wallet new` prints/ { print "stat -c %a \"$ENV_FILE\" > " out }
  { print }
' "$S" > "$S.inst" && mv "$S.inst" "$S"
MRO_PROJECT_DIR="$D" bash "$S" >/dev/null 2>&1
check "mode at the moment of the write (fixed)" "$(cat "$D/mode-at-append" 2>/dev/null)" "600"

# Now the same instrumentation with the early chmod removed -- the pre-fix
# ordering. If this does NOT come back 644, the test is not measuring anything.
D="$(fresh d2)"; F="$(envfile "$D")"
printf 'MRO_DOMAIN=example.com\n' > "$F"; chmod 644 "$F"
S="$D/scripts/make-clock-key.sh"
awk -v out="$D/mode-at-append" '
  /^chmod 600 "\$ENV_FILE"$/ { next }
  /^# `cast wallet new` prints/ { print "stat -c %a \"$ENV_FILE\" > " out }
  { print }
' "$S" > "$S.inst" && mv "$S.inst" "$S"
MRO_PROJECT_DIR="$D" bash "$S" >/dev/null 2>&1
check "mode at the moment of the write (fix removed)" "$(cat "$D/mode-at-append" 2>/dev/null)" "644"

echo "== E. setup-clock.sh creates its file owner-only =="
# Same shape: with the trailing chmod removed, the umask alone must give 600.
D="$(fresh e)"
S="$D/scripts/setup-clock.sh"
# Stop it before it generates a key -- only the creation mode is under test.
sed -i 's|^bash "\$PROJECT/scripts/make-clock-key.sh"|true|' "$S"
sed -i 's|^  chmod 600 "\$ENV_FILE"$|  true|' "$S"
MRO_PROJECT_DIR="$D" bash "$S" >/dev/null 2>&1
check "created mode with umask, no chmod (fixed)" "$(stat -c %a "$(envfile "$D")")" "600"

D="$(fresh e2)"
S="$D/scripts/setup-clock.sh"
sed -i 's|^bash "\$PROJECT/scripts/make-clock-key.sh"|true|' "$S"
sed -i 's|^  chmod 600 "\$ENV_FILE"$|  true|' "$S"
sed -i 's|^umask 077$|true|' "$S"
MRO_PROJECT_DIR="$D" bash "$S" >/dev/null 2>&1
MODE="$(stat -c %a "$(envfile "$D")")"
if [ "$MODE" = "600" ]; then bad "umask removed and still 600 -- the test measures nothing"; else ok "umask removed gives $MODE, so the fix is load-bearing"; fi

echo "== F. no private key reaches argv anywhere in the scripts =="
if /bin/grep -n 'private-key' "$REPO/scripts/make-clock-key.sh"; then
  bad "make-clock-key.sh still passes a key on the command line"
else
  ok "no --private-key argument remains"
fi

echo ""
echo "PASS $PASS   FAIL $FAIL"
[ "$FAIL" -eq 0 ]
