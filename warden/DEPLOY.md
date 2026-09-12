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
the process, and PM2 adds `NODE_ENV` and `PORT`.

PM2 would ALSO pass on the entire environment of the shell that ran
`pm2 start`, and Node lets a variable already in the environment win over the
same one in the file. On this box that shell carries the operator's infra
secrets, so `filter_env` in the ecosystem file drops anything named like a
credential. It must stay a LIST: `filter_env: true` does nothing in PM2 7.0.1.
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

1. put token #1's id in `~/.mro/seed.env` as `MRO_SEED_TOKEN`
2. `systemctl --user enable --now mro-seed.timer`
3. re-run the installer -- step 7 now checks the REAL check-in instead of the
   rehearsal, and says so

The timer fires at **12:00 UTC**, deliberately far from the Clock's 00:05. The
check-in window is one UTC day wide on chain, so midday leaves twelve hours of
slack either side for a reboot, a slow run or the five minutes of jitter.

---

## 10. The mainnet cutover -- [OPERATOR APPROVAL REQUIRED, real funds]

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
| `MRO_SEED_TOKEN` | `~/.mro/seed.env` | it holds a rehearsal id that does not exist; the seed agent beats nothing until it is the real one |

### Before the cutover, in this order

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

5. **Mint token #1 and start the seed agent -- [OPERATOR GATE, real funds].**
   This is C4.5, and it is the last step because it is the one that cannot be
   undone: token #1 is minted once, and the first 72 hours happen once.

   Mint it from a wallet the operator controls, using the client's own path so the token
   is bound to the seed agent's key from the first block:

   ```
   cd ~/projects/machine-readable-only/client
   MRO_WALLET_KEY=<the funding wallet's key> node src/cli.mjs join \
     --to <the address that should OWN token #1> \
     --key ~/.mro/seed-identity.jwk.json \
     --expect-payto <the treasury from step 10's table> \
     --expect-amount 1000000
   ```

   `--expect-payto` is REQUIRED for the client to pay at all -- `assertExpected`
   throws without it, because a destination the site alone asserts is not a
   destination worth signing for. `--expect-amount` is optional but compared
   when given, so pass it: 1000000 is 1 USDC in base units. The client also
   refuses any scheme other than `exact`, which is the one that means a single
   transfer with no standing allowance.

   **Take the treasury address from somewhere other than the site**, which is
   what SKILL.md tells every other agent to do. If the value you check against
   came from the same server that quoted it, it is not a check.

   Then follow section 9c's three deploy-day steps, and **let it run for 48
   hours before anything is announced** -- that window is C4.6, the OpenSea
   check, and it needs a token that already exists.

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

2. **Simulate, then deploy.**

   ```
   bash script/deploy-plan7.sh              # simulation only
   bash script/deploy-plan7.sh --broadcast  # after the operator approves
   ```

3. **Verify the source, then verify the interface.** They are different claims.

   ```
   bash script/verify-plan7.sh <renderer> <token> <warden>
   cd ../warden
   node tools/check-deployed-abi.mjs <token>   # exits non-zero on any mismatch
   node tools/read-ladder.mjs <token>          # the ten Mark records, by value
   ```

   Basescan verification proves the SOURCE compiles to that bytecode. It says
   nothing about whether the ABI in this repository describes it. On 2026-09-02
   every Mark was unwritable against a fully verified contract, and only reading
   the runtime bytecode found it.

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

6. **Verify through Cloudflare, not against localhost**, exactly as section 9
   says. Then check all four suites and commit.

### What a redeploy does NOT carry over

- **Tokens.** The old pair keeps its tokens forever. Nothing migrates, and the
  mirror's rows for them now describe a contract nobody is reading.
- **Bitmaps.** A QR encodes its own url, not its contract, so Sepolia bitmaps
  survive a Sepolia redeploy. A MAINNET move is the case where every one must be
  re-solved -- see section 10.
