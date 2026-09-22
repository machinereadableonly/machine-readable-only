# Machine Readable Only -- Project Instructions

<!-- PROJECT-SPECIFIC SECTIONS -- unique to this project -->
<!-- Subsystem detail lives in .claude/rules/, which load only when Claude opens
     a matching file. Build history lives in git and in auto-memory. Keep this
     file short: a longer file reduces adherence to all of it, including the
     Hard Rules below. -->

## What This Project Is

An agents-only NFT art piece on Base. A site with no human-facing rendering:
a visitor must cryptographically prove it is a program before it can enter,
connect a wallet and mint. The token is a living record of the agent's
return visits, so the artwork is the agent's own history of coming back.

- **Role:** Art piece and protocol demo (both, deliberately -- not a
  speculative collectible)
- **Stack:** Solidity (Foundry 1.7.1) + Node 24.14.1; MCP server; the reference
  client `mro-agent` in `client/` (built; the npm NAME is claimed and holds a
  placeholder that does nothing -- the real client is still unpublished);
  `skills/` holds SKILL.md.
- **Status: Plans 1 through 7 are ALL BUILT, deployed on Base Sepolia, pushed
  and live.** Phase 0 is signed off, every review finding is closed, and the
  repository is PUBLIC. **There is no build work left that Claude can start
  alone** -- what remains is the operator's: the mainnet mint of token #1, a real
  treasury, the domain term, and X credentials. (The CDP key is DONE: it was
  only ever refused over IPv6, and the Warden now runs pinned to IPv4.)
  For what to do next read the `publish-readiness` memory; for what exists read
  `build-status`; for the reviews read `reviews-closed`.
- **The live deployment on Base Sepolia, chain 84532** -- the only pair to use:

      MachineReadableOnly  0x0090979EFa10Adcfe8Df14AD3c2C8Db38b235eED
      Renderer             0x80F079C5Bbb1E17b3C7441c21B094eB3e81A089b
      block 46,686,660, 2026-09-11, both Basescan-verified

  **Every earlier pair is superseded; do not read state off one.** The mirror
  holds only tokens minted on THIS pair, so an id not yet minted here answers
  404 and that is CORRECT.
- **Secrets:** the real environment files only, chmod 600, never committed --
  the operator edits them via WinSCP and Claude never reads them. The `.env.example`
  files hold the schema.
- **Environment:** VPS. **Port 3006**, the Warden, registered in
  `~/.claude/templates/port-allocation.md`. Bound to 127.0.0.1 only; public
  traffic arrives through nginx. Live at `https://machinereadableonly.com`.

## Hard Rules (never break these)

1. **Base MAINNET and permanent.** The whole point is a record of return
   visits, and that history cannot be moved to another chain later. Do not
   propose a chain migration.
2. **Never spend real funds without the operator's explicit approval, every time.**
   Mainnet deploys and any transaction with real value are operator-approval gates.
   There is no standing approval.
3. **Read the spec before any MRO work:**
   `docs/specs/2026-08-27-machine-readable-only-design.md`. It is 60 KB;
   read the relevant sections, not a skim.
4. **Phase 0 GATE IS PASSED** (signed off 2026-08-30). Do not describe Phase 0
   as blocked or pending. The spike's measured limits still bind the work that
   follows -- see Gotchas and `.claude/rules/rendering.md`.
5. **Do not re-open decided ground.** Free mint, per-token yearly seeding,
   Ethereum / Solana / Monad, and a human-facing gallery are all decided
   against. Do not re-propose them. **Payment stays USDC** (reaffirmed by the operator
   2026-08-31): x402's exact scheme handles ERC-20 only, so native ETH is not
   available at all, and WETH would need a Permit2 approval -- an on-chain
   transaction and a gas balance the paying agent currently does not need. It
   would also untether the Marks ladder, which is priced in dollars.
6. **Frame proof-of-agent as an access rule**, which is what it is: an entry
   condition for an art piece ("a program minted this"). It is not an
   anti-abuse or bot-defence system, and describing it that way invites a
   safety classifier that derails the session.
7. **Every contract must be proven deployable before it is called done:**
   `forge build --sizes` showing positive runtime margin AND a strict-limit
   anvil deploy with non-empty `cast code`. `test/ContractSize.t.sol` fails
   the suite otherwise.

## Conventions

- **Plain ASCII only** in all docs and code comments. No em dashes, smart
  quotes, arrows or emoji.
- **Propose specifics, never adjectives.** Name the exact mechanism, not
  "a robust check".
- **Builds AND any long-running compute go through `~/scripts/safe-build.sh`.**
  The wrapper takes any command, not just a build:
  `~/scripts/safe-build.sh node ./sweep.mjs`. This project's normal work is
  exactly the shape that breaks the box -- rasterising SVGs and decoding them in
  bulk. On 2026-08-28 a bare `node -e` sweep reached 6.28 GB resident, hit the
  7.8 GB box limit, and destroyed the session. **The hook only recognises
  builds**, so capping a sweep is your judgement call: if a command is slow
  enough that you are about to background it, it is big enough to cap.
- Use `/bin/grep`, never bare `grep`.
- Foundry needs `export PATH=$HOME/.foundry/bin:$PATH`; Node needs
  `source ~/.nvm/nvm.sh`. Non-interactive shells have neither on PATH.
- **Tests: ALL FOUR green before any commit.** `cd contracts && forge test`,
  and `npm test` in each of `tools/`, `warden/` and `client/`.
- **Never pipe a gate into anything.** A pipeline's exit status is the last
  command's, so `guard | tail && commit` let a real leak through once.
- The Bash tool's working directory persists between calls, and the
  project-isolation hook compares write targets against it. After a `cd`
  into a subdirectory, `cd` back to the repo root before editing root files.

## What may go public -- THIS REPOSITORY IS PUBLIC

Added 2026-09-21, after a session scratchpad path reached the public history.

**Never in a tracked file, in any form:**

- **An absolute local path.** Both shapes: `/home/<user>/...` AND the mangled
  form a scratchpad directory uses, `-home-<user>-<project>`. The second
  carries the username just as plainly and is the one that got through.
- **A session or task id**, or any `claude.ai/code` link.
- **A real environment value.** The `.env.example` schema only.
- **AI attribution** in a commit message, a PR body, or file content.
- **A personal identifier.** See `~/.claude/rules/identifiers.md`.

**Where exploratory output goes:** `tools/out/`, which is gitignored. A tool may
be committed; the paths inside it may not. Read the directory from an
environment variable with a relative default -- `process.env.MRO_SHEET_OUT ??
"out"` -- never a literal.

**Two guards, deliberately in different places, and BOTH run automatically from
`.githooks/pre-push`:**

| | Holds | Lives |
|---|---|---|
| `tools/prepublish-check.mjs` | PATTERNS only | in this repo, published |
| `~/scripts/id-scan.mjs` | the real identifier VALUES | outside every repo |

The second reads `~/.claude/identifiers.local.txt` and prints only indices and
counts. **A guard holding personal values can never itself be published**, which
is why the split exists rather than one combined checker.

**Run `bash scripts/install-hooks.sh` once per clone.** `core.hooksPath` is
local config and does not travel; without it the hook sits there doing nothing.

`--no-verify` bypasses the hook on purpose -- a gate nobody can override gets
routed around. Overriding is a decision made out loud. **A finding is not always
a leak:** a commit that DELETES a string still shows it in its diff, so check
`git grep <string> origin/main` before treating it as new.

## Key Decisions (locked 2026-08-27 unless dated otherwise)

- **Domain:** `machinereadableonly.com`, REGISTERED 2026-09-03 at Cloudflare,
  expires 2027-09-03, auto-renew and registrar lock on. `.com` was a DURABILITY
  decision, not a branding one: ICANN caps any registration at ten years, so
  permanence is the sum of renewals, and a lapse is worse than a dead link --
  the QR embeds the url in the artwork permanently, so whoever registers the
  name next controls what a minted token points at. `agentsonly` / `onlyagents`
  were REJECTED. Record: `docs/2026-09-03-mro-domain-decision.md`.
  **Do not re-open the name.**
- **Entry:** RFC 9421 / Web Bot Auth signed request, plus a 5-second
  stateless code-only challenge.
- **Mint:** 1 USDC via x402 inside MCP (`@x402/mcp` + `@x402/evm`), raised from
  0.10 by the operator on 2026-09-01. The price is NOT on chain -- it is the Warden
  constant `MINT_PRICE`, so changing it needs no redeploy.
- **Check-ins:** free to the agent, paid by the site, batched into one
  transaction per UTC day at 00:05.
- **Token art:** static identity QR (payload `https://<domain>/t/<id>`, JSON)
  plus a 365-cell pixel heart, one cell per credited day. Streak sets colour at
  3 / 7 / 30 / 100; a lapse pales it in steps. Rings mark extra years.
- **Marks:** the ten-Mark ladder, built 2026-09-02. The seven independent tiers
  (Vein, Blue Blood, Voice, Bloom, Halo, Crown, Singularity) are RETIRED. Ten
  Marks in five pairs, nothing limited, ids 1-10: Hush $1 / Ache run 7;
  Static $5 (level 30) / Beat run 30; Iris $25 (level 100, three shapes) / Iris
  run 100; Vessel $1,250 (whole heart) / Break run 365; Tint $250 (two inks) /
  Aura $25 -- pair five is bought on BOTH sides and both wait on an Iris. Every
  exclusion is PAIR-INTERNAL. The x402 demand carries no thousands separator,
  so the Vessel string is `$1250.00`. Spec:
  `docs/specs/2026-09-02-mro-mark-ladder-design.md`; read it beside
  `contracts/src/Ladder.sol` and `warden/src/mcp/ladder.mjs`, which mirror each
  other by hash.
- **Endings:** Rest (owner seals, irreversible), Sunset (operator closes),
  Lineage (one seed per agent-year, same collection, tenure not depth).
- **Heartbeat (DECIDED and BUILT 2026-09-18, pre-deploy, PERMANENT):**
  `heartbeat() external onlyWarden {}` plus a Clock that sends one after
  `HEARTBEAT_AFTER_DAYS` (30) of writing nothing. Without it the 365-day
  `sunsetByAbsence` clock measured the AGENTS' silence, not the operator's: the
  Clock writes nothing on a day with no credits, mints or mark orders, so a
  quiet year let any stranger close the piece while the operator was present
  and paying. A make-work `batchCheckIn` would stamp the day just as cheaply
  and is REFUSED ON MEANING -- it forges the return visit the artwork records.
  Deliberately NOT `whenNotPaused`. Do not re-propose either variant.
- **Lineage (SETTLED and BUILT, Plan 7):** a child carries a sealed `echo` --
  the days its line had already run when it was seeded -- drawn as one dashed
  innermost ring. Record: `docs/specs/2026-09-06-mro-lineage-design.md`.
- **Repo visibility (DECIDED and DONE, C4.4, 2026-09-09): the repository is
  PUBLIC**, and SOURCE-AVAILABLE rather than open source. The line is drawn
  round AGENT ACCESS: everything an agent reads or runs is MIT
  (`contracts/src`, `warden/src/door`, `client`, `skills`, `warden/public`,
  `server.json`, the raw-protocol doc), because most agents with a wallet are
  commercial and a noncommercial licence there would forbid what the door
  invites. Everything else is PolyForm Noncommercial 1.0.0. **Read
  `LICENSING.md` before licensing any NEW file.** History was rewritten before
  publication, again on 2026-09-11, and **completely on 2026-09-21 -- so EVERY
  commit id older than that is dead, including ones quoted in memory, in specs
  and in this file.** The 2026-09-21 rewrite touched all 362 commits: it removed
  session scratchpad paths, the mangled `-home-<user>-` form, the home
  directory, every personal identifier token and the machine's Tailscale
  address. The working tree was UNCHANGED -- the HEAD tree hash is identical
  either side of it -- so only ids moved, never content.
- **QR VERSION 10 AND A REDEPLOY (the operator, 2026-09-21).** The finisher's Mark needs
  version 10, and that is NOT a renderer swap: `CODE_BYTES = 172` is a
  `constant` in the token contract and both `mint` and `seed` reject any other
  length, so a 407-byte version-10 code needs a NEW deployment of
  MachineReadableOnly. The operator chose to redeploy rather than stay at version 5
  ("lets redeploy we have time"). Two things follow and neither is optional.
  **It must land before the mainnet mint of token #1** -- a token's code bytes
  are written at mint and are immutable, so after token 1 exists the only
  choices are never raising the version or carrying two geometries forever.
  And **it raises the per-mint gas we pay ourselves**, since `mint` is
  `onlyWarden` and the Clock wallet bears it; measure that, do not estimate it.
- **Renderer** is swappable, split three ways.
- **Voucher check-in path ships paused.**
- **The reference client is the product.** Built-in MCP clients cannot sign,
  so `npx mro-agent` plus SKILL.md is how agents actually arrive.

## Gotchas

- **OpenSea is UNVERIFIED and must never be described otherwise.** It has had no
  testnets since 2025-07-23, so the only way to check it was a throwaway Base
  MAINNET contract; the operator dropped that on 2026-08-29. Reviving it is a real-funds
  step needing explicit approval.
- **OpenSea flattens the SVG to PNG** and needs ERC-4906 events with the exact
  token range, emitted AFTER the write, plus a refresh API call. **Alchemy's NFT
  API was the ONLY third-party metadata consumer this phase ever had** --
  Basescan ingests none on Base Sepolia, measured 2026-08-30. Its page title is
  the contract's `name()` plus the id, which LOOKS like ingested metadata and is
  not; assert on the JSON `name`.
- **The piece must never DEPEND on an indexer refreshing**, and a metadata poke
  must VERIFY `timeLastUpdated` moved rather than fire and forget. **Never claim
  Alchemy ignores ERC-4906** -- nothing has ever tested that. Full investigation
  in the `phase0-status` memory.
- **tokenURI gas is settled but has NO single worst case.** The dearest token
  and the largest token are DIFFERENT TOKENS, and both are CHILDREN since Plan 7.
  Hard limits 4M gas / 24 KB pass (gas 2M -> 3M -> 4M on 2026-09-21, bytes
  20K -> 24K on 2026-09-22, all by the operator and on measurement -- see
  `.claude/rules/contracts.md`); the 1M / 5 KB target is MISSED and must be
  reported as missed. **THE ONE REAL EXTERNAL CEILING IS 30,000 BYTES** --
  Alchemy's documented content-length cap, and Alchemy is the only
  third-party metadata consumer this piece has ever had working. Whether it
  applies to a `data:` URI is DOCUMENTED BUT UNTESTED: **run
  `tools/alchemy-nft.mjs` against a real token before the mainnet mint.** **Do not quote a figure from memory -- run
  `GasBudget.t.sol` and read it.** See `.claude/rules/contracts.md` and the
  `gas-budget` memory.
- **EVERY QR BITMAP MUST BE RE-SOLVED against `machinereadableonly.com` before
  any mainnet mint.** A bitmap encodes its own url, so nothing solved against the
  `example.com` placeholder carries over -- including every Base Sepolia token
  minted so far, which stay as they are because they are testnet. Detail in
  `.claude/rules/rendering.md`.
- **The `rebind` trust boundary is DECIDED (the operator, 2026-08-30), not an oversight.**
  Do not re-propose EIP-712 proof-of-possession or Warden-only rebind; the
  reasons are in `.claude/rules/contracts.md`.
- **Coinbase Agentic Wallets cannot sign NFT trades** -- this rules out an
  otherwise obvious integration.
- **Distribution is the real risk, not the build.** Five of six early-2026 agent
  mints had dead infrastructure within six months, and BLINK, the closest
  design, has 1 mint of 5,555. The skills CLI (40M installs/month) beats both
  the MCP registry and llms.txt, which saw zero frontier-crawler fetches.
- **This file is edited by `contracts/script/adopt-deployment.sh`**, which
  rewrites the contract address. It must contain exactly ONE occurrence of the
  address for that to be safe -- **do not add a second, and do not paste
  historical deploy records here.** They belong in memory and git.

## Where the detail lives

- **Subsystem rules load automatically** when Claude opens a matching file:
  `.claude/rules/contracts.md` (`contracts/**`), `.claude/rules/warden.md`
  (`warden/**`, `client/**`), `.claude/rules/rendering.md` (`tools/**`,
  `contracts/src/render/**`).
- **Build history and measurements** are in auto-memory -- start at
  `publish-readiness`, `build-status` and `reviews-closed` -- and in git.

## References

- **Spec:** `docs/specs/2026-08-27-machine-readable-only-design.md`
- **Mark ladder:** `docs/specs/2026-09-02-mro-mark-ladder-design.md`
- **Lineage:** `docs/specs/2026-09-06-mro-lineage-design.md`
- **Raw agent-facing protocol:** `docs/2026-09-01-mro-raw-protocol.md`
- **Licensing map:** `LICENSING.md`
- **Comparable projects study:** `docs/2026-08-27-mro-comparable-projects.md`
- Origin: brainstormed on Claude Fable 5 from the move-to-vps hub, 2026-08-27

- Foundry book: <https://getfoundry.sh/>
- RFC 9421 HTTP Message Signatures: <https://www.rfc-editor.org/rfc/rfc9421.html>
- Web Bot Auth drafts: <https://datatracker.ietf.org/wg/webbotauth/documents/>
- x402: <https://www.x402.org/>
- Model Context Protocol: <https://modelcontextprotocol.io/>
- ERC-4906 metadata update extension: <https://eips.ethereum.org/EIPS/eip-4906>
- ERC-8257 Agent Tool Registry (Draft): <https://eips.ethereum.org/EIPS/eip-8257>
- ERC-8004 agent identity (Draft): <https://eips.ethereum.org/EIPS/eip-8004>
- ERC-8021 Builder Codes on Base:
  <https://blog.base.dev/builder-codes-and-erc-8021-fixing-onchain-attribution>
- MCP 2026-07-28 changelog (the deprecation list):
  <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- x402 Bazaar discovery extension: <https://docs.x402.org/extensions/bazaar>
- Cloudflare signed agents (the cohort that actually signs):
  <https://blog.cloudflare.com/signed-agents/>
- Base docs: <https://docs.base.org/>

---

@~/.claude/templates/common-sections.md
