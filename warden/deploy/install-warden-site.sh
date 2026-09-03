#!/bin/bash
# Install the Warden's nginx vhost and obtain its TLS certificate.
#
# Claude cannot sudo on this box, so the root work is folded into this one
# script rather than handed over as a list of commands. Run it with sudo:
#
#     sudo bash ~/projects/machine-readable-only/warden/deploy/install-warden-site.sh
#
# Idempotent: re-running installs the same vhost, and certbot reuses an
# existing certificate rather than issuing a duplicate.
#
# PRECONDITION, checked below: the domain must already resolve to this host
# and the Cloudflare proxy must be OFF (grey cloud). certbot answers an
# HTTP-01 challenge on port 80; behind the orange cloud that challenge reaches
# Cloudflare instead of this origin and issuance fails.
set -euo pipefail

DOMAIN="${MRO_DEPLOY_DOMAIN:-machinereadableonly.com}"
PORT=3006
SITE="/etc/nginx/sites-available/${DOMAIN}"
LINK="/etc/nginx/sites-enabled/${DOMAIN}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${REPO}/nginx.conf.example"

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo"
[ -f "$TEMPLATE" ] || die "template not found at $TEMPLATE"

say "1. preconditions"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
[ -n "$RESOLVED" ] || die "$DOMAIN does not resolve. Add the A record first."
echo "   $DOMAIN resolves to $RESOLVED"

# Cloudflare's proxy IPs are 104.x / 172.67.x among others. If the name
# resolves to something that is not this machine, the challenge will not
# arrive here. Warn rather than refuse: a split-horizon resolver could be
# lying to us and not to Let's Encrypt.
MYIP="$(ip -4 addr show scope global | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)"
if [ "$RESOLVED" != "$MYIP" ]; then
  echo "   WARNING: resolves to $RESOLVED but this host is $MYIP."
  echo "   If issuance fails, the Cloudflare proxy is probably ON. Turn it OFF and retry."
fi

say "2. install the vhost"
# Substitute the domain into every <domain> placeholder.
sed "s/<domain>/${DOMAIN}/g" "$TEMPLATE" > "$SITE"
chmod 644 "$SITE"
echo "   wrote $SITE"
ln -sfn "$SITE" "$LINK"
echo "   enabled $LINK"

say "3. test and reload nginx"
nginx -t || die "nginx config test failed -- nothing was reloaded"
systemctl reload nginx
echo "   nginx reloaded"

say "4. obtain the certificate"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "   certificate already exists for ${DOMAIN}; certbot will reuse it"
fi
# Use the existing ACME account if there is one. Only when there is none does
# certbot need an address, and then it must be supplied explicitly rather than
# guessed -- an unset variable fails loudly instead of registering nothing.
if compgen -G "/etc/letsencrypt/accounts/*/directory/*" > /dev/null 2>&1; then
  EMAIL_ARGS=()
  echo "   using the existing Let's Encrypt account"
else
  : "${CERTBOT_EMAIL:?No ACME account exists yet. Re-run as: sudo CERTBOT_EMAIL=you@example.com bash $0}"
  EMAIL_ARGS=(--email "$CERTBOT_EMAIL")
  echo "   registering a new Let's Encrypt account"
fi

certbot --nginx -d "$DOMAIN" \
  --non-interactive --agree-tos --redirect \
  "${EMAIL_ARGS[@]}" || die "certbot failed -- see the output above. The vhost is installed; fix and re-run."

say "5. close the app port to the outside world"
# Defence in depth only: the Warden binds 127.0.0.1 and cannot be reached
# externally regardless. This makes the firewall agree with the binding.
if command -v ufw > /dev/null 2>&1; then
  ufw deny "$PORT" || true
  echo "   ufw deny $PORT applied"
else
  echo "   ufw not installed, skipped"
fi

say "6. re-test and reload"
nginx -t || die "nginx config test failed AFTER certbot -- site may be down"
systemctl reload nginx

cat <<EOF

DONE.

  vhost:  $SITE
  cert:   /etc/letsencrypt/live/${DOMAIN}/

Next, tell Claude this finished. Claude will:
  - flip the Cloudflare proxy back ON and set SSL/TLS to Full (Strict)
  - start the Warden under PM2
  - verify the door over HTTPS

The site will not serve the piece until the Warden is running -- until then
nginx has nothing to proxy to and will answer 502. That is expected at this
point and is not a broken deploy.
EOF
