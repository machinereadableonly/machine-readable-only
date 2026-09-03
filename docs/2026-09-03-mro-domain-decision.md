# The Domain Decision

**Date:** 2026-09-03
**Status:** DECIDED and REGISTERED
**Domain:** `machinereadableonly.com`

## Why this mattered more than a normal domain choice

The token's artwork embeds `https://<domain>/t/<tokenId>` in a QR code that is
written to the chain once at mint and never rewritten. The spec commits, at
section "Durability commitments", that `/t/<id>` is a stable URL "for the life
of the piece", and that commitment exists because five of the six comparable
agent-only mints from early 2026 had dead URLs within six months while their
tokens still traded.

So this is not a marketing choice that can be revised. Two consequences shaped
the decision:

1. **The string is permanent per token.** Once a token is minted, its QR
   carries that host forever. A later rename does not reach minted tokens.
2. **A lapse is worse than a dead link.** If the registration ever expires,
   anyone can register the name and serve whatever they like at a URL that is
   baked into the artwork. That is the failure mode to design against, and it
   is the one that decided the TLD.

## What was researched, and what it settled

### Length does not constrain the name

`docs/phase0-results.md` had already measured this. QR version 5 level L
carries 108 data codewords; the payload consumes them first and the remainder
is the entire budget the QArt solver has for shaping the heart. A 20-character
placeholder domain cost 0.84 points of heart match, and the conclusion recorded
there was that "the domain choice is not constrained by the artwork at any
plausible length".

That freed the choice to be made on meaning rather than brevity. The measured
cost of the name actually chosen is in "What it costs the artwork" below, and
it is larger than that extrapolation predicted.

### The TLD is a durability decision

ICANN caps any single registration at ten years. There is no mechanism to buy a
domain permanently; permanence is the sum of renewals, indefinitely.

A new gTLD carries a risk a legacy TLD does not. Under the standard new gTLD
Registry Agreement, ICANN may place a failing registry in the Emergency
Back-End Registry Operator (EBERO) programme, but EBERO is explicitly temporary
and provides only the five critical registry functions. If a failed TLD is not
transitioned to a successor operator it may be removed from the root zone
entirely. `.art`, for example, is operated by UK Creative Ideas Limited and
holds roughly 325,000 registrations.

`.com` is the one TLD where that scenario is not plausible. Verisign's registry
agreement runs to 2030 with presumptive renewal. The wholesale price rises to
$10.97 on 2026-11-01, with up to 7 per cent annual increases permitted in the
final four years of each six-year term.

**Decision: `.com`.** The registry-continuity risk of a new gTLD is small, but
it is the wrong risk to accept on the one string that can never be changed.

### Availability

Checked by RDAP on 2026-09-03. Available at the time of the decision:
`machinereadableonly.com`, `.org`, `.art`, `.xyz`; `machine-readable-only.com`;
`readableonly.com`; `proofofreturn.com`; `mro.art`; and a group of `.art` names
(`comeback`, `revisit`, `returns`, `notforhumans`, `nohumans`, `machineonly`,
`onlymachines`, `machineheart`, `readable`, `agentsonly`, `onlyagents`).

Taken: `machinereadable.com` / `.art` / `.xyz`, `machine-readable.com`,
`mro.xyz`, `notforhumans.com`, and every `.com` in the "door" direction.

### The names that were considered and rejected

**`agentsonly` and `onlyagents`** were explicitly considered and dropped, for
three reasons:

- `agentsonly.com` is an active company, an AI plus human CX and
  data-annotation platform, registered since 1999 and renewed to 2029. That is
  a live brand collision in this exact sector, and it argues against the name
  in any TLD.
- `onlyagents.com` is parked and for sale through GoDaddy at an unpublished
  make-offer price, held by a domain investor.
- Both name the door rather than the artwork. The piece is a record of an
  agent's return visits; "agents only" is the entry condition. The project's
  own framing rule treats proof-of-agent as an access rule FOR the artwork, not
  as the artwork. Putting the gate into every token's QR forever would make the
  gate the subject. "OnlyAgents" also reads as an OnlyFans pun, which is the
  first association most readers will make.

**`proofofreturn.com`** was the strongest alternative and remains available. It
names what the token is rather than what the project is called. It was not
chosen because a single identity across repository, package, domain and email
was judged more valuable than a more descriptive name.

## What was chosen, and why

**`machinereadableonly.com`.**

It matches the GitHub account `machinereadableonly` exactly, and the project
name exactly. One identity across the repository, the npm package, the domain
and the project email, with nothing to explain or reconcile.

## What it costs the artwork, measured

Measured with `tools/payload-length-check.mjs`, three token ids under each
domain so the domain is the only variable:

| payload | chars | free bits | mask | match | gate cost | masks rejected |
|---|---|---|---|---|---|---|
| `example.com/t/1` | 24 | 400 | 7 | 64.9% | 0.0 | 0 |
| `example.com/t/12` | 25 | 395 | 7 | 63.9% | 1.5 | 1 |
| `example.com/t/55` | 25 | 395 | 1 | 63.3% | 0.9 | 1 |
| `machinereadableonly.com/t/1` | 36 | 340 | 0 | 61.9% | 0.0 | 0 |
| `machinereadableonly.com/t/12` | 37 | 335 | 4 | 62.2% | 0.0 | 0 |
| `machinereadableonly.com/t/55` | 37 | 335 | 0 | 61.6% | 0.0 | 0 |

The full payload carries the scheme and a trailing `#`, so token 1 reads
`https://machinereadableonly.com/t/1#` at 36 characters. Match is scored over
all 1,369 modules in the grid, not over the heart's own cells.

**The heart cost 2.13 points, averaged over the three ids, for 12 extra
payload characters.** That is roughly twice what the Phase 0 extrapolation
predicted. That extrapolation was drawn from a nine-character increase and does
not hold linearly out to twelve; three ids is a small sample and no better
slope should be claimed from it. The honest statement is that the measured cost
is 2.1 points and the linear estimate under-predicted it.

**Robustness did not degrade, it improved.** All three solves passed the decode
gate on their first-choice mask, with zero gate cost and zero masks rejected.
Under `example.com`, two of five ids needed a fallback mask. Both long domains
tested have now shown this, so the claim is that a realistic domain carries no
robustness penalty.

Rendered side by side at
`tools/out/domain-compare/compare-whole.png`, the real domain's heart has a
rounder, more solid centre and slightly less definition on the right flank. It
is different, not worse, and it is legible.

## The registration

Verified by RDAP on 2026-09-03 immediately after purchase.

| | |
|---|---|
| Registrar | Cloudflare, Inc. |
| Registered | 2026-09-03T06:46:44Z |
| Expires | 2027-09-03T06:46:44Z |
| Term | 1 year, auto-renew ON |
| Status | `client transfer prohibited` (registrar lock on) |
| Nameservers | `CLAYTON.NS.CLOUDFLARE.COM`, `FIONA.NS.CLOUDFLARE.COM` |

Cloudflare Registrar was chosen because it sells at cost with no renewal
markup, includes WHOIS redaction at no charge, and the project's VPS runbook
already puts every project's DNS on Cloudflare, so registration and DNS stay in
one place. WHOIS redaction is load-bearing here, not a convenience: without it
the registrant's real name and address are published.

### The term, and the residual risk

A ten-year term was recommended, on the reasoning that ten years is the most
permanence ICANN allows anyone to buy in one transaction, and that prepaying
also locks today's price against Verisign's four scheduled increases.

**A one-year term with auto-renew was chosen instead.** Recorded here as a
decision, not an oversight.

The residual risk is stated plainly: auto-renew is a real mitigation, but it
depends on an active Cloudflare account and a valid payment card holding good
for as long as the piece is meant to last. A card that expires, an account that
lapses, or a failed charge that goes unnoticed all end in the same place, and
that place is someone else controlling a URL embedded in the artwork.

The term can be extended at any time without changing anything else. Adding
years to the existing registration is the cheapest available reduction of the
only unbounded risk this project carries.

## What this unblocks, and what must happen before mainnet

Unblocked now: deploying the Warden behind nginx and certbot, a project email
address at the domain, and the treasury work that was waiting on a domain.

Two items follow directly from this decision:

1. **Every QR bitmap must be re-solved against the real domain before any
   mainnet mint.** A bitmap encodes its own URL, so nothing solved against
   `example.com` can carry over. No mainnet token has been minted, so nothing
   is lost; the Base Sepolia tokens carrying `example.com` are testnet and stay
   as they are.
2. **`MRO_DOMAIN` must be set** to `machinereadableonly.com` in `warden/.env`
   and `contracts/.env`, replacing the `example.com` placeholder. It is
   load-bearing: `warden/src/main.mjs` refuses to start without it, and it
   determines the RFC 9421 challenge binding.

Not yet available to Claude: there is no Cloudflare API token on the VPS and no
Cloudflare CLI installed, so DNS records must be added through the dashboard as
the `add-new-project` runbook currently specifies. A token scoped to Zone / DNS
/ Edit on this single zone, stored in the infra secrets file, would let that
step be scripted.

## Sources

Checked live on 2026-09-03.

- ICANN, Renewing Domain Names, and the ten-year maximum registration period
- ICANN, Emergency Back-End Registry Operator programme and FAQ
- Cloudflare Registrar documentation, registration periods and multi-year terms
- Verisign `.com` registry agreement pricing, 2026 increase to $10.97
- RDAP: `rdap.verisign.com` for `.com`, `rdap.org` for other TLDs
- `docs/phase0-results.md`, "A realistic domain costs about 0.8 points of heart"
- `tools/payload-length-check.mjs`, run 2026-09-03
