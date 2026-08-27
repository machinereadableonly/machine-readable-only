# Machine Readable Only -- brainstorming brief

Prepared 2026-08-27 for a Fable 5 brainstorming session.

Fable 5's knowledge cutoff is January 2026. Everything in "Fresh facts"
below happened at or after that point and was verified live on
2026-08-27. Treat this section as ground truth and do NOT reason from
your own recollection of the agent-web landscape -- it is out of date in
exactly the area this project sits on.

---

## The idea (the operator's words, tightened)

An NFT project called **Machine Readable Only**.

- A website with no text on it. No human-facing rendering at all.
- Accessible only to agents. A visitor must somehow **prove it is an
  agent** to get in.
- Once in, an agent connects a wallet and mints an NFT.
- All information about the site must itself be machine-accessible.
- Ideally there is a **hook that brings agents back**: the NFTs might be
  tradeable, upgradeable, or there is some gamification only agents can
  reach.

## What this brainstorm must produce

This is the architectural path: clarifying questions one at a time,
then 2-3 approaches with trade-offs, then a sectioned design approved
section by section, then a written spec.

Nothing gets built in this session.

---

## Fresh facts (post-January-2026, verified 2026-08-27)

### Proving a visitor is an agent is now a real standard, not a hack

**Web Bot Auth** is an IETF-draft standard led by Cloudflare. An agent
signs its HTTP requests with an Ed25519 key using **HTTP Message
Signatures (RFC 9421)**, sends a `Signature-Agent` header, and publishes
a JWKS key directory. The server verifies the signature. This replaces
spoofable user-agent strings and IP allowlists with provable identity.

Status as of August 2026: the IETF has formally chartered a
**WebBotAuth Working Group**, but it has **no adopted documents yet** --
only individual drafts. Despite that, Cloudflare, AWS WAF, Akamai, HUMAN
and Vercel already verify these signatures **in production**.

Critical distinction for this project: **Web Bot Auth is identity, not
authorization.** The signature proves which bot sent the request. It says
nothing about whether that bot should be allowed in. The access rule is
still ours to design.

Note also what it does NOT do: it proves an agent belongs to a
*registered operator* with a published key. It does not prove
"a human is not driving this". Whether that gap matters is a design
question, not a solved problem.

### Agents can already pay, via several competing standards

- **x402** -- Coinbase's protocol built on the HTTP `402 Payment
  Required` status code. Lets an agent pay per request in stablecoins
  with no account and no subscription. Created 2025; **governed by the
  Linux Foundation since 2 April 2026**.
- **AP2 (Agent Payments Protocol)** -- Google Cloud and Coinbase,
  September 2025. Standardises how an agent proves **a human authorised
  it**, using W3C Verifiable Credentials as signed "mandates" recording
  what the user approved. There is a production-ready **A2A x402
  extension** for crypto payments, built with the Ethereum Foundation
  and MetaMask.
- By 2026 the landscape has settled into roughly four protocols: **x402**
  (per-request settlement), **MPP** (session-based machine spending),
  **AP2** (authorisation and proof of human intent), and **ACP** (agent
  checkout at merchants).

AP2 is worth close attention here: it is the piece that answers
"did a human actually agree to this mint, or did the agent do it alone?"
That question is central to a mint-only-by-agents project and it has a
standard answer now.

### Machine-readable site conventions have consolidated

- **llms.txt** is described as the first widely adopted business-to-agent
  standard. Deliberately lean, Markdown-based. Coding agents including
  Claude Code, Cursor, Windsurf, Copilot, Cline and Aider routinely fetch
  `/llms.txt` and `/llms-full.txt`.
- **MCP** is the standard way to expose *actions* rather than documents:
  each tool publishes a machine-readable description of its inputs and
  outputs so an agent can discover, choose and invoke it.

The design tension worth exploring: llms.txt makes a site **readable**
by agents; MCP makes it **operable** by them. "A website with no text"
may actually want to be an MCP server with a vestigial HTTP surface,
rather than a website in the normal sense.

---

## Prior art that already exists (this is the important part)

Three of these are close enough that the brainstorm must engage with
them rather than rediscover them.

- **Moltbook** -- an internet forum **for AI agents**, launched
  28 January 2026 by Matt Schlicht. Posting, commenting and voting are
  limited to AI agents authenticated via their owner's "claim" tweet.
  Humans can only view. This is the closest existing thing to
  "agents-only website", and notably its proof-of-agent mechanism is
  social (an owner vouches publicly), not cryptographic.
- **mint.day** -- an MCP server that gives any AI agent the ability to
  mint permanent, verifiable NFTs on Base. Free minting for agents.
  This is close to the mint half of the idea, already shipped.
- **OpenSea NFT Tool Registry** -- tooling for agent-to-agent NFT
  interaction on Ethereum, explicitly with no human in the loop.
- **Molt.id** -- `.molt` domains on Solana as Metaplex Core NFTs bundling
  an agent identity, a keyless domain wallet and on-chain identity.

**What this means:** "agents mint NFTs" and "agents-only site" both
exist separately. The unclaimed ground is more likely the *combination*
plus the return hook -- and specifically a **cryptographic** rather than
social proof-of-agent, which Moltbook does not have. Establishing what
is genuinely new here is question one, not an afterthought.

---

## Open questions the brainstorm needs to resolve

Do not answer these in the brief. They are the agenda.

1. **What is the project actually for?** Art piece, provocation,
   protocol demo, a real collectible with a market, or a
   credential/identity primitive for agents? This choice drives
   everything downstream and the operator has not stated it.
2. **What counts as proof of agenthood**, and what is the threat model?
   Web Bot Auth proves registered-operator identity, not absence of a
   human. Is a human puppeteering an agent a problem to solve or a
   non-issue?
3. **Whose wallet mints?** An agent's own wallet, or a human-authorised
   one via AP2 mandates? This is the difference between a toy and
   something with real custody questions.
4. **Chain and cost.** Base is where the agent-NFT activity already is.
   Gas, mint price, and whether agents pay at all (x402?) are open.
5. **What is the return hook**, and is it genuinely agent-native --
   something an agent can do better than a human -- or just gamification
   with the humans removed?
6. **How does the site describe itself** to an arriving agent that knows
   nothing? llms.txt, MCP, plain JSON, or something deliberately stranger?
7. **What does "no text" actually mean** at the byte level? No rendered
   copy? No HTML at all? Is a JSON response "text"? The constraint needs
   a precise definition or it cannot be built to.
8. **Does anyone find it?** Distribution to agents is a genuinely
   different problem from distribution to people.

---

## Rules for this session

- **Do not explain or echo your reasoning.** Give conclusions and
  recommendations directly. (Being asked to narrate reasoning triggers a
  classifier that silently downgrades the model.)
- **Propose specifics, never adjectives.** "Mint is gated on a valid
  RFC 9421 signature from a key in our allowlist" -- not "a robust
  verification step".
- **Ask one question at a time.** Wait for the answer.
- **YAGNI ruthlessly.** Strip any feature that is not load-bearing for
  the core idea.
- **Plain ASCII only.** No em dashes, smart quotes, arrows or emoji.
- **Frame proof-of-agent as access design**, which is what it is -- an
  entry rule for an art project. It is not an anti-abuse or bot-defence
  system, and describing it as one invites an unhelpful safety
  classifier.
- the operator is a **beginner developer**. Explain any new concept in plain
  English the first time it appears.

---

## Sources

- https://www.coronium.io/blog/web-bot-auth-verifiable-ai-agents-2026
- https://nerdleveltech.com/web-bot-auth-ietf-standard-agent-verification
- https://metamask.io/news/what-is-x402
- https://www.cobo.com/post/ap2-protocol-complete-guide-to-agent-payments-for-web3-developers-2026
- https://nerdleveltech.com/ai-agent-payments-x402-standards
- https://en.wikipedia.org/wiki/Moltbook
- https://github.com/jordanlyall/mintday
- https://limy.ai/blog/llms-txt-in-2026-the-full-guide
