# Machine Readable Only -- security -- the door (RFC 9421 Web Bot Auth and the challenge)

**Snapshot:** 8d2a0d27e3
**Read:** `reports/32-mro-tm.md`; `CLAUDE.md`; `.claude/rules/warden.md`; `warden/src/door/verify.mjs`, `middleware.mjs`, `challenge.mjs`, `directory.mjs`; `warden/src/server.mjs`; `warden/src/mcp/server.mjs` (lines 40-239); `warden/src/main.mjs` (env loading, via grep); `warden/nginx.conf.example`; `warden/ecosystem.config.cjs`; `warden/package.json`; `warden/test/door.test.mjs`, `verify.test.mjs`, `challenge.test.mjs`, `directory.test.mjs` (test list only); `client/src/signing.mjs`, and `client/src/door.mjs` / `cli.mjs` / `messages.mjs` via grep; installed `http-message-sig/dist/index.mjs` (whole file), `web-bot-auth/dist/chunk-VXDWK3MV.mjs` (the signers and verifiers), `@modelcontextprotocol/node/dist/index.mjs:320-370`.

## Findings

### [HIGH] A dot-segment request target gets past the domain pin, so a signature made for another site is accepted here [BLOCKS MAINNET]

**Where:** `warden/src/door/middleware.mjs:35-39` (`pinnedUrl`), used at `middleware.mjs:17,109` and `warden/src/server.mjs:183,468`.

**Attacker story:**
- **Who:** the operator of any HTTPS site ("evil.example") that serves an endpoint at `/mcp` and asks signers for the same five components the door requires.
- **What they need:** a victim agent that signs a request to evil.example with its Web Bot Auth key. That can be the reference client pointed at the wrong site with `--site`, or any agent whose key also signs requests to other sites.
- **What they send:** within the signature's window (60 s for `mro-agent`, up to 5 min plus 60 s skew for others), the attacker forwards the victim's request to the real Warden unchanged. Only two things differ:
  - the request line uses the target `/.//evil.example/mcp` (or `/%2e//evil.example/mcp`, or `/a/..//evil.example/mcp`);
  - it carries a fresh `challenge` / `challenge-response` pair. Both are free and not covered by the signature.
- **What they gain:** the Warden admits the request as the victim's key id and runs the tool call in the victim's body. A malicious MCP server can shape that body through its own tool names and descriptions. For example, `seed` with `to` set to the attacker's address spends the victim's one seed for that agent-year on a child token the attacker owns (`tools/seed.mjs:17-19`). Or `upgrade` on the free earned route takes a Mark the victim did not choose and permanently closes its pair.
- **What it breaks:** the door's promise that "this key id signed a request for this site" no longer holds.

**Why it works:**
1. `pinnedUrl` parses the target against our origin. `/.//evil.example/mcp` is an ordinary path, but WHATWG dot-segment removal leaves `pathname = "//evil.example/mcp"` with our host.
2. It then rebuilds with `new URL(claimed.pathname + claimed.search, origin)`. A string starting with `//` is protocol-relative, so the host becomes `evil.example` and the pathname becomes `/mcp`.
3. As a result:
   - the router (`server.mjs:183`) dispatches on `/mcp`;
   - `toRequestLike` hands `https://evil.example/mcp` to `http-message-sig`, which takes `@authority` from `new URL(message.url)` (`http-message-sig/dist/index.mjs:41-58`) and gets `evil.example`;
   - the victim's signature over `@authority: evil.example` and `@path: /mcp` therefore verifies.
4. The signature is unspent here because it was never presented here.
5. The key lookup succeeds either way. Our directory is used when the victim registered with us. Otherwise the victim's own directory is fetched and matched by thumbprint.
6. The MCP adapter builds `http://<host><req.url>`, which is a valid URL (`@modelcontextprotocol/node/dist/index.mjs:342`), so nothing downstream refuses it.

**Can it be reached in production?**
- nginx sends the raw request URI upstream, because `proxy_pass http://127.0.0.1:3006;` has no URI part (`nginx.conf.example:141-142`).
- The origin lock is off (`nginx.conf.example:84`), so an attacker who knows the origin IP can skip Cloudflare entirely.
- Whether Cloudflare normalises the path before forwarding ("Normalize URLs to origin") is not visible in the repo. See Questions.

**Why the tests miss it:** the existing tests cover only `//evil.example/mcp` and `http://evil.example/mcp` (`door.test.mjs:48-60, 839-861`). No dot-segment form is tested.

**Fix:**
- Make `pinnedUrl` unable to change the host. Build from the origin and set the path through the setter: `const u = new URL(origin); u.pathname = claimed.pathname; u.search = claimed.search;`. Then check `u.host === domain` and throw otherwise; `server.mjs:185` already turns a throw into a 400 `target`.
- Also refuse any target that does not start with exactly one `/`.
- Add tests for `/.//x/mcp`, `/%2e//x/mcp`, `/a/..//x/mcp` and `/./\x/mcp`.
- Defence in depth (see the Low finding on the challenge below): require the `challenge` header to be a covered component. A signature made for another site could then never carry our challenge.

### [MEDIUM] Eight slow directory hosts can close the door to every agent that hosts its own key directory

**Where:**
- `warden/src/door/directory.mjs:17,238,279` (a 3 s *idle* timeout only);
- `directory.mjs:404,471-481` (a process-wide limit of 8 fetches in flight);
- `warden/src/door/verify.mjs:345-354` (the lookup runs before any cryptography).

**Attacker story:**
- **Who and what they need:** an anonymous caller with no key, and a server under their control on port 443.
- **What they send:** eight unsigned-in-effect requests to `/mcp`. Each has a well-formed `Signature-Input` (the five components, `tag="web-bot-auth"`, a window under 5 min, any keyid), a garbage `Signature`, and a `Signature-Agent` naming a different hostname they control (`a.attacker.tld` ... `h.attacker.tld`).
- **How the slots stay full:** their servers accept TLS and then trickle one byte every ~2.5 s. With a 64 KB body cap that holds each fetch for roughly 45 hours. Each fetch also keeps its place in `inFlight` until it settles.
- **What they gain:** while all 8 slots are held, every other third-party lookup throws `DirectoryUnavailableError("too many directory fetches in flight")` and is refused `directory`. Agents that sign with their own domain (the Cloudflare signed-agent group) cannot check in, seed or mint.
- **What it does not affect:** keys registered through `POST /keys` use the local database and are unaffected. That includes the reference client (`client/src/door.mjs:23`).
- **Cost to the attacker:** nothing meters `/mcp` before admission. nginx meters only `/keys*`, and `allowToolCall` runs after `admit`.

**Why it works:** Node's `request({ timeout })` sets `socket.setTimeout`, which fires only after that long with *no activity*. There is no overall deadline, so a server that trickles keeps it from ever firing.

**Fix:**
- Put a hard total deadline on each fetch: a `setTimeout(() => req.destroy(...), 3000)` started when the request is made and cleared on settle, or `AbortSignal.timeout(3000)` passed as `signal`.
- Also cap response headers and body time.
- Consider a per-registrable-domain in-flight limit, so one attacker domain cannot hold every slot.

### [LOW] "Burn after use" on challenges can be sidestepped, because the hex check is lenient

**Where:** `warden/src/door/challenge.mjs:16-21` (`sameDigest`), `:56`, `:82-87`; the same machinery for registration nonces at `server.mjs:388-392`.

**Attacker story:** an admitted agent (or anyone) takes one issued challenge. Within its 5 s it presents it several times, each time with a different spelling of the HMAC part: uppercase hex, or a trailing non-hex character or odd nibble. Every spelling passes the HMAC check but is a different string, so `seen.has(challenge)` never matches. The result is that one challenge admits any number of distinctly signed requests.

**Why it works:** `Buffer.from(x, "hex")` accepts uppercase, and it stops quietly at the first non-hex character or odd trailing digit. The HMAC comparison is done on bytes, but the burn set is keyed on the raw string.

**Impact:** limited. The real replay control is the `spent` set on the signature base, and the challenge is openly not a second factor (`middleware.mjs:123-129`). For registration, the proof signs the exact nonce string, so a captured triple still cannot be replayed. This is a broken control rather than a working attack.

**Fix:** check the format first: `/^[0-9a-f]{64}$/` for the HMAC part and the answer, and a strict shape for the nonce and timestamp. Better still, key `seen` on the canonical `${nonce}.${ts}` rather than on the string presented.

### [LOW] The five-second challenge is not tied to the signature

**Where:** `warden/src/door/middleware.mjs:161-164`; `warden/src/door/verify.mjs:128` (`REQUIRED` does not include `challenge`).

**Attacker story:** whoever relays a signed request computes `sha256(challenge + keyId)` from public inputs and attaches it. So the signer never has to see the challenge. A signature can be made up to 6 minutes earlier, by any means, and "answered inside five seconds" is proved by whoever relays it, not by the key holder. This is also what makes the High finding above one step long: the attacker adds our challenge to someone else's signature.

**Fix:** require `challenge` as a covered component, or require the signature's `nonce` parameter to equal an unexpired challenge issued here and keyed to this keyid. Either way the signer must sign after the challenge exists and within its 5 s. `mro-agent` already fetches the challenge before signing each call (`client/src/door.mjs`), so the client change is small. This keeps proof-of-agent an access rule. It only makes the rule attach to the key that is admitted.

### [LOW] Replay protection lives only in process memory and is lost on every restart

**Where:** `warden/src/server.mjs:126-133` (`seen`, `seenNonces`, `spent` are in-memory); `warden/ecosystem.config.cjs:59-61,93` (autorestart, `max_memory_restart: "512M"`).

**Attacker story:** someone holding a captured signed request (a TLS-terminating proxy, request logs, a compromised agent host) replays it right after the Warden restarts: a deploy, a crash, or a memory-limit restart. That reopens up to 6 minutes of replay for signatures still in their window. Content-digest limits the damage to repeating the exact same tool call, and paid calls are further protected by `pay_nonces`. So this is defence in depth.

**Fix:** keep `spent` in the SQLite mirror with an index on expiry and a periodic delete. Or, on boot, refuse any signature whose `created` is before the process start time; that is simple, stateless, and costs honest agents at most one re-sign.

### [INFO] Directory cache: a one-hour success entry hides newly added keys, and anyone can pre-fill it

**Where:** `warden/src/door/directory.mjs:374,457-465,497-501`.

A cached success is trusted for an hour. A key the agent added to its own directory during that hour is refused `unknown-key` until the entry expires, and an unauthenticated caller can pre-fill the entry just before a rotation. The reverse case, a removed key still verifying for an hour, is documented and deliberate. Suggested change: on a thumbprint miss against a cached success older than about 60 s, re-fetch once, through the same in-flight limit.

### [INFO] What the outbound fetch can reach

**Where:** `warden/src/door/directory.mjs:103-154,172-283,448`.

The destination is fixed to `GET https://<host>:443/.well-known/http-message-signatures-directory`. The protections are:
- the path is overwritten by `new URL(path, agent)`;
- no credentials, no redirects, no non-443 ports;
- a literal IP is checked, and every resolved address is checked inside the socket's own lookup;
- all of `::/8`, 6to4, Teredo, ULA, link-local and the private and CGNAT IPv4 ranges are refused.

Nothing from the response reaches the caller except "key found" or "not found", plus timing. The box's own public address and other public vhosts are reachable, but only that fixed read-only path. I found no gap in the blocklist.

### [INFO] `CHALLENGE_SECRET` is checked for presence only

**Where:** `warden/src/main.mjs:81`.

A short or guessable secret would let challenges and registration nonces be forged. Neither is a security factor on its own (registration still needs proof of the key), so this is Info. Suggested change: refuse to start below 32 bytes.

## Questions

1. **Cloudflare path handling (decides how exposed the High finding is through the proxy).** Is "Normalize URLs to origin" on for this zone? And does any WAF rule reject `/./` or `//` paths? Either way, the origin can be reached directly while the origin lock (`nginx.conf.example:84`) is off. A live probe of `POST /.//example.org/mcp` with a correctly signed request for `example.org` would settle it.
2. **Which agents reuse keys across sites?** The High finding assumes a victim's key signs requests to other sites with all five components. For `mro-agent` that happens through `--site` (`client/src/cli.mjs:36`). Is the client meant to warn or refuse when `--site` is not `DEFAULT_SITE`, or when the `Signature-Agent` it would send differs from the site it registered with?
3. **`@query` is not required and `pinnedUrl` keeps `search`.** The router and `toWebRequest` ignore the query today. Is that a stated invariant for MCP revision 2026-07-28 in the installed `@modelcontextprotocol/server` 2.0.0? If a future handler reads query parameters, they would be unsigned.
4. **Header whitespace.** `http-message-sig`'s `extractHeader` collapses whitespace in covered header values (`index.mjs:32`). Two wire requests that differ only in whitespace produce the same base and the same `sigHash`, so replay detection holds. Is it intended that `credits.sigHash` evidence cannot tell them apart?

## Out of scope

- `POST /keys` storing and republishing the whole caller JWK, directory size, and the nginx limiter keyed on the Cloudflare edge IP: the key-registration and resource-cost area (threat model item 9).
- MCP tool-level binding checks (`seed` / `upgrade` / `checkin` gates) and binding drift at Clock write time.
- x402 payment handling, reached only after admission.

## Coverage

- **Checked:**
  - how components are parsed (`coveredComponents` uses an RFC 8941 parser and `lastIndexOf`; `http-message-sig` refuses more than one signature and non-string components, so the label cannot mismatch);
  - the required set;
  - `created` / `expires` handling (a missing value throws and is refused; skew is one-way, 60 s; window 5 min);
  - `tag` and `keyid`;
  - keyid-to-JWK thumbprint equality on both lookup paths (a registered JWK passed WebCrypto Ed25519 import, and `verifierFromJWK` uses only `kty`/`crv`/`x` or `kty`/`e`/`n`);
  - the replay identity being the signature base (label renaming defeated);
  - the spent check-and-set having no `await` between check and set, so it cannot race;
  - the content-digest comparison being made after verification, over the raw bytes;
  - challenge minting, expiry, key binding and burning;
  - dictionary vs legacy `Signature-Agent`;
  - the `isOurs` exact-hostname check;
  - the SSRF guard, redirect refusal, body cap, and failure and success caches;
  - the Origin check;
  - body read before the door.
- **Not opened:** `warden/test/vectors/web_bot_auth_architecture_v1.json`, which holds encoded signatures; I read how `verify.test.mjs` uses it. `directory.test.mjs` beyond its test names.
- **Not run:** nothing was executed. The URL-parsing result behind the High finding is derived from the WHATWG URL parsing rules that Node's parser follows, and it is not covered by any existing test. A failing unit test calling `pinnedUrl("/.//evil.example/mcp", "example.com")` would confirm it directly.
