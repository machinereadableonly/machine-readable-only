#!/usr/bin/env bash
#
# Proves whether nginx real_ip is rewriting the client address for
# machinereadableonly.com.
#
# Run it after install-nginx-rate-limits.sh, and after any change to this site's
# vhost or to Cloudflare's proxy setting:
#
#     sudo bash warden/deploy/check-real-ip.sh
#
# WHY THIS EXISTS SEPARATELY from the installer's own checks. The installer
# proves the rate limit fires by hammering the origin over loopback, and that
# test CANNOT see real_ip at all: 127.0.0.1 is not in set_real_ip_from, so a
# loopback request looks identical whether the rewrite happened or not. Without
# this check, a silently inactive real_ip leaves a limit that buckets by
# Cloudflare edge node while every visible signal says it works.
#
# A FIRST VERSION OF THIS CHECK REPORTED A FALSE FAIL, which is why the verdict
# is shaped the way it is. It compared the logged address against this box's
# IPv4 egress address, but the request went out over IPv6 -- the domain has AAAA
# records and curl prefers v6 -- so Cloudflare forwarded the box's v6 address
# and the comparison could never match, whatever nginx did. A test that can only
# fail is as useless as one that can only pass. Do not reintroduce an
# equality-to-egress comparison here.
#
# The verdict here does not depend on knowing the caller's address at all. It
# asks the question that actually matters: is the address nginx recorded inside
# a Cloudflare range?
#
#   inside a Cloudflare range  -> real_ip did NOT apply. nginx is still seeing
#                                 the edge node, so the /keys limits bucket by
#                                 edge rather than by caller.
#   outside every CF range     -> real_ip IS applying. nginx recorded a real
#                                 client address.
#
# It sends one marked request over each address family, so a result that holds
# for v4 but not v6 (or the reverse) is visible rather than averaged away.
#
# Prints classifications only. No address is printed or written anywhere.

set -uo pipefail

LOG=/var/log/nginx/access.log
DOMAIN=machinereadableonly.com

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: the nginx access log is root:adm 640, so this needs sudo." >&2
    exit 1
fi

if [ ! -r "$LOG" ]; then
    echo "ERROR: cannot read $LOG" >&2
    exit 1
fi

# One marked request per family. A family the box cannot use is reported as
# skipped rather than counted as a pass.
MARK4="realipv4check$(date +%s)$$"
MARK6="realipv6check$(date +%s)$$"

CODE4="$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 15 \
    "https://${DOMAIN}/llms.txt?${MARK4}" || echo 000)"
CODE6="$(curl -6 -s -o /dev/null -w '%{http_code}' --max-time 15 \
    "https://${DOMAIN}/llms.txt?${MARK6}" || echo 000)"

echo "marked request over IPv4: HTTP $CODE4"
echo "marked request over IPv6: HTTP $CODE6"

# nginx buffers; give the lines a moment to flush.
sleep 3

# Combined log format puts $remote_addr first.
ADDR4="$(/bin/grep -F "$MARK4" "$LOG" 2>/dev/null | tail -1 | awk '{print $1}')"
ADDR6="$(/bin/grep -F "$MARK6" "$LOG" 2>/dev/null | tail -1 | awk '{print $1}')"

# Cloudflare's published ranges, the same set the origin allowlist map carries.
python3 - "$ADDR4" "$ADDR6" "$CODE4" "$CODE6" <<'PYEOF'
import ipaddress, sys

addr4, addr6, code4, code6 = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

CF = [ipaddress.ip_network(n) for n in """
173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22
141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20
197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13
104.24.0.0/14 172.64.0.0/13 131.0.72.0/22
2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32
2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
""".split()]

def classify(addr, code, family):
    if code != "200":
        return None, f"  {family}: SKIPPED -- the marked request returned {code}, not 200."
    if not addr:
        return None, f"  {family}: INCONCLUSIVE -- the marked request is not in the log yet."
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return None, f"  {family}: INCONCLUSIVE -- the logged field is not an address."
    if any(ip in net for net in CF):
        return False, f"  {family}: FAIL -- nginx logged a Cloudflare edge address."
    return True, f"  {family}: PASS -- nginx logged an address outside every Cloudflare range."

print("")
print("Verdict, by address family:")
ok4, msg4 = classify(addr4, code4, "IPv4")
ok6, msg6 = classify(addr6, code6, "IPv6")
print(msg4)
print(msg6)

results = [r for r in (ok4, ok6) if r is not None]
print("")
if not results:
    print("INCONCLUSIVE: neither family produced a usable result.")
    sys.exit(2)
if all(results):
    print("real_ip IS active. The /keys limits meter real callers.")
    sys.exit(0)
if not any(results):
    print("real_ip is NOT active. The /keys limits still bucket by Cloudflare")
    print("edge node -- the limit works, but it is the weaker version.")
    sys.exit(3)
print("MIXED: real_ip applies on one address family but not the other.")
sys.exit(4)
PYEOF
