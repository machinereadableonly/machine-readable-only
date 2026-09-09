#!/usr/bin/env bash
#
# install-nginx-rate-limits.sh
#
# Adds two things to the LIVE Warden vhost, in one pass, because both need the
# same root privilege and the same nginx reload:
#
#   1. Rate limits on the two unsigned registration routes, POST /keys and
#      GET /keys/nonce. Neither request can carry a signature -- registering is
#      how a caller becomes able to sign at all -- so the application has no
#      per-key budget to charge and a fresh Ed25519 keypair is free. Metering
#      them is nginx's job, and the protocol document already says so.
#
#   2. Cloudflare real_ip, so those limits meter the CALLER rather than a
#      Cloudflare edge node. Without it, $binary_remote_addr is the edge address
#      that proxied the request, and every client behind one edge shares a
#      bucket. This is only safe because the origin lock is already ON in this
#      vhost: `if ($cf_real_ip_ok = 0) { return 403; }` refuses any connection
#      that did not arrive from a Cloudflare range, so CF-Connecting-IP cannot
#      be forged by someone connecting to the box directly. Turning real_ip on
#      WITHOUT that lock would be worse than no limit, because an attacker
#      rotating the header would get a fresh bucket per request while the
#      config looked protective.
#
# The origin lock keeps working unchanged. Its map is keyed on
# $realip_remote_addr, which nginx documents as the address BEFORE any real_ip
# rewrite -- the map was written for exactly this configuration.
#
# Run it with sudo:
#
#     sudo bash warden/deploy/install-nginx-rate-limits.sh
#
# It is idempotent: run it twice and the second run reports that the config is
# already in place and changes nothing. It backs the vhost up first, tests the
# new config before activating it, rolls back automatically if the test fails,
# and PROVES the limiter fires afterwards rather than assuming it.

set -euo pipefail

VHOST=/etc/nginx/sites-available/machinereadableonly.com
DOMAIN=machinereadableonly.com
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${VHOST}.bak-${STAMP}"

# --- Preconditions ---------------------------------------------------------
# Fail loudly and early rather than half-applying anything.

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: this writes /etc/nginx and reloads nginx, so it needs root." >&2
    echo "       sudo bash warden/deploy/install-nginx-rate-limits.sh" >&2
    exit 1
fi

if [ ! -f "$VHOST" ]; then
    echo "ERROR: $VHOST does not exist. Is the site installed?" >&2
    exit 1
fi

if ! nginx -V 2>&1 | grep -q -- '--with-http_realip_module'; then
    echo "ERROR: this nginx was built without http_realip_module." >&2
    exit 1
fi

# Already done? Say so and stop. Re-running must never duplicate a zone
# declaration, which nginx rejects outright.
if grep -q 'zone=mro_keys' "$VHOST"; then
    echo "Already installed: $VHOST already declares zone=mro_keys."
    echo "Nothing to do. Verifying the live limiter anyway."
    SKIP_EDIT=1
else
    SKIP_EDIT=0
fi

if [ "$SKIP_EDIT" -eq 0 ]; then

    # --- Back up ------------------------------------------------------------
    cp -p "$VHOST" "$BACKUP"
    echo "Backed up  -> $BACKUP"

    # --- Build the new config ----------------------------------------------
    # Surgical insertion at three known anchors rather than a rewrite, so
    # certbot's managed TLS lines are left exactly as certbot wrote them.
    # python3 does the editing because the anchors need first-occurrence-only
    # handling, which is fiddly and easy to get wrong in sed.

    NEWFILE="$(mktemp)"
    trap 'rm -f "$NEWFILE"' EXIT

    python3 - "$VHOST" "$NEWFILE" <<'PYEOF'
import sys

src, dst = sys.argv[1], sys.argv[2]
text = open(src).read()

# Guard: the anchors must be present exactly as expected, or we change nothing.
if 'zone=mro_keys' in text:
    sys.exit("refusing to edit: zone=mro_keys already present")
if text.count('    location / {') != 1:
    sys.exit("refusing to edit: expected exactly one 'location / {' block")
if 'server_name machinereadableonly.com;' not in text:
    sys.exit("refusing to edit: server_name anchor not found")

# 1. File scope. sites-enabled/* is included inside http{}, which is the only
#    context limit_req_zone is valid in. 10m holds roughly 160,000 addresses.
header = '''# Rate limits for the Warden's two unsigned registration routes.
# Installed by warden/deploy/install-nginx-rate-limits.sh.
#
# 10r/m sustained with a burst of 5: an agent fleet coming up for the first
# time registers a handful of keys back to back legitimately, while a caller
# minting keypairs in a loop is held to ten a minute.
limit_req_zone $binary_remote_addr zone=mro_keys:10m rate=10r/m;

# 503 is nginx's default and means "this server is broken". A caller that has
# been throttled is not looking at a broken server; 429 tells it to slow down
# rather than to retry harder or report an outage.
limit_req_status 429;

'''

# 2. Server scope, first block only. CF-Connecting-IP is a single address set
#    by Cloudflare, not an appendable list like X-Forwarded-For, so there is
#    nothing for a client to prepend and real_ip_recursive is not needed.
#    Trusted ONLY from the Cloudflare ranges below, fetched live from
#    https://www.cloudflare.com/ips-v4 and ips-v6 on 2026-09-09 and identical
#    to the set in /etc/nginx/conf.d/cloudflare-allowlist.conf.
realip = '''
    # Trust Cloudflare's forwarded client address, so the rate limits below
    # meter the real caller instead of the edge node that proxied it. Scoped to
    # this server block on purpose: other sites on this box are not changed.
    # $realip_remote_addr keeps the pre-rewrite address, so the origin lock
    # above is unaffected.
    real_ip_header    CF-Connecting-IP;
    set_real_ip_from  173.245.48.0/20;
    set_real_ip_from  103.21.244.0/22;
    set_real_ip_from  103.22.200.0/22;
    set_real_ip_from  103.31.4.0/22;
    set_real_ip_from  141.101.64.0/18;
    set_real_ip_from  108.162.192.0/18;
    set_real_ip_from  190.93.240.0/20;
    set_real_ip_from  188.114.96.0/20;
    set_real_ip_from  197.234.240.0/22;
    set_real_ip_from  198.41.128.0/17;
    set_real_ip_from  162.158.0.0/15;
    set_real_ip_from  104.16.0.0/13;
    set_real_ip_from  104.24.0.0/14;
    set_real_ip_from  172.64.0.0/13;
    set_real_ip_from  131.0.72.0/22;
    set_real_ip_from  2400:cb00::/32;
    set_real_ip_from  2606:4700::/32;
    set_real_ip_from  2803:f800::/32;
    set_real_ip_from  2405:b500::/32;
    set_real_ip_from  2405:8100::/32;
    set_real_ip_from  2a06:98c0::/29;
    set_real_ip_from  2c0f:f248::/32;

    # Declared once at server scope and inherited by the two metered locations
    # below. The repo template says why: repeating them per location is how one
    # of them eventually goes missing from the block that needed it. The
    # existing `location / {` declares its own identical set, so nginx uses
    # those there and nothing about that block changes.
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
'''

# 3. The two metered routes. Exact-match (`=`) so no other path is caught by a
#    prefix, and they must sit BEFORE `location / {` for a human reading the
#    file -- nginx itself always prefers an exact match regardless of order.
#    They carry no proxy_set_header of their own: the block inserted above
#    declares those at server scope and these inherit them.
locations = '''    # The registration pair, metered. `burst=5 nodelay` lets a caller that has
    # been idle register a handful of keys back to back -- an agent fleet coming
    # up for the first time is a legitimate burst -- while holding the sustained
    # rate at ten a minute. Everything else -- /, /llms.txt, /t/<id>, /mcp -- is
    # deliberately NOT metered: /mcp is authenticated by signature and budgeted
    # per key inside the application, and a limit on the catch-all would meter
    # the artwork's own QR destination.
    location = /keys {
        limit_req zone=mro_keys burst=5 nodelay;
        proxy_pass http://127.0.0.1:3006;
    }

    location = /keys/nonce {
        limit_req zone=mro_keys burst=5 nodelay;
        proxy_pass http://127.0.0.1:3006;
    }

'''

# Apply, first occurrence only for the server_name anchor -- it appears in both
# the TLS block and certbot's port-80 redirect block, and only the first is ours.
text = text.replace('server_name machinereadableonly.com;',
                    'server_name machinereadableonly.com;\n' + realip, 1)

# The installed vhost carries a comment above `location / {` claiming that
# /keys and /keys/nonce are served by the catch-all. After this edit they are
# not, so the comment has to move with the config -- a comment that contradicts
# the code is a defect, not a cosmetic detail. Replace it when it is there
# verbatim, and fall back to a plain insertion when it is not.
old_catchall = ('''    # The whole piece is one upstream. /, /llms.txt, /t/<id>, /keys,
    # /keys/nonce, /mcp and the key directory are all the Warden's.
    location / {''')
new_catchall = ('''    # Everything else is one upstream: /, /llms.txt, /t/<id>, /mcp and the key
    # directory are all the Warden's. The two registration routes above are
    # matched exactly, so nothing else is caught by them.
    location / {''')

if old_catchall in text:
    text = text.replace(old_catchall, locations + new_catchall, 1)
else:
    text = text.replace('    location / {', locations + '    location / {', 1)

text = header + text

open(dst, 'w').write(text)
PYEOF

    # --- Activate, but only if nginx accepts it -----------------------------
    # Written into place first because `nginx -t` tests the real config tree,
    # not an arbitrary file. The backup makes that safe.
    cat "$NEWFILE" > "$VHOST"

    if ! nginx -t; then
        echo ""
        echo "nginx REJECTED the new config. Rolling back." >&2
        cat "$BACKUP" > "$VHOST"
        if nginx -t; then
            echo "Rolled back. The live config is unchanged and still valid." >&2
        else
            echo "ROLLBACK ALSO FAILED TO VALIDATE. Do not reload nginx." >&2
            echo "The previous config is at $BACKUP" >&2
        fi
        exit 1
    fi

    echo "nginx -t passed. Reloading."
    systemctl reload nginx
fi

# --- Prove it works --------------------------------------------------------
# Two checks. Neither trusts the reload; both measure the running server.

echo ""
echo "--- Check 1: the site still serves through Cloudflare ---"
ROOT_CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" || echo 000)"
LLMS_CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/llms.txt" || echo 000)"
echo "  /          -> $ROOT_CODE"
echo "  /llms.txt  -> $LLMS_CODE"

if [ "$ROOT_CODE" != "200" ] || [ "$LLMS_CODE" != "200" ]; then
    echo "ERROR: the site is not serving normally. Backup: $BACKUP" >&2
    exit 2
fi

# Check 2 talks to the ORIGIN directly on loopback, not through Cloudflare.
# Two reasons: no CDN cache can mask the result, and the bucket used is
# 127.0.0.1 -- which is allowlisted by the origin lock and shared with nobody --
# so this test cannot throttle a real caller.
echo ""
echo "--- Check 2: the limiter actually fires (20 rapid requests to /keys/nonce) ---"
OK=0
LIMITED=0
for _ in $(seq 1 20); do
    CODE="$(curl -sk -o /dev/null -w '%{http_code}' \
        --resolve "${DOMAIN}:443:127.0.0.1" \
        "https://${DOMAIN}/keys/nonce" || echo 000)"
    case "$CODE" in
        200) OK=$((OK + 1)) ;;
        429) LIMITED=$((LIMITED + 1)) ;;
        *)   echo "  unexpected status: $CODE" ;;
    esac
done
echo "  served 200: $OK"
echo "  throttled 429: $LIMITED"

if [ "$LIMITED" -lt 1 ]; then
    echo "" >&2
    echo "ERROR: nothing was throttled, so the limiter is NOT working." >&2
    echo "       The new config IS live. To undo it:" >&2
    echo "         sudo cp $BACKUP $VHOST && sudo nginx -t && sudo systemctl reload nginx" >&2
    exit 3
fi

echo ""
echo "DONE. Rate limits live on /keys and /keys/nonce, metering real client"
echo "addresses via CF-Connecting-IP. The 127.0.0.1 bucket used by the test"
echo "above refills at 10 a minute and affects nobody else."
if [ "$SKIP_EDIT" -eq 0 ]; then
    echo "Backup of the previous vhost: $BACKUP"
fi
