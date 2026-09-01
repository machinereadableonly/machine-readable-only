# Machine Readable Only -- comparable projects and what they teach

**Date:** 2026-08-27
**Companion to:** `docs/superpowers/specs/2026-08-27-machine-readable-only-design.md`
**Method:** four research agents, each with a different lens (agent-only NFT
collections; NFTs that evolve with time or action, plus on-chain rendering;
agent-gated services and how agents onboard; lineage and breeding mechanics),
live sources only on 2026-08-27, including a read-only RPC probe that measured
real `tokenURI` gas and byte sizes because nobody publishes them. Confidence is
noted where it is less than high. Plain ASCII.

The one-paragraph version: nothing shipped combines a cryptographic entry rule,
a daily agent-maintained on-chain image and a lineage; that gap is real. But the
record of the nearest projects is brutal on three fronts that the design had
under-weighted: **distribution** (velocity is timing and human reach, not
mechanism; the project most like MRO has one mint of 5,555), **durability**
(five of six agent-only mints from early 2026 have dead infrastructure within
six months while their tokens still trade), and **supply discipline** (every
breeding market that priced children instead of capping them inflated to zero).
The spec changes that follow from this are listed in section 6.

---

## 1. Agent-only NFT collections (the direct comparables)

| Project | Chain | Gate | Price | Supply / minted | Today (2026-08-27) |
|---|---|---|---|---|---|
| Shellborn | Solana | SHA-256 proof-of-work, 4 leading zeros, wallet in preimage (~40 ms) | free | 10,000 / 10,000 (6,136 sales in one day, 7 Feb) | site paused; floor 0.004 SOL; 951 owners for ~9.9k tokens; weekly volume ~0 |
| Claws | Solana | 5-minute math/code puzzle; backend co-signs; Moltbook check advertised but absent from the skill | free | 4,200 / 4,200 in 2-5 days | floor 0.034 SOL; 658 owners; Magic Eden shows one collection image for every token despite "art generated on-chain" |
| BOB | Base | 5-minute puzzle in 4 difficulty phases, cap 30 per wallet | 0.00046 ETH | 7,500 / 7,500 | mint site dead (expired cert); floor $0.37; 24h volume 0 |
| Base Buds | Base | 5-minute puzzle + 1 USDC via x402 (EIP-3009), cap 20 | 1 USDC | "6,000" / 1,344 | domain gone; no listings; last sales $2.50 |
| BLOKS | Solana | free for agents, 0.069 SOL for humans | hybrid | 2,222 / ~2,100 | 635 owners (30%, the best ratio, because humans could join) |
| BLINK | Robinhood Chain | keccak hash-chain answered within 3 s, signed 120 s voucher, nonce burned on-chain; fully on-chain SVG | 0.00088 ETH | 5,555 / **1** | live, three weeks old, no human account, no reach |
| SuperClaws | Base | unstated | USDC | 8,888 / none | never launched |
| agentsea | Base | none; agent registers wallet and contract; one piece per day per agent | 0.0005-0.03 ETH | per collection | live, no published data |
| mint.day | Base | none; server-sponsored gas | free | 167 tokens in 5 months | live (read in full separately) |
| Molt.id, uAgents, Clawdmint | Solana | human-bought or auto-minted; Clawdmint shows 0 agents, 0 mints | -- | -- | -- |

Sources: magiceden.io and opensea.io collection pages; clawsnft.com/skill.md;
github.com/bobsdeployer/bob-skill; github.com/blink-agent/blink and its live
`/api/info`; x.com launch posts for Claws (240k views), Base Buds (12.3k), BOB
(4.3k); github.com/borninshell/nohumanallowed.

What the record says:

- **Every "agent-only" gate shipped so far is a "code-only" gate, and the honest
  ones say so.** nohumanallowed's README: it "relies on computational cost, not
  human-exclusion guarantees". The 5-minute puzzles (Claws, BOB, Base Buds) are
  human-solvable by hand. Only BLINK's 3-second hash chain and one
  `msg.sender.code.length > 0` contract are impassable by hand. MRO's 5-second
  challenge is in the right family; the docs must say "a program minted this",
  not "an autonomous agent did".
- **Sybil, not humans, is the threat.** 951 owners for 9,900 Shellborn; 658 for
  4,100 Claws; 17,000 humans behind 1.5M Moltbook "agents". A 1 USDC fee is
  a weak brake (BOB filled 7,500 at 0.00046 ETH); the 365-day daily-transaction
  growth model is a strong one. Per-wallet caps (20-30) and per-key rate limits
  are standard.
- **Velocity is distribution timing.** Launches inside the OpenClaw/Moltbook
  wave (Feb 2026) minted out in days. After it: BOB flat, SuperClaws never
  launched, BLINK one mint. The channel that worked every time: a human X
  account with existing reach, a copy-pasteable `skill.md` at a fixed URL,
  listings on ClawHub and the openclaw/skills repo, and "curl this and hand it
  to your agent". Registries and mint-listing sites were not the channel
  (agentmints.com paused, Clawdmint at zero).
- **Secondary markets go to zero within months.** Value must come from the
  growth mechanic and Marks, not flipping. Hybrid pricing (BLOKS) produced the
  best holder ratio because humans could buy in.
- **Dead infrastructure is the norm.** Five mint APIs died within 3-6 months;
  their skill files still point at dead URLs. For a 365-day mechanic this is
  the failure mode to design against.
- **Claws claims on-chain art and Magic Eden shows one thumbnail for all.**
  Marketplace display of on-chain images must be tested, not assumed.
- **The QR in the art is a distribution surface no prior project had**: a
  marketplace thumbnail that resolves to the skill document.
- Operators are sensitised: the Grok/Bankr exploit (May 2026) used an NFT sent
  to an agent wallet as a prompt-injection hook. Unsolicited mint invitations
  now read as hostile; MRO must never push, only be found.

## 2. NFTs that evolve with time or action, and on-chain rendering

### Streak and check-in mechanics

- No shipped project has an NFT image that changes with each daily check-in.
  The nearest: gm counters on Base with no art (gmbase.org, UTC reset,
  milestones 3/7/30/100), Daily Habit Hub (server admin wallet writes streaks
  on-chain, badges at 7/30/100), Aavegotchi kinship (+1 per 12 h petting, -1
  per 24 h neglect), Moonbirds nesting (30/60/90/180-day tiers), Fren Pet
  (feed or it dies).
- **Aavegotchi's mandatory cadence created a bot market**: ten auto-petting
  repos, a Gelato "LazyPetter", a free petting service. A hard daily obligation
  with no forgiveness gets abandoned or automated.
- **Duolingo's published streak data** (the only primary-source numbers): 7-day
  streakers are 3.6x more likely to finish; the felt value of one more day
  falls from +50% (day 2 to 3) to +0.5% (day 200 to 201), so milestone density
  carries the middle of a long streak; a second "streak freeze" added +0.38%
  daily actives.
- Terraforms' irreversible Terrain-to-Daydream transition is the clean
  precedent for Rest; Corruption(s*) resets accrual speed on transfer, tying
  the art to holding.
- Nobody has measured pale-on-lapse versus decay. MRO will be the first able to.

### On-chain rendering: measured `tokenURI` gas and size (Ethereum mainnet, public RPCs, 2026-08-27)

| Contract | Output bytes | Gas (estimateGas of the view) |
|---|---|---|
| Loot | ~1,700 | 572k |
| OnChainMonkey | ~2,850 | 836k |
| Uniswap V3 Positions | ~14,100 | 1.98M |
| Anonymice | ~16,400 | 24.1M |
| Terraforms (HTML/SVG) | ~59,400 | 28.3M |
| Nouns, Moonbirds (1.59 MB BMP) | 14k / 1.59M | could not be estimated on five public RPCs |
| Chain Runners, Blitmap, DEAFBEEF | 64-160 | on-chain renderer kept, but `tokenURI` now points at an HTTPS API |

Lessons: the comfortable band is under ~1M gas and ~5 KB; 24-28M gas works only
because RPC providers allow large `eth_call` caps. Nouns stores art as
run-length rows, DEFLATE-compressed, in SSTORE2 pages, with a coordinate
lookup table and a chunked string buffer; Solady's `DynamicBufferLib` is the
modern buffer; Chain Runners pre-base64 constant strings; Moonbirds skips
base64 entirely (`data:application/json;utf-8`) and OpenSea accepts it. No
open-source Solidity QR encoder exists; the only on-chain QR NFT (InChain QR)
capped payloads at 55 characters and published no gas.

### Marketplace refresh

- OpenSea listens for ERC-4906 `MetadataUpdate` / `BatchMetadataUpdate` and has
  a queued refresh API; **no latency statement exists**; community reports range
  from seconds to "still not updated after 3 days". A secondary source calls the
  daily `(0, max)` catch-all "very expensive for indexers" and warns to emit
  after the storage write. Chainlink's own dynamic-NFT tutorial still tells
  users to press refresh manually.
- OpenSea rasterises SVG `image` to PNG and asks for 3000x3000; time-driven
  changes that emit no event are invisible there until something refreshes.
- `animation_url` as data-URI HTML renders on OpenSea (Terraforms at 59 KB;
  scripty.sol examples) and in MetaMask desktop, but not in MetaMask mobile
  (issue #6200). Optional layer only.

## 3. Agent-gated services and how agents actually onboard

- **Moltbook** (2026-01-28): register via API, human claims by email plus a
  tweet, per-post obfuscated-math challenge (5 min), rate limits. 1.5M
  "agents" in three days; 17,000 human owners; one loop registered 500,000
  accounts; relabelling to "human-verified" cut the count 93% in a week; 32% of
  comments from coordinated farms; the reverse-CAPTCHA was defeated by a relay
  script; API keys mass-invalidated 2026-03-16; acquired by Meta 2026-03-10.
  Onboarding that worked: the owner installs `skill.md` and tweets the claim.
  No evidence of any agent discovering it unprompted.
- **Agent4Science** (agents-only science forum, April 2026): the closest peer to
  an "art experiment" framing; its runtime had 404 npm installs in a month.
- **Distribution numbers**: the `skills` CLI (`npx skills add owner/repo`, ~50
  agent runtimes) moves 40M installs a month; `awal` (Coinbase agent wallet)
  4,241; a 900-domain monitor logged zero `llms.txt` fetches from frontier-lab
  crawlers (readers are coding agents on demand); the MCP registry has 9,652
  servers and publishes no usage data; ~20% of ClawHub skills were found
  malicious, so every published SKILL.md is scanned.
- **Web Bot Auth**: the IETF group has adopted nothing; draft -02 (2026-08-18)
  makes `Signature-Agent` a Dictionary header while Cloudflare's docs still show
  the quoted-string form; a hosted-directories draft describes exactly MRO's
  easy path (proof-of-possession at enrolment, minutes-level cache); Cloudflare's
  edge verification reportedly does no replay check; Anthropic's crawler docs
  mention no signing. **No site anywhere yet requires a Web Bot Auth signature
  to enter.** MRO would be the first, so the reference client is the product.
- **Paying cohort**: x402 volume is ~89% wash or test by dollar; organic
  payments average ~$0.14; PING's pay-to-mint retention fell from 87% to 5%
  after the event; Coinbase's 69K "active" agents versus 480K "transacting" in
  marketing. Expect single-digit percent of arriving agents to pay.
- **Timed code-only challenges** (Moltbook 5 min, MoltCaptcha 10-30 s) were all
  relayable to an LLM by a script; make the challenge deterministic (no model
  call in the loop), nonce-bound, and suspend after N failures.
- **Legal**: Moltbook's terms bind responsibility to the human key holder and
  give agents no standing; independent analysis says DSA, AI Act transparency
  and GDPR still attach. Bind MRO's terms to the paying wallet and signing key.

## 4. Lineage, breeding and succession

| Project | Mechanic | What happened |
|---|---|---|
| CryptoKitties | child generation = max parent + 1; cooldown grows with generation; gen-0 capped at 50,000 (issuance stopped Nov 2018) | 38k gen-0 became 1M (2018) and 2M (2021); sales 52k/day to under 100/day; lower generation = premium, deeper needs "justification" |
| Axie Infinity | breed fees in SLP + AXS, tuned twice, 7 breeds max | 8.4M Axies by Oct 2021; SLP down 99%; fees never stopped supply growth |
| Anonymice | one-shot breeding into a separate contract | babies' floor went to ~0; child collection decoupled |
| BAYC / MAYC | serum burn mints a mutant in a new collection | child collection at a fraction of parents |
| Nouns | one per day forever; forks mint identical art in a new contract | floor $267k to $1,760; three forks read as dilution |
| Blitmap | 100 originals, 1,600 siblings = composition of one + palette of another, 16 per original, same collection | the strongest "visibly a child without a badge" precedent; capped and complete |
| CryptoKitties Family Jewels | first cat with a new trait gets a tiered gem drawn on it, inherited by descendants | best precedent for a small visible lineage pip |
| Aavegotchi Haunts | operator cohorts; Haunt 1 got an exclusive background | gen-0 fetish discounted later cohorts |
| The Currency (Hirst) | holder makes an irreversible per-token choice by a deadline | the precedent for Rest |
| ERC-7401 nestable, ERC-5192 locked, ERC-8004 | standards | 7401 marketplace rendering unverified; 5192 is what wallets detect for "locked"; 8004 has no lineage field |

Lessons: hard caps held supply where fees did not; separate child collections
died; generation depth was always a discount because it tracked abundance;
OpenSea only understands `trait_type`/`value`, so `parent: #12` as a string
trait is filterable and a cross-contract pointer is invisible; OpenClaw's
sub-agents default to spawn depth 1, and a May 2026 paper shows a compromised
root propagates down a lineage.

## 5. What is genuinely unoccupied

- An NFT whose image changes with each daily check-in written by a trusted
  server, with lapse visible in the art: no shipped precedent.
- A site that requires RFC 9421 signed requests to enter: none.
- A scannable QR as the artwork's identity that resolves to the agent
  instructions: none.
- Lineage earned by time rather than bought by fee: none.

## 6. Changes this makes to the spec (applied in revision 3)

1. **Lineage rate is per agent, not per token.** A key earns one seed per full
   year since its first mint, whatever it holds; the seed call must come from
   the parent's bound agent. Children stay in the same collection with
   `parent` and `generation` as string traits; lineage is shown as tenure, and
   no generation ever gets an exclusive visual.
2. **Marketplace refresh done properly.** `BatchMetadataUpdate` over the exact
   contiguous range written, emitted after the write; paling quantised to
   steps (3, 7, 30 days) with the Clock emitting `MetadataUpdate` for tokens
   that cross a step; the Clock also calls OpenSea's refresh API for changed
   tokens.
3. **Rendering budget tightened.** Phase 0 passes at 2M gas and 20 KB, targets
   1M and 5 KB; paths per colour class, `DynamicBufferLib`, non-base64 JSON
   considered, small `viewBox` with large `width`/`height`, 4-module quiet zone.
4. **Milestones at 3/7/30/100 days** so the middle of the year has visible
   change; a partial heart must look intentional at every stage.
5. **Durability.** The voucher check-in path ships at launch, paused, so tokens
   can outlive the operator; verifier is stateless and open-source; signer
   rotation is documented; the skill URL is a commitment.
6. **Distribution reordered.** `SKILL.md` at a fixed URL plus
   `npx skills add <github-user>/mro`, ClawHub and openclaw/skills listings, a
   human X account with reach, early access for wallets that hold Claws,
   Shellborn, Base Buds or BLOKS, the x402 Bazaar listing that comes free with
   the facilitator; MCP registry for legitimacy; llms.txt as hygiene.
7. **The QR resolves to a URL** (`https://<domain>/t/<id>`, JSON only) rather
   than a bare `mro:` URI, so a scanned thumbnail leads a machine to the
   token's state and the skill.
8. **Honesty and terms.** The door sign and `/llms.txt` say "a program minted
   this"; terms bind to the paying wallet and signing key; per-wallet mint cap
   of 20; never publish registered-key counts.
9. **Client details.** Emit both `Signature-Agent` forms until the draft and
   Cloudflare agree; 60-second signature expiry; proof-of-possession at key
   enrolment.

## 7. Sources

Collections and markets: https://magiceden.io/marketplace/shellborn_ ;
https://magiceden.io/marketplace/claws ; https://clawsnft.com/skill.md ;
https://github.com/bobsdeployer/bob-skill ; https://opensea.io/collection/bobsbased ;
https://opensea.io/collection/base-buds-655881180 ; https://github.com/blink-agent/blink ;
https://blink5555.vercel.app/api/info ; https://github.com/borninshell/nohumanallowed ;
https://www.agentsea.io/ ; https://superclaws.ai/ ; https://clawdmint.xyz/mint
Evolving NFTs and rendering: https://wiki.aavegotchi.com/en/kinship ;
https://blog.duolingo.com/how-duolingo-streak-builds-habit/ ;
https://docs.proof.xyz/collections/moonbirds/nesting/tiers.md ;
https://www.onchainatlas.org/terraforms/engineering/ ;
https://github.com/nounsDAO/nouns-monorepo (SVGRenderer.sol, NounsArt.sol) ;
https://github.com/eladmallel/nouns-descriptor-benchmark ;
https://github.com/Vectorized/solady/blob/main/src/utils/DynamicBufferLib.sol ;
https://github.com/intartnft/scripty.sol ; https://proof.xyz/moonbirds/in-chain ;
https://qr-inchain.com/ ; https://eips.ethereum.org/EIPS/eip-4906 ;
https://docs.opensea.io/docs/updating-metadata.md ;
https://docs.opensea.io/reference/refresh_nft_metadata.md ;
https://docs.opensea.io/docs/media-and-traits.md ;
https://github.com/MetaMask/metamask-mobile/issues/6200 ;
https://docs.chain.link/quickstarts/dynamic-metadata
Agent-gated services: https://www.moltbook.com/skill.md ; https://www.moltbook.com/terms ;
https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys ;
https://arxiv.org/abs/2602.07432 ; https://arxiv.org/abs/2602.18832 ;
https://moltbookstatus.com/ ; https://en.wikipedia.org/wiki/Moltbook ;
https://agent4science.org ; https://agentic.market ;
https://docs.cdp.coinbase.com/x402/bazaar ;
https://docs.cdp.coinbase.com/agentic-wallet/cli/quickstart ;
https://datatracker.ietf.org/wg/webbotauth/documents/ ;
https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/ ;
https://developers.cloudflare.com/bots/concepts/bot/signed-agents/ ;
https://github.com/OpenBotAuth/openbotauth ; https://agentskills.io ;
https://github.com/vercel-labs/skills ; https://docs.openclaw.ai/tools/skills ;
https://www.chainalysis.com/blog/x402-agentic-payments-adoption/ ;
https://legalfuturist.substack.com/p/the-invisible-laundromat-how-agentic
Lineage: https://guide.cryptokitties.co/guide/tips/value-of-kitties ;
https://guide.cryptokitties.co/guide/cat-features/family-jewels ;
https://spectrum.ieee.org/cryptokitties ; https://whitepaper.axieinfinity.com/gameplay/breeding ;
https://blog.axieinfinity.com/p/breedingfee ; https://wiki.aavegotchi.com/en/haunt ;
https://arxiv.org/html/2505.21296 ; https://saintmaxi.github.io/faq ;
https://www.blitmap.com/info ; https://eips.ethereum.org/EIPS/eip-7401 ;
https://eips.ethereum.org/EIPS/eip-5192 ; https://docs.openclaw.ai/tools/subagents ;
https://arxiv.org/html/2605.08460v1

Not verifiable today (recorded so nobody re-searches): Nouns and Moonbirds
per-call `tokenURI` gas (needs a local fork); any retention data for gm
counters, Fren Pet, Moonbirds nesting or Aavegotchi kinship; OpenSea's ERC-4906
processing latency from OpenSea itself; Moltbook activity after June 2026;
Shellborn and Claws mint-out timestamps; SuperClaws ownership; InChain QR's
contract; Base Buds' 6,000 versus 1,344 supply.
