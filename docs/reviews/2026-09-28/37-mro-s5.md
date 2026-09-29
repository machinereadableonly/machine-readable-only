# Machine Readable Only -- security -- client key handling, public surfaces, secrets and infrastructure

**Snapshot:** 8d2a0d27e3
**Read:** `reports/32-mro-tm.md`; `client/src/keys.mjs`, `signing.mjs`, `cli.mjs`, `pay.mjs`, `door.mjs`, `mcp.mjs`, `messages.mjs`, `client/package.json`; `warden/public/llms.txt`, `door.html`, `robots.txt`; `server.json`, `plugin.json`, `README.md`, `LICENSING.md`, `skills/machine-readable-only/SKILL.md`; `warden/src/server.mjs`, `warden/src/main.mjs`, `warden/src/mcp/tools/rebind.mjs`; `warden/.env.example`, `contracts/.env.example`, `.gitignore`, `warden/.gitignore`; `warden/nginx.conf.example`, `warden/ecosystem.config.cjs`, `warden/DEPLOY.md`; `warden/deploy/install-warden-site.sh`, `install-nginx-rate-limits.sh`, `enable-origin-lock.sh`, `set-domain.sh`, `set-contract-address.sh`, `relocate-env-backups.sh`, `install-seed-agent.sh`, `install-clock-logging.sh`, `mro-clock.service`, `mro-seed.service`, `mro-seed.env.example`; `scripts/make-clock-key.sh`, `scripts/install-hooks.sh`, `.githooks/pre-push`, `tools/prepublish-check.mjs`, `.github/workflows/publish-client.yml`; `contracts/script/deploy-mainnet.sh:1-110`. From the installed PM2 7.0.1: `~/.nvm/versions/node/v24.14.1/lib/node_modules/pm2/lib/Common.js:154-185,565-614`, `API.js:455-520,900-1089,1298-1394`, `God/ActionMethods.js:380-425`. I also searched the tree for secrets (64-hex keys, token prefixes, keyed provider URLs).

## Findings

### [MEDIUM] One Unix account holds the internet-facing Warden, the Clock key, the permanent owner key and the operator's infra tokens [BLOCKS MAINNET]
**Where:**
- `warden/ecosystem.config.cjs:11-45`: PM2, no `uid`, no sandbox.
- `warden/src/main.mjs:54-69`: the source says itself that deleting the key is "defence in depth, not a boundary".
- `warden/deploy/mro-clock.service:27,38`: `ReadWritePaths` covers the whole `warden/` tree, source included.
- `contracts/.env.example:13-25` and `contracts/script/deploy-mainnet.sh:28-31,86-93`: `MAINNET_DEPLOYER_KEY` is a hot key in `contracts/.env`. Moving ownership to a Safe is only "prefer".
- `warden/DEPLOY.md:36-39` (the Cloudflare DNS-edit token is on the box) and `:389-396` (key rotation assumes the owner key is on the box).
- `warden/ecosystem.config.cjs:66-73` (the shell carries a Cloudflare token, two GitHub tokens and the CDP key).

**Attacker story:** An outsider gets code running in the Warden. The routes to that are a compromised dependency (for example `web-bot-auth` 0.1.3, `@x402/*`, the MCP SDK or `zod`), a parser bug, or the solver child. No privilege escalation is needed after that. The attacker then:
- reads `warden/.env`, which holds `CLOCK_PRIVATE_KEY`. That allows every irreversible action in DEPLOY.md 9b.
- reads `contracts/.env`, which holds `MAINNET_DEPLOYER_KEY`, the Ownable owner. That allows `setRenderer`, `setWarden`, `sunset` and `setUpgrade`, i.e. admin control seized.
- reads the infra secrets file. The Cloudflare DNS token lets them repoint `machinereadableonly.com`, which every QR encodes for good. The GitHub tokens let them push to the public repo, including `SKILL.md`. That file is the "out-of-band" treasury source that `llms.txt:79-82` tells agents to trust. One compromise therefore beats both halves of the payment check.
- or rewrites `warden/src/clock/*.mjs`, which the sandboxed Clock runs next at 00:05 with the key loaded.

**Why it works:** Every one of these files and tokens is readable or writable by the same uid that serves port 3006. The Clock's sandbox does not help, because the thing it protects is the source tree the Warden can write.

**Fix:**
1. Before mainnet, the owner must be a hardware wallet or Safe. Make `transferOwnership` + `acceptOwnership` a required step in `deploy-mainnet.sh` and DEPLOY.md section 10. `MAINNET_DEPLOYER_KEY` must not stay on the VPS after deploy. Section 9b's rotation should then be signed off-box.
2. Run the Warden under its own system user from a systemd unit with `ProtectHome=`/`InaccessiblePaths=`, so it cannot read `contracts/.env`, the Clock's credential or the infra file.
3. Give the Clock its key through `LoadCredential=` from a root-owned 0600 file.
4. Narrow the Clock's `ReadWritePaths` to the state directory only.
5. Keep GitHub and Cloudflare tokens off the host that serves the piece.

### [LOW] The `filter_env` scrub is bypassed by `pm2 start|restart|reload ecosystem.config.cjs` on a running app, and a name denylist misses common secret names
**Where:** `warden/ecosystem.config.cjs:90`. In PM2 7.0.1: `API.js:329` (`start` on a config file goes through `_startJson(..., 'restartProcessId')`), `API.js:1075` (`env.updateEnv = true`), `API.js:1363-1371` (`new_env = Object.assign({}, process.env)`, the whole CLI shell, unfiltered) and `God/ActionMethods.js:405` (merged into the running app's env). `filterEnv` in `Common.js:165-182` runs only on the first-start path.

**Attacker story:** No attacker is needed. The operator changes the ecosystem file and re-runs `pm2 start ecosystem.config.cjs` without `pm2 delete` first. `pm2 restart ecosystem.config.cjs` or `--update-env` has the same effect. The Warden then silently receives the full shell environment: the Cloudflare token, GitHub tokens and CDP key. Because Node lets the environment win over `--env-file`, a stale shell `CDP_API_KEY_*` or another project's `BASE_RPC_URL` replaces the file's value. A following `pm2 save` writes all of it into `~/.pm2/dump.pm2`.

Even on the documented path, the substring list lets through `GITHUB_PAT`, `*_APIKEY`, `MNEMONIC`, `*_PASS`, `*_RPC_URL` with a key in the path (for example `ALCHEMY_BASE_MAINNET_RPC_URL`, which `contracts/.env.example:33-34` suggests exists) and `NODE_OPTIONS`.

**Why it works:** PM2 applies `filter_env` only when it builds a new app. The JSON restart path merges `process.env` directly.

**Fix:**
- Stop relying on PM2 for environment hygiene. Start PM2 from a clean environment (`env -i HOME=... PATH=... pm2 start`), or better, run the Warden from systemd (see the finding above).
- In `main.mjs`, read `.env` with `fs.readFileSync` + `util.parseEnv` and take configuration only from that object, so the shell cannot override it.
- Refuse to boot if `process.env` holds names outside an allowlist.

### [LOW] Re-running `install-warden-site.sh` silently removes the origin lock and `real_ip`, and the rate-limit installer then skips re-adding `real_ip`
**Where:** `warden/deploy/install-warden-site.sh:48` overwrites the live vhost from the template. In `warden/nginx.conf.example:84,101-102` the lock and `real_ip` are commented out, while `:63` already declares `zone=mro_keys`. `warden/deploy/install-nginx-rate-limits.sh:66-69` skips editing when `zone=mro_keys` is present, and its proof at `:264-283` runs over loopback, so it passes either way. `warden/DEPLOY.md:283-285` states the lock "already is" enabled.

**Attacker story:** The script is described as idempotent, so the operator re-runs it (for example after a certificate problem). The origin then answers direct connections to the VPS IP, which bypasses every Cloudflare setting. The `/keys` limiter goes back to bucketing by edge IP. Every script still reports success.

**Why it works:** The template does not match production. The rate-limit script uses the zone line as its "already installed" marker for two independent edits.

**Fix:**
- Make the template carry production's state, or have `install-warden-site.sh` refuse to overwrite an existing vhost (or re-run `enable-origin-lock.sh` afterwards).
- In the rate-limit script, check for `real_ip_header` separately from the zone line.

### [LOW] The push and publish guards have no secret-shaped rules, skip `docs/reviews/`, and `.gitignore` misses `*.env`
**Where:** `tools/prepublish-check.mjs:65,67-123` (identity patterns only; `docs/reviews/` skipped), `.githooks/pre-push:45-76`, `.github/workflows/publish-client.yml:104-107`, `.gitignore:20-24`.

**Attacker story:** An agent or the operator pastes a `CLOCK_PRIVATE_KEY=0x...` line or a keyed RPC URL into a doc or review note. Or they copy an identity `.jwk.json`, which carries the private `d`, into the tree. Or they create `warden/deploy/mro-seed.env` / `clock.env` in place from an example. `.env.*` does not match `*.env`. Both guards pass and the public repo publishes the secret. DEPLOY.md 9b says a Clock key leak is permanent damage within minutes.

**Why it works:** Every rule targets personal identifiers. Nothing matches key material.

**Fix:** Add rules for:
- `0x[0-9a-f]{64}`, with an explicit allowlist of the two anvil test keys the tests use;
- `"d"\s*:` inside JSON;
- `(PRIVATE_KEY|_SECRET|_TOKEN)=\S`;
- `/v2/[A-Za-z0-9_-]{16,}` and `-----BEGIN`.

Scan `docs/reviews/` for secrets even if it stays exempt from identity rules. Add `*.env` to `.gitignore`, keeping the `!*.env.example` exception.

### [LOW] The pre-push hook scans `@{u}..HEAD`, not the refs actually being pushed
**Where:** `.githooks/pre-push:42-49`. The hook never reads the `<local ref> <local sha> <remote ref> <remote sha>` lines git passes on stdin.

**Attacker story:** The operator is on an up-to-date `main` and runs `git push origin feature` or `git push --tags`. The range is empty and the HEAD tree is clean, so `feature`'s leaking blobs are published unchecked.

**Fix:** For each stdin line, scan `remote_sha..local_sha` (or `local_sha --not --remotes` for a new ref), plus the tree of `local_sha`. Do the same in `id-scan.mjs`.

### [LOW] `publish-client.yml` grants `id-token: write` to a job that runs third-party install scripts
**Where:** `.github/workflows/publish-client.yml:48-50` (job-wide `id-token: write`), `:61,68` (actions pinned by mutable tag), `:84` (`npm install -g npm@latest`), `:109-126` (`npm ci` in `client/` and `warden/`, lifecycle scripts enabled).

**Attacker story:** Someone compromises any package in either lockfile tree, the unpinned npm, or an action tag. Their code runs with `ACTIONS_ID_TOKEN_REQUEST_*` in its environment. It can mint the OIDC token npm's trusted publisher accepts and stage its own `mro-agent` tarball. The client is what agents run with `MRO_WALLET_KEY` set. The remaining gate is a person approving the correct stage id with 2FA.

**Fix:**
- Split the workflow into a `test` job (no `id-token`) that runs `npm ci --ignore-scripts`, runs the tests and `npm pack`s an artifact, and a `publish` job with `id-token: write` that only downloads that tarball and stages it.
- Pin actions by SHA and npm by exact version.
- Gate the publish job behind a protected GitHub environment with required reviewers.

### [LOW] Client identity file: no mode or owner check on load, and a cwd fallback when `HOME` is unset
**Where:** `client/src/keys.mjs:19-21` (`process.env.HOME ?? "."`), `:89-92` (`loadIdentity` trusts any file), `:95-100` (permissions are only tightened on creation). Compare `client/src/cli.mjs:288-302`, which does refuse a group- or world-readable wallet key file.

**Attacker story:**
- An identity restored from a backup or copied at 0644 is used silently and stays readable to other local users. Whoever reads it can check in, spend seeds and take free earned Marks for the bound token.
- With `HOME` unset (some system units and minimal cron environments), the key path becomes `./.mro/identity.jwk.json` relative to cwd. In a shared directory such as `/tmp`, another local user can plant an identity whose private key they know, and the client adopts it without complaint.

**Fix:**
- In `loadIdentity`, `fstat` the file and refuse (or tighten and warn) when `mode & 0o077` is non-zero or the owner is not the current uid. Refuse a group- or world-writable parent directory.
- Use `os.homedir()` and throw if it is empty rather than falling back to `.`.
- Open with `O_NOFOLLOW` when writing.

### [LOW] The documented mainnet mint puts the funding wallet key on a command line
**Where:** `warden/DEPLOY.md:604-609` (`MRO_WALLET_KEY=<the funding wallet's key> node src/cli.mjs join ...`). Also `client/src/messages.mjs:66-67` and `skills/machine-readable-only/SKILL.md:137-139`, which tell agents to use the environment variable.

**Attacker story:** The operator's workflow types commands at the Claude `!` prompt. The inline assignment then lands in shell history and in the session transcript, which is exactly what `cli.mjs:280-287` exists to prevent. An LLM agent following the SKILL text will usually set the variable inline in a tool call, with the same result in its own transcript.

**Why it works:** The environment variable is described as "preferred", and the only file path offered is typed by hand. `MRO_WALLET_KEY` is also not format-checked (`cli.mjs:176`), unlike the file.

**Fix:**
- Rewrite DEPLOY.md section 10 step 6 to use `--wallet-key-file` created by a `read -s` helper script.
- Accept `--wallet-key-file -` (stdin).
- Recommend the file first in `unpayableMessage` and SKILL.md.
- Validate the environment value with the same regex as the file.
- DEPLOY.md:613-615 also still calls `--expect-amount` optional, which contradicts `pay.mjs:111`. Correct it.

### [INFO] An IP-allowlist origin lock admits any Cloudflare-proxied traffic, not just this zone's
**Where:** `warden/deploy/enable-origin-lock.sh:6-9`, `install-nginx-rate-limits.sh:120-154`.

Any Cloudflare customer can point their own proxied hostname at the origin IP. That traffic arrives from Cloudflare ranges with a Cloudflare-set `CF-Connecting-IP`, so the lock passes it while this zone's WAF and bot settings never apply. The header cannot be forged, so the limiter keying stays sound. **Fix:** Cloudflare Authenticated Origin Pulls (mTLS to the origin), with `ssl_verify_client on` in the TLS block.

## Questions

1. **npm staging.** Does `npm stage publish` actually block publication until a 2FA `npm stage approve` (`publish-client.yml:18-31`)? When a staged entry appears that CI did not create, does the approver see anything that tells the two apart? The LOW finding above assumes yes to both. If either is false, it is a direct-publish supply-chain path and should be at least MEDIUM.
2. **GitHub repo protection.** Is `machinereadableonly/machine-readable-only` (named in `server.json:8`, `plugin.json:11`, `llms.txt:460`, `SKILL.md:12`) an organisation the project alone controls? Is branch protection with required review on `main` enforced? SKILL.md is the stated out-of-band source of the mainnet treasury, so an unreviewed push there has the same effect as replacing the site.
3. **`NODE_OPTIONS`.** Does the operator's login shell set `NODE_OPTIONS` (for example `--inspect` or `--require`)? It passes `filter_env`, and it would apply to the Warden.
4. **Log file modes.** What mode do `~/logs/mro-warden.{out,err}.log` and `~/.pm2/dump.pm2` get? The Clock and seed units force `UMask=0077`; nothing does the same for PM2's files on a box shared with other projects.

## Out of scope

- The door's own verification logic (`warden/src/door/**`), including the fact that the challenge answer is a public function of public inputs. Also x402 settlement, contracts and the Clock's write logic. These belong to other areas.
- The client's clock-skew retry trusting `serverTime` from the endpoint (`client/src/mcp.mjs:129-137`). The endpoint is chosen by the user and the body is bound by content-digest, so I found no gain for an attacker.
- The `rebind`/`rest` tools return `{contract, function, args}` rather than raw calldata (`warden/src/mcp/tools/rebind.mjs:30`). I found no phishing path for arbitrary calldata through the client.

## Coverage

- **Discovery surface:** every URL the discovery documents name on the site's own origin is served by a route in `warden/src/server.mjs`, backed by a tracked file:
  - `/llms.txt`, `/`, `/robots.txt` from `warden/public/`;
  - `/protocol` from `docs/2026-09-01-mro-raw-protocol.md`;
  - the four `/.well-known/mcp*` paths from `server.json` (parsed at boot, `main.mjs:348-349`);
  - the key directory from the mirror;
  - `/t/<id>` and `/mcp`.

  `/client.mjs` and `/skill.md` answer 404 `not-built-yet`, as disclosed in `llms.txt:517-525`. `/.well-known/x402` is deliberately not served. External names (the GitHub org, npm `mro-agent`, the Sepolia explorers) cannot be verified from the tree (see Question 2).
- **Secrets in the tree:** no real secrets in tracked files. Every 64-hex value found is either one of anvil's two published test keys or a transaction hash or topic.
- **Client key handling:** the client never logs private material. It prints only `keyId` and the path, and errors print `err.message`. Private keys never go into argv.
- **Loopback binding:** the Warden's 127.0.0.1 bind is hardcoded (`main.mjs:78`).
- **Not read:** `check-real-ip.sh`, `mro-*.timer`, the logrotate examples, `scripts/setup-clock.sh`, `scripts/rehearse-clock-key.sh`, `client/src/challenge.mjs` and `index.mjs`, `warden/src/clock/redact.mjs` (its use is confirmed in `chain/read.mjs:49` and `preflight.mjs:13`), and the body of the raw-protocol doc.
