#!/bin/bash
# Refuse origin connections that did not come through Cloudflare.
#
#     sudo bash ~/projects/machine-readable-only/warden/deploy/enable-origin-lock.sh
#
# This is the same lock the other sites on this box use. It relies on the
# global map in /etc/nginx/conf.d/cloudflare-allowlist.conf, which sets
# $cf_real_ip_ok to 1 when the ORIGINAL connecting address is a Cloudflare
# range or localhost, and 0 otherwise.
#
# ORDER MATTERS. Run this only when the Cloudflare proxy is ON (orange cloud).
# With the proxy off, every request arrives from a non-Cloudflare address and
# the origin returns 403 to everything -- which looks exactly like a broken
# deploy, and 127.0.0.1 being allowlisted means local checks keep passing and
# hide it. This script checks the proxy state before it touches anything.
#
# IT LOCKS THE TLS BLOCK ONLY, DELIBERATELY. The port-80 block must stay open:
# certbot renews over HTTP-01 on port 80, and a locked port 80 would make
# renewal fail silently about sixty days from now, long after anyone connects
# the two events.
set -euo pipefail

DOMAIN="${MRO_DEPLOY_DOMAIN:-machinereadableonly.com}"
SITE="/etc/nginx/sites-available/${DOMAIN}"
COMMENTED='#   if ($cf_real_ip_ok = 0) { return 403; }'
ACTIVE='if ($cf_real_ip_ok = 0) { return 403; }'

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo"
[ -f "$SITE" ] || die "no vhost at $SITE -- run install-warden-site.sh first"
[ -f /etc/nginx/conf.d/cloudflare-allowlist.conf ] \
  || die "the \$cf_real_ip_ok map is not installed on this box"

say "1. is the Cloudflare proxy actually ON?"
# If the name resolves to this machine, the record is grey and the lock would
# take the site down. Cloudflare's proxy IPs are never this host's own address.
MYIP="$(ip -4 addr show scope global | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
echo "   $DOMAIN resolves to ${RESOLVED:-nothing}; this host is $MYIP"
[ "$RESOLVED" = "$MYIP" ] && die "the record is still grey (DNS-only). Turn the Cloudflare proxy ON first, or this locks everyone out."

say "2. already locked?"
if /bin/grep -qF "$ACTIVE" "$SITE" && ! /bin/grep -qF "$COMMENTED" "$SITE"; then
  echo "   already enabled, nothing to do"; exit 0
fi
/bin/grep -qF "$COMMENTED" "$SITE" || die "the commented lock line is not in $SITE -- refusing to guess where it belongs"

say "3. back up and uncomment"
BACKUP="${SITE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$SITE" "$BACKUP"
echo "   backup: $BACKUP"

# Replace only the commented form, leaving the leading indentation intact.
# The port-80 block has no such line, so this cannot touch it.
python3 - "$SITE" "$COMMENTED" "$ACTIVE" <<'PY'
import sys
path, commented, active = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if text.count(commented) != 1:
    sys.exit(f"expected exactly one commented lock line, found {text.count(commented)}")
open(path, "w").write(text.replace(commented, active))
PY
echo "   uncommented"

say "4. test, and roll back if it does not hold"
if ! nginx -t; then
  cp -p "$BACKUP" "$SITE"
  die "nginx rejected the change -- restored the backup, nothing was reloaded"
fi
systemctl reload nginx
echo "   reloaded"

say "5. verify"
# Both checks are ASSERTED, and both can roll back. An earlier version of this
# script checked only the Cloudflare side and printed DONE regardless of the
# direct result -- so on 2026-09-03 it reported the origin locked while the
# direct check had plainly returned 200.
#
# It polls because `systemctl reload` returns before the new workers have taken
# over, and the first probe raced that swap: it read 200 from a worker still
# running the old config, which looks identical to a lock that does not work.
probe_direct() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "${DOMAIN}:443:${MYIP}" "https://${DOMAIN}/" || true
}

DIRECT=""
for attempt in 1 2 3 4 5 6; do
  DIRECT="$(probe_direct)"
  [ "$DIRECT" = "403" ] && break
  echo "   direct probe $attempt: $DIRECT (waiting for the reload to take effect)"
  sleep 2
done

VIA_CF="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/" || true)"
echo "   through Cloudflare      : $VIA_CF  (want 200)"
echo "   direct to the origin IP : $DIRECT  (want 403)"

rollback() {
  cp -p "$BACKUP" "$SITE"
  nginx -t && systemctl reload nginx
  die "$1 -- rolled back"
}

[ "$VIA_CF" = "200" ] || rollback "the site stopped answering through Cloudflare"
[ "$DIRECT" = "403" ] || rollback "the origin still answers direct connections ($DIRECT), so the lock is NOT in force"

cat <<EOF

DONE. Both checks passed: 200 through Cloudflare, 403 direct to the origin.

  backup: $BACKUP

To undo, re-comment the line in $SITE and reload nginx, or restore the backup.
EOF
