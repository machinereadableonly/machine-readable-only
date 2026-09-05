# Warden deployment runbook

Steps marked **[the operator ONLY]** need a browser, a payment method, or a dashboard
login Claude does not have. Steps with no mark can be run by Claude once
approved for that specific run.

**Claude cannot `sudo` on this box.** Permission rules deny it, including
`sudo -n true`. The root work is therefore NOT a list of commands to copy --
it is folded into one script, `deploy/install-warden-site.sh`, which the operator runs
with a single command. Plan for that rather than discovering it mid-deploy.

## 1. Register a domain -- [the operator ONLY] -- DONE 2026-09-03

`machinereadableonly.com`, at Cloudflare Registrar. One year with auto-renew,
expires 2027-09-03, registrar lock on. The reasoning, the names rejected and
the measured cost to the artwork are in
`docs/2026-09-03-mro-domain-decision.md`.

**Every QR bitmap must be re-solved against this domain before any mainnet
mint** -- a bitmap encodes its own url, so nothing solved against the
`example.com` placeholder carries over.

## 2. Point DNS at the VPS via Cloudflare

An `A` record for `<domain>` pointing at the VPS's public IP.

**Proxy status must be OFF (grey cloud) for this step, and only turned ON
after the certificate is issued.** This is the opposite of what this file said
before 2026-09-03, and the old instruction would have failed issuance:
certbot answers an HTTP-01 challenge on port 80, and behind the orange cloud
that challenge reaches Cloudflare rather than this origin. The correct order
is the one the shared VPS runbook gives:

    proxy OFF -> certbot -> (optional origin lock) -> proxy ON

Claude can do this step directly. A Cloudflare API token scoped to
`Zone / DNS / Edit` and `Zone / Zone Settings / Edit` on this single zone
lives in the infra secrets file as `CLOUDFLARE_API_TOKEN_MRO`; it cannot see
or touch any other zone. Claude reads it from a script and never prints it.
Without that token this step is [the operator ONLY] in the dashboard.

## 3. Install the vhost and issue the certificate -- [the operator runs one command]

```
sudo bash ~/projects/machine-readable-only/warden/deploy/install-warden-site.sh
```

That script substitutes the domain into `nginx.conf.example`, installs and
enables the site, tests and reloads nginx, runs `certbot --nginx --redirect`,
applies `ufw deny 3006`, and re-tests. It is idempotent and it checks its own
preconditions -- it refuses if the domain does not resolve, and warns if the
name resolves somewhere that is not this host, which is what an orange cloud
looks like from here.

Expect a **502 from the site until step 5 starts the Warden**. nginx is then
proxying to a port with nothing behind it. That is not a broken deploy.

### What the vhost does, and what changed

The vhost is a **pure proxy**: every route, including `/` and `/llms.txt`, is
answered by the Warden on `127.0.0.1:3006`.

It used to serve those two documents plus `/client.mjs`, `/skill.md` and the
key directory from disk under `root /srv/mro/warden/public`. That could never
have worked from a checkout -- nginx runs as `www-data` and the repository
sits under a `0750` home directory it cannot traverse -- and the `/srv` path
implied a copy that drifts from the repository. Both routes moved into the
Warden on 2026-09-03; `warden/test/static.test.mjs` pins them.

`/client.mjs` and `/skill.md` still 404, and llms.txt says so in plain words.
That is disclosed behaviour, not an oversight. They become real when the
client is published.

## 4. Create the configuration file -- [the operator ONLY]

**The file already exists as of 2026-09-03.** What it needed after the domain
was registered was one key changed, and there is a script for that which
prints no secret:

```
bash ~/projects/machine-readable-only/warden/deploy/set-domain.sh
```

It sets `MRO_DOMAIN`, takes a timestamped backup first, restores mode 600, and
then reports all eight required variables by NAME and presence only -- so a
missing or empty one is caught here rather than at `pm2 start`. It echoes only
the four values that are public anyway (domain, chain id, contract address,
facilitator URL) so they can be eyeballed for typos.

The rest of this section is the original reference for what each variable is.

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

`BASE_RPC_URL` became load-bearing on 2026-08-31. It was added for the rebind
re-check; every write tool now also reads the contract's own gates through it
-- `notSunset`, `whenNotPaused`, `Resting` and `WalletCap` -- because none of
them is visible to the mirror and each one reverts a queued write, two of them
after the agent has paid. When it is unreachable, `mint`, `checkin`, `upgrade`
and `seed` answer `chain-unavailable` and queue nothing. That is deliberate:
refusing costs an agent a retry, admitting costs it a payment for a transaction
that was always going to revert. A public endpoint is fine to start; if refusals
appear in the logs, that is the thing to upgrade.

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
- **Proxy status: Proxied** (orange cloud). Step 2 deliberately leaves it
  OFF so certbot can answer its challenge; this is where it gets turned back
  ON, AFTER the certificate exists. A record left grey bypasses everything
  above and exposes the origin IP directly. Claude can flip this with the
  scoped token; it is only a dashboard step if that token is absent.

### Renewal, and the one thing that could break it

The certificate renews automatically. HTTP-01 travels Let's Encrypt ->
Cloudflare -> this origin, and with the origin lock enabled it arrives from a
Cloudflare address and passes. **Verified 2026-09-03** with
`sudo certbot renew --dry-run`, which reported success for this domain and for
every other site on the box.

Three changes could break it, and each is a reason to re-run that dry-run:
turning the origin lock on or off, changing the Cloudflare proxy state, and
changing Always Use HTTPS. A renewal failure is silent until the certificate
expires.

### Optional hardening, after the proxy is back ON

The other sites on this box refuse connections that did not come through
Cloudflare, using the global map in
`/etc/nginx/conf.d/cloudflare-allowlist.conf`:

```
if ($cf_real_ip_ok = 0) { return 403; }
```

The line is present but commented out in `nginx.conf.example`. Enable it only
once the proxy is ON. Enabling it while the proxy is off makes the origin
return 403 to everything including your own checks, which looks exactly like a
broken deploy -- `127.0.0.1` is allowlisted, so local curl keeps working and
hides it. Deliberately NOT part of the first deploy: get the piece live and
verified, then harden.

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

## 9b. If the Clock's key leaks

**Read this before you need it. The response window is minutes, and every
consequence of not responding is permanent.**

A stolen Clock key cannot take money or tokens -- there are four `onlyWarden`
functions and none moves value, the Warden is not the owner, and the contract
holds no balance. What it CAN do is end the piece: mint out the whole
collection (the price is a Warden constant, not an on-chain one, so a stolen key
mints for the cost of gas), burn every registered agent's one mint against the
PUBLIC key directory, backfill every token's level and streak, and apply the
free earned Marks to close the bought side of each pair forever. None of it can
be undone; there is no burn, and neither level nor streak can be reduced.

**Rotate first, investigate second.** `setWarden` is one owner call and
`onlyWarden` reads `warden` live, so the old key is revoked the moment it mines.

    # 1. Stop the Clock, so it cannot race the rotation with a run of its own.
    systemctl --user stop mro-clock.timer mro-clock.service

    # 2. Generate a replacement. Prints only the public address.
    #    It REFUSES to overwrite, so move the old key line out of the
    #    configuration file first (WinSCP).
    bash ~/projects/machine-readable-only/scripts/make-clock-key.sh

    # 3. Point the contract at the new address. Signed by the OWNER key, not
    #    the Clock's -- on mainnet that is MAINNET_DEPLOYER_KEY. The contract
    #    and the new address are ARGUMENTS, not environment variables.
    cd ~/projects/machine-readable-only/contracts
    EXPECTED_CHAIN_ID=<8453 or 84532> \
      forge script script/SetClockWarden.s.sol:SetClockWarden \
      --sig "run(address,address)" <contract> <the new address> \
      --rpc-url <base or base_sepolia> --broadcast

    # 4. Confirm the chain agrees, from the chain and not from a log.
    cast call <contract> "warden()(address)" --rpc-url <rpc>

    # 5. Fund the new address with gas, then start the timer again.
    systemctl --user start mro-clock.timer

**Then lower `supplyCap`.** It is an owner call, needs no redeploy, and it is
the only thing that bounds the damage of the NEXT leak. A cap of 10,000 set on
day one is 10,000 free mints sitting behind one key; set it near actual demand
and raise it deliberately as the collection fills.

**What not to bother with.** There is no point pausing first -- `pause` blocks
`applyMark` but the attacker's mints are the expensive part, and rotation
revokes everything in one transaction. Do not try to out-mint the attacker.

## 10. The mainnet cutover -- [the operator APPROVAL REQUIRED, real funds]

Everything above is a Base Sepolia runbook. This section exists because that is
easy to miss: sections 1 to 9 read as "the deploy", and following them with a
mainnet chain id produces a piece that boots and cannot be used.

**Nothing here has been rehearsed.** Base Sepolia cannot exercise any of it --
its facilitator needs no key, its deploy block is already recorded, and its
treasury is allowed to be a placeholder. Each item below is a value that is
correct today and wrong the moment the chain changes.

### The values that must change together

| what | where | why it cannot be left |
|---|---|---|
| `MRO_CHAIN_ID=8453` | the configuration file | the price is quoted on the chain the token lives on; the two are one setting |
| `MRO_CONTRACT_ADDRESS` | the configuration file | the mainnet deployment's address |
| `TREASURY_ADDRESS` | the configuration file | a placeholder is REFUSED at startup off Sepolia; USDC sent to one is gone |
| `X402_FACILITATOR_URL` | the configuration file | `https://api.cdp.coinbase.com/platform/v2/x402` -- the testnet host settles only Base Sepolia |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | the configuration file | the CDP host answers 401 without them; the Warden REFUSES to start if the url is CDP's and these are unset |
| `DEPLOY_BLOCK[8453]` | `src/clock/reconcile.mjs` | the Clock REFUSES to start without it, before writing anything |
| the Clock's gas float | the warden wallet on mainnet | writes are paid in real ETH, not testnet ETH |
| every QR bitmap | re-solved | a bitmap encodes its own url; nothing solved on Sepolia carries over |
| the testnet-preview section | `public/llms.txt` | it tells agents this is a rehearsal |
| "It will be ready soon" | `public/door.html` | delete it the day the piece opens |

### Before the cutover, in this order

1. **Prove the facilitator credentials work**, because this is the one that
   fails silently in the direction of "nobody can enter":

   ```
   cd ~/projects/machine-readable-only/warden
   X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
     node tools/cdp-live-check.mjs
   ```

   It settles nothing and costs nothing -- `/supported` is a read, and CDP
   meters only onchain settlement (1,000 a month free, then $0.001). It must
   print `ACCEPTED` and list `eip155:8453 exact`.

   **Measured 2026-09-05: the CDP credentials currently on this box are
   REFUSED**, and so is a token generated by Coinbase's own SDK with the same
   key -- so the key itself needs sorting in the CDP portal before mainnet is
   possible at all.

2. **Record the deploy block.** After the mainnet contract is deployed, find the
   block it landed in and add it to `DEPLOY_BLOCK` in `src/clock/reconcile.mjs`.
   Until it is there the Clock refuses to run at all, which is deliberate: the
   alternative was doing every write and then failing on the last step, every
   night, with the mirror never learning about a `rest`, a transfer or a rebind.

3. **Re-solve every bitmap** against the real domain. See CLAUDE.md; this is not
   optional and not reversible after a mint.

4. **Restart and verify.** `pm2 restart mro-warden`, then section 9's checks,
   then confirm the boot log says `payment ready` -- on a non-Sepolia chain the
   Warden now EXITS rather than running on with payment unavailable.
