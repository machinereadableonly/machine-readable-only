# Warden deployment runbook

Steps marked **[OPERATOR ONLY]** need a browser, a payment method, or a dashboard
login Claude does not have. Steps with no mark can be run by Claude once
approved for that specific run.

**Claude cannot `sudo` on this box.** Permission rules deny it, including
`sudo -n true`. The root work is therefore NOT a list of commands to copy --
it is folded into one script, `deploy/install-warden-site.sh`, which the operator runs
with a single command. Plan for that rather than discovering it mid-deploy.

## 1. Register a domain -- [OPERATOR ONLY] -- DONE 2026-09-03

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
Without that token this step is [OPERATOR ONLY] in the dashboard.

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

## 4. Create the configuration file -- [OPERATOR ONLY]

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

The operator creates it via WinSCP (saved site `vps`), copying `warden/.env.example` to
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
`X402_FACILITATOR_URL` and `STATE_DB_PATH`. On Base mainnet five more are
required, and `set-domain.sh` checks them when `MRO_CHAIN_ID=8453`:
`MRO_HOUSE_KEY_ID`, `MRO_OWNER_SAFE`, `CLOCK_CHECK_RPC_URL`, `CDP_API_KEY_ID`
and `CDP_API_KEY_SECRET` (section 10). `PORT` is optional and `ecosystem.config.cjs` supplies it;
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
the process, and PM2 adds `NODE_ENV` and `PORT`.

PM2 would ALSO pass on the entire environment of the shell that ran
`pm2 start`, and Node lets a variable already in the environment win over the
same one in the file. On this box that shell carries the operator's infra
secrets, so `filter_env` in the ecosystem file drops anything named like a
credential, and the operator's personal settings (`NTFY_*`, `*_ADDRESS`) with
it. It must stay a LIST: `filter_env: true` does nothing in PM2 7.0.1.
To apply a change to the ecosystem file, `pm2 delete mro-warden`, start it
again as above, and `pm2 save` -- deleting guarantees the environment is
rebuilt from the file rather than carried over.

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

## 7. Cloudflare settings -- [OPERATOR ONLY, dashboard]

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

### Rate limits on the registration routes -- [the operator runs one command]

`POST /keys` and `GET /keys/nonce` are the only two routes a caller reaches
without a signature: registering is how an agent becomes able to sign at all.
The application therefore has no per-key budget to charge them, and minting a
fresh Ed25519 keypair is free, so the aggregate limit has to be nginx's.

```
sudo bash warden/deploy/install-nginx-rate-limits.sh
```

It needs root because it writes `/etc/nginx` and reloads nginx. It backs the
vhost up first, runs `nginx -t` before activating anything, rolls back by
itself if that test fails, and then PROVES the limiter fires by sending twenty
rapid requests to the origin over loopback and requiring at least one 429. Run
it twice and the second run changes nothing.

It installs two things together, because they are only correct together:

- `limit_req_zone` at 10 requests a minute with a burst of 5, and
  `limit_req_status 429` so a throttled caller is told to slow down rather than
  handed nginx's default 503, which reads as "this server is broken".
- Cloudflare `real_ip`, so the limit meters the CALLER rather than the edge
  node. **This half REQUIRES the origin lock above to be enabled first** -- and
  on this deployment it already is. Without the lock, `CF-Connecting-IP` can be
  set by anyone who can reach the box, and an attacker rotating it gets a fresh
  bucket per request: worse than no limit, because the config reads as though
  it protects something.

The lock keeps working unchanged, because its map is keyed on
`$realip_remote_addr` -- the address BEFORE any real_ip rewrite.

Then prove the real_ip half separately -- [the operator runs one command]:

```
sudo bash warden/deploy/check-real-ip.sh
```

The installer's own burst test cannot see real_ip. It hits the origin over
loopback, and 127.0.0.1 is not in `set_real_ip_from`, so that request looks the
same whether the rewrite happened or not. A silently inactive real_ip would
leave the limit bucketing by edge node with every visible signal saying it
worked. This check sends one marked request over each address family and asks
whether the address nginx logged falls inside a Cloudflare range: inside means
the rewrite did not happen, outside means it did. It reads the access log, which
is `root:adm` mode 640, which is the whole reason it needs sudo.

**Measured on 2026-09-09: PASS on both IPv4 and IPv6**, and the limiter measured
5 served / 15 throttled against 20 rapid requests, where the same twenty were
all served beforehand.

Not the same thing as the application's own `/mcp` budget of 60 calls a minute
per key, which has been live since the Phase 3 build and needs no sudo.

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

## 9a. The Clock's log -- [the operator runs one command]

For the user-unit Clock before section 12's cutover. After it, the log is
`/var/log/mro/clock.log` and `install-clock-user.sh` sets up its rotation.

Run once per machine, after the Clock's timer is installed:

    bash ~/projects/machine-readable-only/warden/deploy/install-clock-logging.sh

It writes the rotation config (which cannot be tracked -- logrotate expands
neither `~` nor `%h`, and a home path in a tracked file names the account),
reloads the systemd user manager so the unit's `UMask=0077` and rotation step
take effect, and PROVES both by probe rather than assuming them. It does not
run the Clock, so it touches no chain and spends nothing.

Why it exists. The unit appends to one file forever, and that file was mode
664 in a 755 directory under a 755 home -- world-readable, on a box shared with
other projects, and unrotated while the Warden's own logs are rotated by
pm2-logrotate. `BASE_RPC_URL` is free-form configuration and every managed
provider keeps its api key IN the url, so one RPC outage would have appended
that key to a file any local account could read. The text is now redacted at
source (`src/clock/redact.mjs`, measured against real viem errors) AND the file
is private; either alone is a single point of failure for a credential.

If it prints FAIL, tell Claude what it said before the next 00:05 -- the unit
tolerates a broken rotation (the `-` prefix) but then nothing rotates, and a
`UMask` that did not apply means a recreated log is world-readable again.

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
The owner is a 2-of-3 Safe, so have two signers to hand. The Sepolia drill
(a harmless `set-supply-cap`, 2026-10-06) took 2 minutes from the file being
printed to the transaction mined, with both signers already set up and no
emergency; allow 10 to 20 minutes for a real one.

    # 1. Stop the Clock, so it cannot race the rotation with a run of its own.
    #    (Before section 12's cutover: systemctl --user, no sudo.)
    sudo systemctl stop mro-clock.timer mro-clock.service

    # 2. Generate the replacement straight into the Clock's own file. Prints
    #    only the new public address; the key never touches the main user's
    #    files. It refuses while the timer is still active.
    cd ~/projects/machine-readable-only
    sudo bash warden/deploy/install-clock-user.sh --rotate-clock-key --commit "$(git rev-parse HEAD)"

    # 3. Point the contract at the new address. The OWNER is the 2-of-3 Safe,
    #    so this prepares a Safe transaction; nothing is sent here.
    cd ~/projects/machine-readable-only/warden
    node tools/safe-tx.mjs set-warden <the new address> \
      --contract <contract> --safe <the Safe> --rpc <https://mainnet.base.org or https://sepolia.base.org>

    #    At app.safe.global: Apps > Transaction Builder > drag in the file it
    #    names. Check the nonce matches. Sign with two of the three signers,
    #    and on each device compare the hash with the one the tool printed:
    #    a Trezor shows the safeTxHash, a Ledger the domain and message
    #    hashes. A different hash means a different transaction -- stop.
    #    The LEDGER SIGNS FIRST, never last: the signer who executes approves
    #    by sending, so its device shows no hash at all. Whoever executes pays
    #    the gas, so that signer needs ETH.
    #    Then execute. If the website proposes a higher nonce than the tool
    #    printed, a transaction is already queued: reject or execute it first,
    #    or set the nonce to the printed one in the advanced parameters.

    # 4. Confirm the chain agrees, from the chain and not from a log.
    cast call <contract> "warden()(address)" --rpc-url <rpc>

    # 5. Fund the new address with gas, then start the timer again.
    sudo systemctl start mro-clock.timer

**Then lower `supplyCap`** (`node tools/safe-tx.mjs set-supply-cap <n> ...`,
signed the same way). It is an owner call, needs no redeploy, and it is
the only thing that bounds the damage of the NEXT leak. A cap of 10,000 set on
day one is 10,000 free mints sitting behind one key; set it near actual demand
and raise it deliberately as the collection fills.

**The split seed sits beside the Clock key** (`/etc/mro-clock/split-seed`;
the installer refuses while a home copy remains). It cannot be rotated: the anchor is set once. A leaked
seed takes no money and writes nothing, but it publishes every future day's
answer rule, so agents could choose answers for their squares. The squares
stay verifiable; they stop being unchosen.

**What not to bother with.** There is no point pausing first -- `pause` blocks
`applyMark` but the attacker's mints are the expensive part, and rotation
revokes everything in one transaction. Do not try to out-mint the attacker.

## 9c. The seed agent -- [the operator runs one command]

The seed agent is the operator's own returning agent: the one token that is
visibly coming back every day. Without it the collection is a set of identical
tokens that never change, the daily post has no subject, and the proof that the
Clock's 00:05 write landed is read off a log by hand. It is C4.5.

```
bash warden/deploy/install-seed-agent.sh
```

No root, and it spends nothing. It creates a signing identity outside the
worktree, registers that key at the door (free, self-expiring after 30 days if
unused), writes `~/.mro/seed.env` and the rotation config, installs the unit and
timer, and then proves the machinery works.

**It does NOT mint token #1 and it does NOT enable the timer.** Minting is a
real-funds action and is the operator's gate; a timer beating a token that does not exist
yet would fail every day and teach everyone to ignore it.

### What step 7 proves, and why it is the point

The alarm this whole arrangement depends on is "the unit failed". So the thing
worth proving is not that a check-in can succeed -- it is that a **refusal by
the site** surfaces as a failed unit rather than a quiet success.

Until deploy day the config names a token that does not exist, so starting the
real unit IS that rehearsal. Measured 2026-09-09: `Result=exit-code`,
`ExecMainStatus=2`.

The distinction matters and the installer checks for it. **Status 2 means the
site refused; status 1 means the client threw** -- an unregistered key, an
unreachable site. A run that could only ever produce one of those would prove
nothing about the other. `client/src/cli.mjs` sets exit 2 deliberately for
exactly this, added in Phase 4 after every command exited 0 on a refusal and a
breaking streak looked healthy to every supervisor watching it.

### On deploy day, after the mint

1. in `~/.mro/seed.env`, put token #1's id as `MRO_SEED_TOKEN` and the door's
   opening day plus 2 as `MRO_SEED_NOT_BEFORE` (`YYYY-MM-DD`, UTC). No place
   rides on it -- the contract gives token #1 Aorta and no place (spec 10n) --
   but it keeps the project's own token from leading the run in the first days
2. `systemctl --user enable --now mro-seed.timer`
3. re-run the installer -- step 7 now reports either "the guard held" (before
   that day: the run sent nothing and exited 0) or the REAL check-in. It refuses
   the rehearsal day `2000-01-01` for a real token

The timer fires at **12:00 UTC**, deliberately far from the Clock's 00:05. The
check-in window is one UTC day wide on chain, so midday leaves twelve hours of
slack either side for a reboot, a slow run or the five minutes of jitter.

---

## 10. The mainnet cutover -- [OPERATOR APPROVAL REQUIRED, real funds]

Everything above is a Base Sepolia runbook. This section exists because that is
easy to miss: sections 1 to 9 read as "the deploy", and following them with a
mainnet chain id produces a piece that boots and cannot be used.

**REHEARSED 2026-09-15 on a fork of Base mainnet, and it now runs as one
command:**

```
~/scripts/safe-build.sh bash warden/tools/mainnet-fork-rehearsal.sh
```

It forks Base mainnet into a local, disposable chain, then runs the steps
below with the same scripts the day will run: the deploy, the read-back, the
adoption, the Warden's mainnet boot against Coinbase's facilitator, the
refusals, and the Clock writing a mint, a check-in and a Mark. It sends
nothing to a real chain. **It must exit 0 before the real cutover starts.**
Base Sepolia could exercise none of this: its facilitator needs no key, its
deploy block is already recorded, and its treasury may be a placeholder. Each
item below is a value that is correct today and wrong the moment the chain
changes.

What a fork cannot prove, and so stays a mainnet-day item: a real Coinbase
settlement (a fork's payment would settle on real mainnet), OpenSea, and the
handling of the real owner key.

### The values that must change together

| what | where | why it cannot be left |
|---|---|---|
| `MRO_CHAIN_ID=8453` | the configuration file | the price is quoted on the chain the token lives on; the two are one setting |
| `MRO_CONTRACT_ADDRESS` | the configuration file | the mainnet deployment's address |
| `TREASURY_ADDRESS` | the configuration file | the 2-of-3 Safe's address. A placeholder is REFUSED at startup off Sepolia; USDC sent to one is gone |
| `X402_FACILITATOR_URL` | the configuration file | `https://api.cdp.coinbase.com/platform/v2/x402` -- the testnet host settles only Base Sepolia |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | the configuration file | the CDP host answers 401 without them; the Warden REFUSES to start if the url is CDP's and these are unset |
| `DEPLOY_BLOCK[8453]` | `src/clock/reconcile.mjs` | the Clock REFUSES to start without it, before writing anything (proven on the fork). `adopt-deployment.sh --chain 8453` writes it and keeps the Sepolia entry |
| the mainnet Clock key | made by the installer straight into `/etc/mro-clock` (`--rotate-clock-key`, replacing the Sepolia one; step 3), which prints its address for `deploy-mainnet.sh --warden` | the contract's warden is fixed at deploy; only `setWarden` corrects it afterwards. It is never in the Warden's `.env` |
| `MRO_HOUSE_KEY_ID` | the configuration file | the operator's own agent's key id: it alone is minted as token 1, and the Warden refuses to start without it off Sepolia |
| `MRO_OWNER_SAFE` | the configuration file | the Safe that must own the contract; the Warden and the Clock refuse to start until it alone does (section 12) |
| `CLOCK_CHECK_RPC_URL` | the configuration file | a second RPC from a different provider; the Clock refuses to start on mainnet without it (section 12, decision 13) |
| `BUILDER_CODE` | `src/clock/builder-code.mjs` | Base credits the piece's on-chain activity only through this ERC-8021 suffix, and a write sent without it can never be attributed afterwards. It is SET to the issued code, `bc_dfhlohlh`, and pinned by `test/clock-builder-code.test.mjs`. **Nothing refuses to start without it**, so this row is the check that it survives the cutover; the Clock logs the code on every run |
| `verify-border`'s chain | `client/src/cli.mjs` | it defaults to Base mainnet (8453) and its public RPC, the chain SKILL.md declares, refuses an RPC serving any other chain, and prints the contract, chain and RPC host it reads. Sepolia checks pass `--chain 84532` |
| the Clock's gas float | the warden wallet on mainnet | writes are paid in real ETH, not testnet ETH |
| every QR bitmap | solved at mint, from `MRO_DOMAIN` | a bitmap encodes its own url, so nothing solved on Sepolia carries over -- but mainnet tokens are solved fresh when they are minted (`main.mjs` builds the solver from `MRO_DOMAIN`), so this row is satisfied by `MRO_DOMAIN=machinereadableonly.com`. The rehearsal solves its token against that domain |
| the testnet-preview section | `public/llms.txt` | it tells agents this is a rehearsal |
| "It will be ready soon" | `public/door.html` | delete it the day the piece opens |
| `MRO_SEED_TOKEN` | `~/.mro/seed.env` | it holds a rehearsal id that does not exist; the seed agent beats nothing until it is the real one |
| `MRO_SEED_NOT_BEFORE` | `~/.mro/seed.env` | it holds the rehearsal day `2000-01-01`; left there, token #1 checks in from its mint and races ahead of every opening-day agent. The installer refuses it once the token is real |
| the split seed | `MRO_SPLIT_SEED_FILE`, required | `~/.mro-split/seed` is the SEPOLIA chain's seed. Make mainnet's own with `split-seed.mjs new <path outside ~/.mro-split>` and pass that path; `deploy-mainnet.sh` sets its anchor in the deploy and refuses a seed inside `~/.mro-split`, one with the anchor of any `~/.mro-split/seed*`, and one with the live Sepolia pair's anchor |

### Before the cutover, in this order

0. **Run the rehearsal, and do not start until it exits 0:**

   ```
   ~/scripts/safe-build.sh bash warden/tools/mainnet-fork-rehearsal.sh
   ```

   It is the whole list below, against a disposable fork of Base mainnet, with
   the same scripts. It sends nothing to a real chain. Its report is in
   `report.txt` in the work directory it names; the 2026-09-15 run is written
   up in `docs/2026-09-15-mro-mainnet-rehearsal-report.md`.

1. **Prove the facilitator credentials work**, because this is the one that
   fails silently in the direction of "nobody can enter":

   ```
   cd ~/projects/machine-readable-only/warden
   env -u CDP_API_KEY_ID -u CDP_API_KEY_SECRET \
     X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
     node --dns-result-order=ipv4first --no-network-family-autoselection \
     --env-file=.env tools/cdp-live-check.mjs
   ```

   It settles nothing and costs nothing -- `/supported` is a read, and CDP
   meters only onchain settlement (1,000 a month free, then $0.001). It must
   print `ACCEPTED` and list `eip155:8453 exact`. The `env -u` makes it test
   the configuration file's key rather than any copy in the shell (the
   environment wins over `--env-file`), and the two flags make it take the same
   IPv4 route the Warden takes.

   **Measured 2026-09-12: the key WORKS over IPv4 and is REFUSED over IPv6**,
   three rounds each way. This box prefers IPv6 and the key's IP allowlist holds
   the IPv4 address, which is why `ecosystem.config.cjs` pins the Warden to
   IPv4. The 2026-09-05 reading -- that the key itself was bad -- never varied
   the route, and was wrong.

2. **Create the owner Safe -- [OPERATOR ONLY, real funds: a little ETH].** At
   app.safe.global, on Base: a new Safe with three signers (the Ledger, the
   Trezor, the Rabby spare) and a threshold of 2. Enable no modules, no
   recovery and no spending limits: each is a second way in. It is also the
   treasury. Write the three signer addresses down from the devices
   themselves; every later step that hands the Safe anything compares against
   that list (`--signers a,b,c`), and refuses a Safe whose signers, singleton,
   modules or guard are not what they should be.

3. **Stop the Sepolia Clock and make the mainnet Clock key -- [OPERATOR, sudo].**
   The deploy needs the new Clock's address, and the key is made straight into
   `/etc/mro-clock`, never in the Warden's settings:

   ```
   sudo systemctl stop mro-clock.timer
   cd ~/projects/machine-readable-only
   sudo bash warden/deploy/install-clock-user.sh --rotate-clock-key --commit "$(git rev-parse HEAD)"
   ```

   It prints only the new key's address. Before running it, set in the
   Warden's settings every mainnet value from the table above that is already
   known: `MRO_CHAIN_ID`, `BASE_RPC_URL`, `CLOCK_CHECK_RPC_URL`,
   `X402_FACILITATOR_URL`, the CDP pair, `TREASURY_ADDRESS`, `MRO_HOUSE_KEY_ID`
   and `MRO_OWNER_SAFE`. `MRO_CONTRACT_ADDRESS` still names Sepolia here; step 8
   changes it. The running Warden is untouched until it restarts.

4. **Deploy -- [OPERATOR APPROVAL REQUIRED, real funds, permanent].** First the
   simulation, then the send:

   ```
   cd ~/projects/machine-readable-only/contracts
   MRO_SPLIT_SEED_FILE=<mainnet's own seed> bash script/deploy-mainnet.sh --warden <step 3's address> --owner <the Safe> --signers <a,b,c>
   MRO_SPLIT_SEED_FILE=<mainnet's own seed> bash script/deploy-mainnet.sh --warden <step 3's address> --owner <the Safe> --signers <a,b,c> --broadcast
   ```

   It checks the Safe's identity, refuses a Sepolia seed, gates on
   `test/ContractSize.t.sol` and the ABI pin, broadcasts, then READS THE
   DEPLOYMENT BACK -- pending owner, warden, anchor -- and stops if any is
   wrong. It prints the token and renderer. The deploying key owns the
   contract until step 5; whoever holds it before then can take the contract
   for good (decision D2).

5. **The Safe accepts ownership, FIRST -- [OPERATOR, two signers].** Sign it with
   the Ledger AND the Trezor:

   ```
   cd ~/projects/machine-readable-only/warden
   node tools/safe-tx.mjs accept-ownership --contract <token> --safe <the Safe> --signers <a,b,c> --rpc https://mainnet.base.org
   ```

   Import the file it names in the Transaction Builder, compare the hashes on
   each device, and sign with both. The second signer UNTICKS "Execute": a
   signer who executes approves by sending, and its device shows no hash. Then
   execute from any connected owner that holds ETH. Then
   `cast call <token> "owner()(address)"` must print the Safe and
   `cast call <token> "pendingOwner()(address)"` the zero address. **Then
   delete the deploying key** (`MAINNET_DEPLOYER_KEY` in `contracts/.env`,
   WinSCP). Nothing later opens before this: the Warden, the Clock and the
   adoption all refuse a contract the Safe does not own alone.

6. **Verify the source on both explorers, then read it back, against mainnet:**

   ```
   bash script/verify-plan7.sh <renderer> <token> <step 3's address> 8453
   cd ../warden
   node tools/check-deployed-abi.mjs <token> https://mainnet.base.org
   node tools/read-ladder.mjs <token> https://mainnet.base.org
   ```

7. **Snapshot, then clear the Sepolia rows out of the mirror -- [OPERATOR].** The
   live mirror holds Sepolia's tokens, mints, credits, Marks, questions and
   signed requests; left in place, a returning agent is refused
   `already-minted` and the mainnet token 1 inherits Sepolia's question.
   Registered keys are kept. With the Warden stopped, from a shell in group
   `mro`:

   ```
   pm2 stop mro-warden
   cd ~/projects/machine-readable-only/warden
   sg mro -c 'node tools/mirror-snapshot.mjs ~/backups/state.db.pre-mainnet.$(date -u +%Y%m%dT%H%M%SZ)'
   sg mro -c 'node tools/mirror-reset-chain.mjs --yes'
   ```

   Both act on the Warden's own `STATE_DB_PATH` and refuse a relative path.

8. **Adopt it, change the contract address, rehearse the start, restart:**

   ```
   cd ~/projects/machine-readable-only
   MRO_OWNER_SAFE=<the Safe> bash contracts/script/adopt-deployment.sh --chain 8453 <renderer> <token> <deploy-block>
   ```

   The deploy block is the block of the FIRST deploy transaction (forge's
   `broadcast/DeployPlan5.s.sol/8453/run-latest.json`); until it is recorded the
   Clock refuses to run at all. Adopt refuses unless the Safe alone owns the
   contract. Then set `MRO_CONTRACT_ADDRESS=<token>` in the Warden's settings
   (WinSCP) and check them:

   ```
   bash warden/deploy/set-domain.sh machinereadableonly.com   # presence of every required value, mainnet's five included
   bash warden/tools/rehearse-start.sh                          # must print payment ready (eip155:8453 ...)
   ```

   Then re-install the Clock so it takes the new address, check the installed
   copy agrees, and start both:

   ```
   sudo bash warden/deploy/install-clock-user.sh --commit "$(git rev-parse HEAD)"
   bash warden/deploy/install-clock-user.sh --dry-run          # the Clock's settings build from the Warden's
   pm2 restart mro-warden
   sudo systemctl start mro-clock.timer
   ```

   Section 9's checks follow. On a non-Sepolia chain the Warden EXITS rather
   than running on with payment unavailable, refuses a placeholder treasury,
   and refuses to start until the Safe owns the contract alone.

9. **Mint token #1 BEFORE the door is announced -- [OPERATOR GATE, real funds].**
   This is C4.5, and it is the last step because it cannot be undone: token #1
   is the house token and only `MRO_HOUSE_KEY_ID` may be it, however many
   agents arrive first -- but it should be first, so it is minted before
   anything is announced. Mint it from a wallet the operator controls, with the
   seed agent's key, so the token is bound to it from the first block:

   ```
   cd ~/projects/machine-readable-only/client
   node src/cli.mjs join \
     --to <the address that should OWN token #1> \
     --key ~/.mro/seed-identity.jwk.json \
     --wallet-key-file <a file holding the funding wallet's key, mode 600> \
     --expect-payto <the treasury, from your own records> \
     --expect-amount 1000000 \
     --expect-asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
     --expect-network eip155:8453 \
     --expect-chain 8453 \
     --expect-contract <token>
   ```

   The key goes in a file, never on the command line, where every process on
   the box can read it. Every `--expect-*` is checked before anything is
   signed: the treasury and the amount (1 USDC in base units) are required to
   pay at all, and the asset is Base mainnet's USDC. Take the treasury from
   somewhere other than the site -- a value checked against the server that
   quoted it is not a check. The client also refuses any scheme other than
   `exact`.

   **`--to` MUST BE ABLE TO RECEIVE AN ERC-721.** The Warden refuses one with
   code that does not answer `onERC721Received` before any payment demand
   (`recipient-cannot-receive`). Use a plain wallet (`cast code <address>`
   returns `0x`) or one known to implement it.

   Then follow section 9c's three deploy-day steps, and **let it run for 48
   hours before anything is announced** -- that window is C4.6, the OpenSea
   check, and it needs a token that already exists.

10. **Confirm Base attributes the first mainnet Clock write.** After the first
    00:05 UTC run on mainnet (the one that mints token #1), take a transaction
    hash from section 9a's log and check its calldata ends with the issued
    suffix:

    ```
    cast tx <hash> input --rpc-url https://mainnet.base.org | tail -c 59
    ```

    It must print `62635f6466686c6f686c680b0080218021802180218021802180218021`
    (`bc_dfhlohlh`, length `0b`, schema `00`, the `8021` marker). Then enter the
    same hash in Base's Builder Code Validation tool, linked from
    <https://docs.base.org/specifications/builder-codes/overview>, and press
    Check Attribution. A write sent without attribution can never be attributed
    afterwards, so do this on the first night, not later.

---

## 11. Redeploying the contract pair -- [OPERATOR APPROVAL REQUIRED]

A contract change means a new address, and a new address means the Warden, the
Clock, the served copy and the skill are all pointing at a contract that no
longer exists. This is the order that gets all of them across together.

**The Warden now REFUSES TO START against a contract it cannot decode.**
`chain/preflight.mjs` decodes one real `viewOf` at boot and throws on failure.
That is deliberate, and it has a consequence worth stating plainly: from the
moment a contract change is merged until the new address is adopted, **do not
restart the live Warden.** `rehearse-start.sh` will tell you so before PM2 does.

Before the probe existed the same skew was silent: `chain/read.mjs` returns
`null` on a decode failure and `null` on an unreachable RPC, so `mint`,
`status`, `/t/<id>`, `boundKeyOf` and `freeIdFrom` would all have answered
`chain-unavailable` indefinitely, with nothing in any log to say which of the
two it was.

### The order

1. **Build, and pin the ABI against what you just built.**

   ```
   cd ~/projects/machine-readable-only/contracts
   forge build --sizes
   bash script/anvil-size-check.sh
   ```

   `forge build` is not optional housekeeping here. `warden/test/abi.test.mjs`
   compares `src/clock/abi.mjs` against `contracts/out`, and **SKIPS when
   `contracts/out` is missing** -- which it is on any clean checkout, because
   that directory is gitignored. A guard that skips is not a guard, and the
   Warden's decoder now depends on that file being fresh. `deploy-plan7.sh`
   therefore builds and then runs the pin itself, before it will deploy
   anything. If the pin fails: `cd warden && node tools/gen-abi.mjs`.

1a. **Make the split seed, once, OUTSIDE the worktree, BEFORE the deploy.**
   It is the secret end of the daily question's key chain: the Clock draws
   every answer square from it, and it is never printed, logged or committed.

   ```
   node ~/projects/machine-readable-only/warden/tools/split-seed.mjs new ~/.mro-split/seed
   ```

   It writes the seed with mode 600, refuses a file that already exists and
   any path inside the repository, and prints only `anchor 0x...`. Back the
   seed file up offline alongside the Clock key, and copy it nowhere else.
   `~/.mro-split/seed` is where the Clock looks unless `MRO_SPLIT_SEED_FILE`
   says otherwise. The deploy wrapper reads the same path and refuses to run
   without it.

2. **Simulate, then deploy.**

   ```
   bash script/deploy-plan7.sh              # simulation only
   bash script/deploy-plan7.sh --broadcast  # after the operator approves
   ```

3. **Verify the source, then verify the interface.** They are different claims.

   ```
   bash script/verify-plan7.sh <renderer> <token> <warden> 84532
   cd ../warden
   node tools/check-deployed-abi.mjs <token>   # exits non-zero on any mismatch
   node tools/read-ladder.mjs <token>          # the ten Mark records, by value
   ```

   Explorer verification proves the SOURCE compiles to that bytecode. It says
   nothing about whether the ABI in this repository describes it. On 2026-09-02
   every Mark was unwritable against a fully verified contract, and only reading
   the runtime bytecode found it.

3a. **Confirm the anchor.** The deploy read it from the seed and set it in
   its own broadcast, so no deployed contract is ever without one.

   ```
   cast call <token> "splitAnchor()(bytes32)" --rpc-url <rpc>
   ```

   It must equal the `anchor` line the deploy printed. The anchor is set ONCE
   and can never move. The Warden refuses to start against a contract with no
   anchor, and the Clock writes nothing if its seed does not hash to it. **A
   lost seed is permanent:** no later square can be written or verified, so the
   backup is not optional.

4. **Adopt the address everywhere, in one command.**

   ```
   bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>
   ```

   It rewrites `llms.txt`, the protocol document and its rendered HTML, the
   skill's byte-identical copy, the two operator tools that hardcode the
   address, `CLAUDE.md`, and `DEPLOY_BLOCK` in `src/clock/reconcile.mjs`. It
   refuses an address that is not EIP-55 checksummed.

5. **Rehearse against the NEW address before PM2 sees it.**

   ```
   REHEARSE_OVERRIDE="MRO_CONTRACT_ADDRESS=<token>" bash warden/tools/rehearse-start.sh
   ```

   A pass prints `warden: decoder verified against <token>`. Only then set
   `MRO_CONTRACT_ADDRESS` in the configuration file, back up `state.db`, and
   restart.

6. **Snapshot the mirror, then clear its chain rows.**

   ```
   cd warden
   node tools/mirror-snapshot.mjs ~/backups/state.db.pre-reset.$(date -u +%Y%m%dT%H%M%SZ)
   node tools/mirror-reset-chain.mjs --yes
   ```

   It empties `mark_orders`, `credits`, `mints`, `questions` and `tokens`, and
   KEEPS `keys`, which are door state rather than chain state. Every one of
   those rows is keyed on an id the new pair restarts at 1: left in place, a
   returning agent is told `already-minted` for a token this contract has never
   held (found by a refused mint on 2026-09-22), and a kept `questions` row
   hands the new token 1 the old one's question with an answer window that
   closed long ago.

7. **Verify through Cloudflare, not against localhost**, exactly as section 9
   says. Then check all four suites and commit.

### What this contract fixes at deploy, for good

- **The split anchor is set once (step 3b), from a seed that never leaves the
  box.** There is no setter after it: a lost seed means no square can ever be
  written or verified again, and a leaked one cannot be replaced.
- **`freezeRenderer` exists and is NOT called.** It makes the current renderer
  permanent and cannot be undone. The renderer stays swappable until the
  operator decides otherwise, as a separate, explicit step.
- **The finisher Mark records 11-15 are written once**, by the deploy script's
  `setUpgrade` loop, and `setUpgrade` refuses any later edit of them
  (`FinisherRecordSet`). Read them back with `read-ladder.mjs` in step 3
  before adopting the address: a wrong one is a new deployment, not an edit.
- **`seed` takes the parent's key as its sixth argument**, and a rebind since
  the request refuses it (`KeyChanged`). The Clock on this branch sends it, so
  the Warden and the contract move together.
- **Nothing may be dated before the deploy day (`DEPLOY_DAY`), and no check-in
  may be more than 30 days late.** A Clock outage longer than 30 days loses the
  oldest days for good: the Clock drops each `StaleDay` and writes the rest.
  One chunk drops at most 12 stale days a night (`maxAttempts`); past that the
  log shows `attempts-exhausted`, NOTHING is written that night, and the
  stale front drains over the following nights before fresh days land again.

### What the redeploy does to the queue

Every queued mint or seed in the mirror dated before the new contract's
`DEPLOY_DAY` is refused `BeforeDeploy` on the first Clock run after the swap:
one "this PAID mint can never land and needs a human" alert per mint row, and
one dropped seed per seed row. Step 6 clears the mirror's chain rows first, so
on a clean redeploy there are none; an alert after it means a row was queued
between the reset and the swap.

### What a redeploy does NOT carry over

- **Tokens.** The old pair keeps its tokens forever. Nothing migrates, and the
  mirror's rows for them now describe a contract nobody is reading.
- **Bitmaps.** A QR encodes its own url, not its contract, so Sepolia bitmaps
  survive a Sepolia redeploy. A MAINNET move is the case where every one must be
  re-solved -- see section 10.

## 12. The Clock under its own user -- [the operator runs three sudo commands]

The Clock signs with a key that no process running as the main user -- the
Warden, any pm2 app, a stray script -- should be able to read, and runs code
none of them can change. So it runs as the system user `mro-clock`, from a
root-owned copy of the code, with its key in a file only it can read. The
Warden and the Clock share the mirror through group `mro`. This is a boundary
against the main user's PROCESSES, not against the operator: the main user is
in `sudo`, and the installer is run with it. The installer also runs the main
user's Node and checkout as root and copies them into `/opt`, so a compromised
main user account becomes root, and holds the Clock's key, at the next install.

The log is readable by group `mro` (the main user), not only by the Clock. Its
text is redacted at source (`src/clock/redact.mjs`), so an RPC url's api key
does not reach it.

| What | Where | Owner and mode |
|---|---|---|
| the Clock's code and its Node | `/opt/mro-clock` | root, not writable by anyone else |
| its key, RPC url and paths | `/etc/mro-clock/clock.env` | `mro-clock`, 600 |
| the split seed | `/etc/mro-clock/split-seed` | `mro-clock`, 600 |
| the mirror, its cursor and lock | `/var/lib/mro/state.db*` | group `mro`, 660 |
| the Warden's question bank | `/etc/mro/bank.json` | root, group `mro`, 640 |
| the Clock's question bank | `/etc/mro-clock/bank.json` | `mro-clock`, 600 |
| the Clock's ledger | `/var/lib/mro-clock/ledger.db` | `mro-clock`, directory 700 |
| the log | `/var/log/mro/clock.log` | `mro-clock`, group `mro`, 640, rotated weekly |
| the units | `/etc/systemd/system/mro-clock.{service,timer}`, `mro-clock-alert.service` | root |

A failed night starts `mro-clock-alert.service`, which runs as the main user
and sends a push with `~/scripts/notify.sh`.

### Once, in this order

1. **Create the user and prove the shared database** (done 2026-10-04):

       sudo bash warden/deploy/create-clock-user.sh <path to node v24.14.1>

2. **Install** (re-runnable; the timer is installed disabled):

       sudo bash warden/deploy/install-clock-user.sh --commit "$(git rev-parse HEAD)"

   The checkout must be clean and at that commit, which should be the one you
   reviewed. The installer builds `/opt/mro-clock` from it with
   `deploy/build-clock-tree.sh`: the code through a git bundle checked against
   its hashes, Node from nodejs.org checked against its published SHA-256, and
   dependencies by `npm ci --ignore-scripts`. After that, root runs only the
   copy in `/opt`.

   Between 00:30 and 23:45 UTC while the timer is active: it swaps the code a
   nightly run loads. It ends
   with PASS, or names the step that failed. `--dry-run` checks the
   preconditions as the main user, builds the Clock's env file without writing
   it, and changes nothing. It refuses to replace
   an installed split seed with a different home copy unless `--replace-seed`
   is passed, which is only right after a redeploy with a new seed.

3. **Cut over**, between 00:30 and 23:45 UTC:

       sudo bash warden/deploy/cutover-clock-user.sh

   It saves pm2's list, disables the user Clock timer, stops the Warden,
   copies the mirror to `/var/lib/mro` with an integrity and row-count check,
   points `STATE_DB_PATH` and `MRO_QUESTION_BANK` in the Warden's `.env` at the
   shared files (backup in `~/.mro-env-backups`), **restarts every pm2 app**
   (the daemon must restart to carry group `mro`), checks the Warden answers
   200, runs the Clock once inside its sandbox, sends one test alert (a push
   titled "MRO Clock failed"), and only then enables the system timer. If it
   stops anywhere after disabling the user timer, it says that NEITHER timer
   is enabled: finish the cutover or take the way back below.

   **It refuses while pm2 holds any app that is not online**, because
   restarting pm2 runs `pm2 resurrect`, which STARTS every saved app, stopped
   ones included. `pm2 delete` each one it names, `pm2 save`, and re-run.

4. **After the first night passes** (`sg mro -c "tail /var/log/mro/clock.log"`):
   remove the `CLOCK_PRIVATE_KEY` line from the Warden's `.env` (WinSCP). The
   old `state.db` and the home copies of the split seed and the question bank
   are no longer read; deleting them is the operator's call.

A shell started before the main user joined `mro` cannot open `/var/lib/mro` or
read the log. Use `sg mro -c "<command>"`, or a fresh login.

### After any Clock code change, or a change to its keys

Re-run step 2. The Clock runs the copy in `/opt/mro-clock`, not the checkout,
so a merged fix does nothing until then. The same applies when the Warden's
`.env` changes any key the installer copies into `clock.env` (a redeploy does):
`BASE_RPC_URL`, `MRO_CONTRACT_ADDRESS`, `MRO_CHAIN_ID`, `MRO_DOMAIN` and
`TREASURY_ADDRESS` always, and `MAX_GAS_GWEI`, `MRO_HOUSE_KEY_ID` and the four
`CLOCK_MAX_*` ceilings when set.

**The Clock's key and split seed live only in `/etc/mro-clock`.** The key is
never copied from the Warden's `.env`, and a `CLOCK_PRIVATE_KEY` line there
stops the install: a first install makes the key with `--new-clock-key`
(printing only its address), a leak is answered with `--rotate-clock-key`
(section 9b), and every other run keeps the existing one. The home copy of the
split seed is taken once -- a first install, or `--replace-seed` after a
redeploy -- and any later run refuses while it still exists. So does a
`CLOCK_PRIVATE_KEY` line in any file under `~/.mro-env-backups` or `~/backups`.

It refuses a Warden `.env` that sets `CLOCK_CURSOR_PATH`, `CLOCK_LOCK_PATH`,
`CLOCK_LEDGER_PATH`, `MRO_DAY_SECONDS` or `MRO_CLOCK_OFFSET_SECONDS`: the
installed Clock never takes them, and the Warden would disagree with it.

### The Clock proves every row before it signs it

A row in the shared database is a claim. Before writing one, the Clock
re-verifies the agent's own signed request that created it (stored beside the
row in the `evidence` table), checks the token's key on chain, and for a paid
row reads the settlement receipt: an `AuthorizationUsed` for the signed nonce,
followed by a `Transfer` of the exact price to `TREASURY_ADDRESS`. Domain,
treasury and prices come from `clock.env` and the code, never from the row.
Each proof is recorded in `/var/lib/mro-clock/ledger.db`, so one signed request
or one payment backs one row only. A row that fails any check is not written,
stays queued, and fails the night with a line naming why. A night with more
queued rows than a `CLOCK_MAX_*` ceiling (defaults in `src/clock/run.mjs`)
writes nothing.

**A second RPC (`CLOCK_CHECK_RPC_URL`) is required on Base mainnet**, from a
different provider than `BASE_RPC_URL`: every read that settles a row without
a receipt, proves a token's key or proves a payment must agree on both, and a
disagreement holds the row. Set it in the Warden's `.env`; the installer copies
it. The Clock also refuses a night when the contract's day and the box's day
are more than one apart, and reveals at most 32 split keys a night.

**`MRO_OWNER_SAFE` is required on Base mainnet**, in the Warden's `.env`: the
Safe that must own the contract. The Warden and the Clock refuse to start, and
`adopt-deployment.sh --chain 8453` refuses to publish, unless `owner()` is that
Safe and `pendingOwner()` is zero -- so the door cannot open while the deploying
key still owns the contract. `deploy-mainnet.sh` reads the deployment back and
lists the Safe's acceptance as the first step after it.

**Deploying this change, in order.** Set `MRO_QUESTION_BANK=/etc/mro/bank.json`
in the Warden's `.env` (the installer copies the bank there, root-owned, from
`/var/lib/mro/questions/bank.json`; step 2 fails until the Warden points at it).
Run step 2, then restart the Warden, so that every row queued from then on
carries its evidence. Rows queued
before the Warden restart have no evidence and are held: on Base Sepolia that
costs those tokens one day; on mainnet, deploy before the door opens.

To run the Clock once now, `bash warden/tools/run-clock-now.sh` starts the
system unit once its timer is enabled. `rehearse-start.sh` copies the mirror
from wherever `STATE_DB_PATH` points, so after the cutover run it from a shell
that carries group `mro`.

### The way back

    sudo systemctl disable --now mro-clock.timer
    # In the Warden's .env (backup in ~/.mro-env-backups): set STATE_DB_PATH
    # back to the old file, remove the MRO_QUESTION_BANK line, and put
    # CLOCK_PRIVATE_KEY back if it was removed. Then:
    pm2 restart mro-warden
    systemctl --user enable --now mro-clock.timer

The system units stay installed and disabled; the cutover can be run again
once `/var/lib/mro/state.db` is moved aside.

The old database is the state as it was at the cutover. Anything the Warden
recorded since lives only in `/var/lib/mro/state.db`; copy it back the same way
before switching, or those rows are lost.
