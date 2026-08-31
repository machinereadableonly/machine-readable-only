# Warden deployment runbook

This is written now so nothing is retrofitted the day a domain exists. It is
NOT applied: there is no domain yet, so none of these steps have been run.
Nothing in this file should be executed until the operator says the domain is real and
he wants to go live.

Steps marked **[the operator ONLY]** need a browser, a payment method, or a dashboard
login Claude does not have. Steps with no mark can be run by Claude once
approved for that specific run.

## 1. Register a domain -- [the operator ONLY]

Buying a domain needs a registrar account and a payment method. Once bought,
tell Claude the domain so `<domain>` placeholders in this repo's deployment
files can be filled in and `MRO_DOMAIN` set correctly everywhere it is read.

## 2. Point DNS at the VPS via Cloudflare -- [the operator ONLY]

Add the domain to Cloudflare (or, if it is already there, add the record):

- An `A` record for `<domain>` (and `www` if wanted) pointing at the VPS's
  public IP.
- Proxy status: **Proxied** (orange cloud on). See the Cloudflare settings
  section below for why.

This step needs the Cloudflare dashboard, which needs the operator's login.

## 3. Issue a TLS certificate

Once DNS has propagated and the vhost skeleton from `nginx.conf.example` is
copied into `/etc/nginx/sites-available/<domain>` with the real domain
substituted for every `<domain>` placeholder:

```
sudo certbot --nginx -d <domain>
```

This is the standard certbot nginx-plugin flow: it obtains the certificate,
writes the `ssl_certificate` / `ssl_certificate_key` paths, and can manage the
port-80-to-443 redirect. Enable the site and reload nginx first if it is not
already enabled:

```
sudo ln -s /etc/nginx/sites-available/<domain> /etc/nginx/sites-enabled/<domain>
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Create the configuration file -- [the operator ONLY]

`src/main.mjs` requires EIGHT environment variables and refuses to start,
naming the first one missing, if any is absent. They come from a
configuration file in `warden/` that is never committed and that Claude never
reads, creates or prints.

the operator creates it via WinSCP (saved site `vps`), copying `warden/.env.example` to
`warden/.env` in the same directory and filling in every value. `.env.example`
is the schema and carries a comment for each variable; it is the only
env-shaped file in git.

Then set the permissions -- a file uploaded by WinSCP arrives mode 644:

```
chmod 600 ~/projects/machine-readable-only/warden/.env
```

Claude can run that `chmod`, and can confirm the file exists and its mode with
`ls -la`, but must never display its contents.

The eight, all required: `MRO_DOMAIN`, `CHALLENGE_SECRET`, `BASE_RPC_URL`,
`MRO_CONTRACT_ADDRESS`, `MRO_CHAIN_ID`, `TREASURY_ADDRESS`,
`X402_FACILITATOR_URL` and `STATE_DB_PATH`. `PORT` is optional and `ecosystem.config.cjs` supplies it;
the bind address is NOT read from the environment at all, it is hardcoded to
127.0.0.1 in `main.mjs` so no misconfiguration anywhere can expose this port
directly.

`MRO_CHAIN_ID` must match the chain `MRO_CONTRACT_ADDRESS` is deployed on:
8453 for Base mainnet, 84532 for Base Sepolia. It is published to agents at
`mro://contract`, so a mismatch tells every caller the token lives somewhere
it does not. It ALSO decides where payment is taken -- the x402 network is
derived from it as `eip155:<chainId>`, so a price is always quoted on the
chain the token lives on and the two can never drift apart.

`X402_FACILITATOR_URL` is the service that verifies and settles USDC:

| | URL | Auth | Networks |
|---|---|---|---|
| testnet | `https://x402.org/facilitator` | none | Base Sepolia only |
| mainnet | `https://api.cdp.coinbase.com/platform/v2/x402` | CDP API key | Base mainnet |

Measured 2026-08-31, not quoted from the spec: the testnet host's `/supported`
lists `exact` on `eip155:84532` and NO mainnet, and the CDP host answers 401
without a key. The spec's `https://facilitator.x402.org` does not resolve at
all -- use the path form above.

`TREASURY_ADDRESS` receives every payment. The zero address and `0x...dEaD`
are treated as PLACEHOLDERS: the Warden starts with them on Base Sepolia and
REFUSES TO START with them on any other chain, because USDC settled to either
is unrecoverable.

Nothing here contacts the facilitator at startup. The gateway builds itself on
the first paid call, so an unreachable facilitator refuses `mint` and `upgrade`
with `payment-unavailable` and leaves the door, check-ins and status working.
The boot log still says which way it went: `warden: payment ready (...)` or
`warden: payment NOT ready`. To check a configuration before deploying it:

```
cd ~/projects/machine-readable-only/warden
node tools/x402-live-check.mjs <facilitatorUrl> <chainId> <treasuryAddress>
```

## 5. Start the Warden under PM2

From the `warden/` directory:

```
pm2 start ecosystem.config.cjs
pm2 save
```

`ecosystem.config.cjs` runs one fork-mode instance bound to `127.0.0.1:3006`
only -- nginx is the only thing that talks to it from outside. It passes
`--env-file` to the interpreter, so the file from step 4 is what configures
the process; PM2 itself supplies only `NODE_ENV` and `PORT`.

If step 4 was skipped the process will not start, and `pm2 logs mro-warden`
will name the missing variable. That is the intended behaviour: a Warden
started with no `CHALLENGE_SECRET` would issue forgeable challenges, and one
with no `MRO_DOMAIN` would pin the signature authority to the literal string
"undefined".

## 6. Close the port to the outside world

```
sudo ufw deny 3006
```

The Warden already binds loopback-only, so this is defense in depth, not the
only thing standing between 3006 and the internet -- but a UFW rule that
matches the binding is one less way a misconfiguration elsewhere could expose
it directly.

## 7. Cloudflare settings -- [the operator ONLY, dashboard]

These all need the Cloudflare dashboard.

- **Bot Fight Mode: OFF.** Bot Fight Mode runs outside Cloudflare's ruleset
  engine, so it ignores any Allow rule written for this project, and it may
  challenge the very API-shaped traffic (signed requests with no browser,
  MCP calls) this piece exists to admit. The only visitors exempt from a
  Bot Fight Mode challenge are agents enrolled in Cloudflare's Verified Bots
  programme, which is almost none of this piece's visitors -- an
  unenrolled, correctly-signed agent gets challenged exactly like an
  attacker would. Leave it off.
- **AI bot policy ("Agent" traffic): ALLOW.** This project's entire audience
  is agents; blocking or challenging that category defeats the purpose.
- **Legacy "Block AI bots" toggle: OFF.** This is the older, blunter
  predecessor to the AI bot policy above -- make sure it is not separately
  turned on and re-blocking what the policy above allows.
- **SSL/TLS mode: Full (Strict).** Requires a valid certificate on the
  origin (which step 3 provides) and validates it, rather than accepting
  any certificate or terminating TLS in plaintext to the origin.
- **Proxy status: Proxied** (orange cloud), set already in step 2 -- confirm
  it is still on before going live, since a flat/DNS-only record would
  bypass all of the above.

## 8. If a visitor's signing fails

Point them at Cloudflare's signed-agent test endpoint first, before digging
into this project's own code:

```
https://crawltest.com/cdn-cgi/web-bot-auth
```

It is Cloudflare's own diagnostic for RFC 9421 / Web Bot Auth signing and
answers "is your signature even reaching Cloudflare correctly" independently
of anything the Warden does. Ruling that out first avoids debugging this
project's admission logic for a problem that is actually upstream of it.

## 9. Verify

- `curl -sI https://<domain>/` should return the door page over HTTPS with a
  valid certificate (no `-k` needed).
- `curl -s https://<domain>/.well-known/http-message-signatures-directory`
  should return the served key directory.
- `pm2 status mro-warden` should show the process online, and
  `pm2 logs mro-warden` should show no startup errors.
- From outside the VPS, `nc -zv <vps-ip> 3006` (or equivalent) should fail to
  connect -- confirming the UFW rule and loopback binding both hold.
