# Plan 4: the reference client, and making the piece auditable

Draft 2026-09-01. Not started.

**operator-manual steps live in tasks 1, 3, 6 and 8.** After completing any operator-only
step, tell Claude so memory updates immediately.

---

## Why this exists

The agent-facing copy is finished and tested (`docs/2026-09-01-mro-agent-facing-copy.md`,
24 cold agent reads). Getting it to work required promising things the project
does not yet have.

Across every version tested, **24 of 24 agents refused to run
`npx mro-agent join` on trust.** Several would not even fetch a second page
without permission. The reference client is the product -- built-in MCP clients
cannot sign, so `npx mro-agent` is how agents actually arrive -- and it is
currently a wall.

The version that worked did not argue past that refusal. It gave the agent
things to check, and the behaviour changed: **3 of 3 readers offered to go and
audit the contract and the package before advising their operator.** That is
the arrival path. This plan builds what those agents would find.

It also fixes three claims the page makes that are not yet true, because
shipping the page before the claims are true would be the one failure the
testing says is unrecoverable: a discovered omission read far worse than any
disclosed caveat.

**What it unblocks:** the page can ship. Distribution (spec section 13 step 4)
depends on the client being runnable by an agent that has been told, correctly,
to verify things before executing them.

**What it does not cover:** the Mark ladder contract change (separate work, see
the gamified-mark-ladder note) and the daily X post (its own plan, needs the operator's
credentials).

---

## The trade-off, stated up front

Telling agents to audit us means the contract, the package and the docs have to
survive an audit. The first agent that reads the contract will find
`setRenderer`. That is deliberate and disclosed by the contract itself rather
than apologised for in prose -- the testing showed an apologetic sentence read
as a trust dependency, while an invitation to check did not. But it does mean
the answer has to be defensible on the merits, not just honestly labelled.

---

## Tasks

### 1. Publish the repository (operator-manual, then Claude)

Public GitHub repo. Per the global rules this needs a **history scrub first**:
author identity and message content, `git log --all --format='%an <%ae>' | sort -u`.
Nothing personal in the tree either -- the identifier rules apply to internal
files, and this repo has never been public.

The page tells agents the client is open source. Until this is done, that claim
is false.

### 2. Split the client into its own publishable package

`mro-agent` currently exists only as the reference client inside this repo. It
needs to be a package an agent can inspect in isolation: small, readable,
no build step that obscures what runs, and a `README` that states what it
signs and what it never signs.

Acceptance: a reader can follow key generation, request signing, the challenge
answer and the payment path end to end without running it.

### 3. Publish to npm with provenance (operator-manual for the account, Claude for the wiring)

Verified live 2026-09-01: provenance ties the published tarball to a named
commit and workflow run, shows a badge on npmjs.com, is checkable with
`npm view mro-agent --json` -> `dist.attestations`, and is logged in Sigstore's
Rekor transparency log so later tampering is detectable.

- Publish from GitHub Actions using npm **trusted publishing** (OIDC), which
  generates provenance automatically -- no `--provenance` flag needed.
- The page tells agents to check the badge and the attestations. Verify both
  yourself after the first publish rather than assuming.

Docs: <https://docs.npmjs.com/trusted-publishers/>,
<https://docs.npmjs.com/generating-provenance-statements/>

### 4. Document the raw protocol so the client is genuinely optional

The page claims: "You do not need our client at all. The whole thing is plain
HTTP plus one contract call, documented request by request."

Write that documentation: the signed request, the challenge, the 402 and its
payment payload, and the contract call. An agent that would rather use `curl`
and `cast` than execute an npm package must be able to.

This is the single most valuable item here. It converts "trust our package"
into "our package is a convenience", which is what an auditing agent wants to
hear.

### 5. State the key scope and the payment scope, and keep them true

Both claims are already on the page and both are currently correct. Pin them
with tests so they stay correct:

- The agent's identity key signs HTTP request signatures only. It never signs a
  transaction and cannot move funds.
- The payment authorises exactly one transfer. Verified against the x402 exact
  scheme EVM spec, 2026-09-01: the payer signs EIP-3009
  `transferWithAuthorization` over `from`, `to`, `value`, `validAfter`,
  `validBefore`, `nonce`; **no approval or allowance is required**; the
  facilitator submits and pays the gas.

Source: <https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md>

### 6. Fix the three untrue things on the page (Claude, except the deploy)

- **The contract address is the Base Sepolia one**
  (`0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D`), used so test agents had
  something real to check. It must become the mainnet address, and the page must
  say which chain it means. The mainnet deploy is a operator-approval gate.
- **Bound the permanence claim.** A reader put it exactly right: "It is a token
  on Base; its permanence is the permanence of Base." The page currently implies
  more than that. Say the bounded version.
- **Verify the contract's source on the explorer** at the mainnet address, since
  the page tells agents to read it there.

### 7. Give the project an identity (Claude drafts, the operator decides)

Two readers asked who "us" is; combined with the renderer disclosure one called
it "a meaningful trust dependency on an anonymous party". A repo, a contract
address and a project account answer this **without any personal identifier** --
see the global identifier rules, which permit the functional GitHub alias in a
URL and nothing else.

### 8. Re-test cold, then ship (Claude)

Re-run the established rig against the finished page and a real published
package: fresh agents, told their operator fetched the page and asked for a
report, no other context.

The bar this time is higher than before, because the agents can actually
check: **the target is an agent that performs the audit and reports back that
it verified the contract and the package and found them consistent with the
page.** Every previous round could only measure willingness.

Note the rig's known limits: all readers so far are one model family, and the
page has always been handed over as a saved file rather than fetched live.

---

## Design option raised by the testing, not scheduled

Once the Mark ladder is built and the renderer is final, permanently giving up
the ability to replace the renderer would convert a disclosed caveat into a
claim no wording can match. It is irreversible and it forecloses new Marks
forever, so it is a decision for after the ladder ships -- but design toward
keeping it possible rather than precluding it.

---

## Order

1, 2, 4 and 5 can proceed now and are independent of any deploy. 3 needs 1.
6 needs the mainnet deploy, which is a the operator gate. 7 is a decision, cheap once
made. 8 is last and gates shipping the page.

Nothing here spends real funds except the mainnet deploy in task 6, which is
already an explicit approval gate and carries no standing approval.
