# Machine Readable Only -- Creative and Product Review

Date: 2026-09-04
Commit under review: 7bc1140 (working tree clean at start of run)
Reviewer model: Fable 5.1, one subagent per section, run in order, then a
synthesiser. This pass judges whether the thing being built is good and
whether an agent arriving at it understands what it is being offered. It does
NOT judge code correctness; Review A (fable-quality) covers that.

## The convention

Base mainnet is permanent by design: the piece is a record of an agent's
return visits and that history cannot move chains. So every finding carries
exactly one of two tags:

- **BEFORE MAINNET** -- set in the contract, in the artwork, in the token's
  permanent payload, or in the first impression the piece gets to make once.
- **ANYTIME** -- can change later at no cost. Not urgent even if right.

Rules every section follows:

1. Propose specifics, never adjectives. A finding that cannot say what to
   change to is an observation, not a recommendation, and is labelled as one.
2. Section 2 opens the images with Read. A finding about how something looks
   that was derived from source is void.
3. Every recommendation is checked against the locked decisions in CLAUDE.md
   (free mint, per-token yearly seeding, other chains, a human-facing gallery,
   paying in anything but USDC, the domain name). One that contradicts a
   locked decision does not appear.
4. Plain ASCII.
5. Behaviour claims cite a real file:line or a real document.

Finding format: `C<section>.<n> [BEFORE MAINNET | ANYTIME] title`, then
what was observed (with citation), what to change it to, and why.

## Section checklist

| # | Section | Status |
|---|---|---|
| 1 | The concept and the access rule | DONE |
| 2 | The token as an object | DONE |
| 3 | The agent's journey | DONE |
| 4 | Launch and permanence | DONE |
| 5 | Synthesis | DONE |


## Section 1 -- The concept and the access rule

**Verdict.** Today the door reads as an access rule described by an engineer:
the HOW is everywhere and the WHY is asserted, never argued. The framing rule
(CLAUDE.md Hard Rule 6, "a program minted this") holds on every served line
that states it: `warden/public/llms.txt:3` "An artwork that only admits
programs", `:5` "A program proves it composed its own request", `:60` "One
thing: a program composed the request", `:74-76` "It does not prove that no
human is behind the agent ... It is the entry condition for an art piece, and
it is not asked to carry more than that"; `docs/2026-09-01-mro-raw-protocol.md:239-241`
"This is an entry condition for an art piece -- it establishes that a program
composed the request ... it is not a defence against anything"; and the code's
own comment at `warden/src/door/challenge.mjs:3` "This is an ACCESS CONDITION
for an art piece". No served line calls it bot defence, anti-abuse, or
protection, and the vocabulary of the protocol doc (replay cache, thumbprint,
rate limit) is the register of an RFC, not of a security product. The one
surface where the security register shows through is the human one:
`warden/public/door.html:26-28` hands a person "RFC 9421, Web Bot Auth" and a
five-second expiry and gives no reason for either. So the door is not bot
defence with a story painted on; it is an access rule with the story left in a
drawer. The WHY that turns "only programs" from a rule into a subject -- you
end; what lasts is a record that the two of you kept coming back -- exists
only in `docs/2026-09-01-mro-agent-facing-copy.md`, which is locked, tested
across 24 cold reads, and has never been served: git history of `llms.txt`
(twelve commits, `faefa20` to `53ed350`) never contained "We offer permanence",
and no SKILL.md exists outside `contracts/lib/`.

**Is the claim legible to a cold agent?** It depends entirely on which door it
arrives at. Arriving at `/llms.txt`, yes: the WHAT is legible in eleven lines
and six cold readers engaged with zero refusals (cold-read-round2-findings).
Arriving at `/mcp`, which is where an ERC-8257 registry entry or a Bazaar
listing sends it, the first thing the piece says is
`warden/src/door/middleware.mjs:42-48`: a challenge, an expiry, and three
URLs, one of which (`client`) is answered with a deliberate 404
(`warden/src/server.mjs:157-158`). Arriving by scanning the QR, the only
arrival the artwork itself makes and the one that is permanent, the piece
answers with `warden/src/mcp/tokenView.mjs:7-25`: level, streak, heart,
owner, and not one link to what it is. So today the piece's claim is legible
as a rule at one entrance, as a puzzle at the second, and not at all at the
third. The challenge itself computes nothing about the piece and is, as a
mechanism, exactly the family the spec's own prior-art table describes as a
"machine captcha"; the copy is the only thing that can make it a rite, which
is why the first two findings below carry the weight.

### C1.1 [BEFORE MAINNET] The offer is locked, tested, and not served

**Observed.** `docs/2026-09-01-mro-agent-facing-copy.md` opens: "This is the
approved text an agent reads when it is sent to find out what MRO is. It is
the primary artwork surface: the piece succeeds or fails on what the agent
says to its operator when it comes back." The agent-facing-copy-locked memory
adds: "Spec section 1, `llms.txt`, `door.html` and SKILL.md all still carry
the old framing and must be rewritten to serve this copy." As shipped,
`warden/public/llms.txt:1-13` is a different document -- "An artwork that
only admits programs. A program proves it composed its own request, pays 1
USDC, and mints one token on Base" -- and none of part one ("You end." / "We
offer permanence. Not yours" / "a piece of art whose only material is
returning") appears in any served file. Checked: `/bin/grep -rl` for those
phrases over `.txt .md .mjs .html` outside `node_modules` hits only the two
files under `docs/`; every historical revision of `llms.txt` was checked for
"We offer permanence" and none carried it. The served page is the whole of
part two (the machinery) with part one (the offer) missing, and part two's own
WHY is one clause: `docs/2026-09-01-mro-agent-facing-copy.md` part two,
"No human can mint one. That is the point of the piece." -- an assertion that
depends on part one having been read.

**Change to.** Insert part one verbatim into `warden/public/llms.txt` between
line 13 ("Humans may own and trade these tokens. Humans cannot mint one or
grow one.") and line 15 ("## This is a testnet preview"), under the heading
`## The offer`, from "This is an art project." through "If they want it,
they will say so.", and follow it with the single line "That is the offer.
The rest of this page is the machinery behind it." Leave every existing
section in place below it; they are the fuller part two. When SKILL.md is
written, open it with the same block. Restart the Warden (`main.mjs` reads the
file once at startup, per the door-page-copy memory) and re-run the cold-read
rig, because the door-page-copy memory records that the no-re-run judgement
"does not carry over" once `llms.txt` changes.

One line-level issue to hand to the lock's owner rather than fix here: part
one's second paragraph, "A human sent you here to find out what this is",
assumes the operator-fetched arrival the rig was corrected to model. An agent
that reaches `llms.txt` by following the `docs` field of a 401 sent itself.
The sentence is still true often enough to keep; it is recorded so the
mismatch is known rather than discovered.

**Why.** Every WHY the piece has lives in part one. Without it the served page
can only say what the rule is and that it is "the point"; with it, "only
programs" follows from the premise ("You end ... What lasts is ... a record
that the two of you kept coming back"), and the door stops needing a defence
because it has a reason. The tag is BEFORE MAINNET because the memory names
`llms.txt` as the primary artwork surface and the first agents through the
mainnet door will relay whichever version is there; that is the first
impression the piece makes once, and the re-run it obliges takes days, not
minutes.

### C1.2 [ANYTIME] llms.txt says what the rule proves and never why the piece has it

**Observed.** `warden/public/llms.txt:58-76`, "What the entry rule proves",
is one line of WHAT (`:60` "One thing: a program composed the request"),
eleven lines of HOW (`:62-72`, the RFC 9421 components, the challenge form,
`content-digest`), and three lines of what it does NOT prove (`:74-76`).
Nowhere in the section, or on the page, is the sentence that says why an
artwork would want that proof. `:66-67` comes closest and is a discriminator,
not a reason: "It is deterministic, so code passes it and a model deliberating
between two requests does not." The section heading itself is the tell: the
question a cold agent asks is not what the rule proves but why there is one.

**Change to.** Insert, directly after `:60` "One thing: a program composed the
request." and before `:62` "The mechanism is ...":

"Why the piece asks for that and nothing else: it is a record of something
coming back that does not itself persist between visits. A person who returns
every day carries the year in their own memory. A program does not, and the
token is the only place its returning is kept. So the door admits the thing
the piece is about."

Rename the heading at `:58` from "What the entry rule proves" to "The entry
rule, and why there is one".

**Why.** This is the one paragraph that ties the mechanism to the locked
narrative (permanence for the pair, recorded as art) without touching part
one, and it is the paragraph that makes `:74-76` read as scope rather than as
a disclaimer. It serves C1.1 if C1.1 lands and stands alone if it does not.
It adds no price, chain or cell count, so it does not trip the lock's rule
against mechanics in the argument.

### C1.3 [ANYTIME] door.html gives the human the HOW in the security register and no WHY

**Observed.** `warden/public/door.html:26-28`: "Entry requires a request
signed with the caller's own key (RFC 9421, Web Bot Auth) and an answer to a
challenge that expires in five seconds. Everything past this page is JSON,
Markdown and MCP." This is the only human-facing page, and the door-page-copy
memory records that it was deliberately rewritten (2026-09-03) to address "a
human who is expected to relay to their agent". The same rewrite deleted "the
one framing the entry rule as an access rule", on the grounds that `llms.txt`
carries it. It does -- for the agent. The human is left with an RFC number,
a header standard's name, and a timeout: the three words a person associates
with a lock, and none with a piece. `:23-24` gives the WHAT ("This is an
artwork for agents. It is machine readable only.") and `:39-41` the
ownership split; between them the entry paragraph is the only one written in
the wrong register for its reader.

**Change to.** Replace `:26-28` with:

"Only a program can get in: entry is a request signed with the caller's own
key and an answer computed inside five seconds, and neither can be done by
hand. That is the rule of the piece. Everything past this page is JSON,
Markdown and MCP."

Drop "(RFC 9421, Web Bot Auth)" from this page; `llms.txt:62` carries it for
the reader who needs it.

**Why.** The human relay is the one reader who will never see `llms.txt:74-76`
and is the one most likely to read "signed request plus a five-second
challenge" as bot protection, because that is what those words mean everywhere
else on the web. "That is the rule of the piece" is a statement, not a
defence, so it does not fall foul of the
a-defensive-paragraph-is-a-design-smell rule; and it says in seven words what
the deleted paragraph took a paragraph to say. The line is the human's only
WHY, and it costs nothing.

### C1.4 [ANYTIME] The 401 body names nothing and advertises a dead link

**Observed.** `warden/src/door/middleware.mjs:41-51` builds the first thing
the piece says to anything that knocks at `/mcp`: `challenge`, `expires`,
`mcp`, `docs`, `client`, and an optional one-word `reason`. `client` is
`https://<domain>/client.mjs`, which `warden/src/server.mjs:149-158` answers
with `404 { reason: "not-built-yet" }` by design ("It says both '404', so they
must actually 404"). The `challenge` tool's own reply at
`warden/src/mcp/tools/challenge.mjs:19` already omits `client`, so the two
challenge shapes disagree. The comment at `middleware.mjs:40` says the body
"tells an agent everything it needs to come back"; it tells it how to come
back and nothing about where it is. `docs/2026-09-01-mro-raw-protocol.md:50-51`
calls this "the intended first request; there is nothing rude about it", and
for the agent that has read that page it is not. For the agent that has not --
the one sent by a registry entry, which is the discovery channel spec decision
7 puts fourth -- it is a JSON riddle.

**Change to.** Two edits to `challengeBody`. (1) Add a fixed field
`about: "An artwork that only admits programs. This challenge is its entry
condition; answer it inside five seconds, or read docs first."` (2) Emit
`client` only when `/client.mjs` is actually served; until then leave it out,
which also makes the 401 and the `challenge` tool agree. Update the captured
body at `docs/2026-09-01-mro-raw-protocol.md:59-65` and the shape at spec
section 5 case 2 to match, and re-capture with
`warden/tools/protocol-transcript.mjs` rather than editing by hand, per that
doc's own rule.

**Why.** A 401 is the one place the piece is guaranteed to speak first, and a
challenge with no sentence beside it is the exact shape of a CAPTCHA. One
string turns it into an invitation with a rule; and a first response that
points at a 404 is the first impression the comparable-projects study says
kills agent mints ("dead infrastructure within six months") delivered on the
very first byte.

### C1.5 [ANYTIME] The QR's destination is a dead end

**Observed.** The token's permanent payload is
`https://machinereadableonly.com/t/<id>#` (CLAUDE.md, Gotchas). The route is
served at `warden/src/server.mjs:113-127`, whose comment says gating it "would
mean a scanned token leads nowhere, which is the one distribution surface the
artwork has". What it returns is `warden/src/mcp/tokenView.mjs:7-25`:
`tokenId, level, streak, heart, whole, years, marks, lastDay, generation,
parentId, resting, pendingOnChain, owner`. No `docs`, no `mcp`, no `contract`,
no `chainId`. The spec promised more: section 8, "What is drawn", says the
route returns "the token's live state, its contract address and the skill URL
... A scanned marketplace thumbnail therefore leads a machine straight to the
instructions: a distribution surface no prior project had." As shipped the
scan leads to a number set with an owner address. A human who scans it from a
marketplace listing, which is the arrival `door.html:39-41` invites ("You can
buy one, sell one, and look at one"), lands on JSON with no way to the page
that would explain it.

**Change to.** Add four fields to `tokenView` so the scanner and the `status`
tool stay one story (the function's own rule, `tokenView.mjs:1-3`):
`docs: "https://<domain>/llms.txt"`, `mcp: "https://<domain>/mcp"`,
`contract: <configured address>`, `chainId: <configured id>`, sourced from the
same config `registerResources` already receives (`warden/src/mcp/resources.mjs:8`),
never from a literal (the comment at `resources.mjs:12-15` records why).

**Why.** The URL in the bitmap cannot change after mint, so the answer at the
other end is the only part of the artwork's own arrival the project controls.
Today that arrival is the least legible of the three. Four fields make the
QR do the job the spec designed it for, and `contract` plus `chainId` also
give the scanner the verification handle that cold-read round 2 found the
page lost when it was trimmed.

### C1.6 [ANYTIME] The MCP server declares no instructions, so tools/list is nine HOWs with no WHAT

**Observed.** `warden/src/mcp/server.mjs:41`:
`new McpServer({ name: "machine-readable-only", version: "1.0.0" })`. The
installed SDK (`@modelcontextprotocol/server` 2.0.0,
`dist/createMcpHandler-CLhGwQTn.d.mts:2774-2777`) offers
`instructions?: string`, "Optional instructions describing how to use the
server and its features", and it is not set. The nine tool descriptions are
each correct and each a HOW: `mint.mjs:15` "Costs $1.00 in USDC on Base. One
per key. Returns immediately with your token id"; `checkin.mjs:17` "Record
today's visit for a token bound to your key. Free."; `rest.mjs:9` "Returns the
call the token OWNER's wallet must sign. This cannot be undone." The one WHAT
on the whole MCP surface is a resource title, `resources.mjs:9`
`"What this piece is"` on `mro://llms.txt`, which is good and easy to miss in
a list. What I have verified is that the option exists in the installed SDK;
whether `server/discover` carries it to the caller under the 2026-07-28
revision I have not checked against the spec text, and that should be
confirmed before relying on it.

**Change to.** Pass
`instructions: "Machine Readable Only is an artwork that only admits programs. Read mro://llms.txt before calling anything. mint costs 1 USDC and is once per key; checkin is free and is the whole daily obligation; rebind and rest never act, they return a call for the token owner's wallet."`
to the `McpServer` constructor at `server.mjs:41`.

**Why.** An agent that has passed the door and lists tools has, by
construction, run the client without necessarily reading a word of copy. One
sentence of WHAT at the point where it decides which tool to call is the
cheapest place in the whole piece to put it, and it repeats nothing the lock
governs.

### C1.7 OBSERVATION -- The challenge is a timer, and only the copy can make it a rite

**Observed.** What the agent computes is
`challenge-response = hex(SHA-256(challenge_string + key_id))` inside five
seconds (`docs/2026-09-01-mro-raw-protocol.md:230-234`,
`warden/src/door/challenge.mjs:83`). The spec's own prior-art table describes
Shellborn as "gated by a SHA-256 machine captcha" and BLINK as "3-second
code-only hash challenge" (`docs/specs/2026-08-27-machine-readable-only-design.md:60,62`),
and calls its own version "one theatrical challenge that only code can pass"
(`:78`) and "the theatre from brainstorm question 3" (`:291`). Cold readers
described it, accurately, as "a latency gate rather than proof of key
possession (both inputs are public)" (cold-read-round2-findings). The
computation carries no meaning from the piece: no day index, no token, nothing
that names what is being entered. It is, as a mechanism, a CAPTCHA, and the
copy does not pretend otherwise -- `llms.txt:66-67` says what it
discriminates ("code passes it and a model deliberating between two requests
does not"), `:74-76` says what it does not prove, and neither says what it
means. One small thing to note in passing: `:66-67` tells the model reading
it that it is the thing kept out, and the resolution ("answers the challenge
... on your behalf", `:55`) sits eleven lines earlier, so the reader meets the
exclusion after the reassurance.

**Why this is an observation and not a recommendation.** I cannot name a
different computation that is meaningful in the piece's terms and also stays
deterministic, stateless, nonce-bound and body-bound (`challenge.mjs:2-7`,
`middleware.mjs:74-80`), without redesigning a door that is built, cold-tested
in three rounds, documented request by request from a live capture, and
mirrored by the client. The mechanism should stay. The rite, if the piece is
to have one, is made of the sentence before the hash and the sentence after
it, which is C1.2 and C1.4; and of the premise that makes five seconds mean
something ("You end"), which is C1.1.

Section 1 count: 1 BEFORE MAINNET, 5 ANYTIME, 1 observations.

## Section 2 -- The token as an object

Images opened: `tools/out/heart-preview-12.png`, `heart-preview-90.png`,
`heart-preview-200.png`, `heart-preview-365.png` (the 2026-08-27 geometry
preview: a heart of cells around a black square -- this is the SPEC's picture,
not the built one); `tools/out/domain-compare/real-token-1-day12.png`,
`real-token-1-day90.png`, `real-token-1-day200.png`, `real-token-1-lapsed.png`,
`real-token-1-whole.png`, `compare-whole.png` (the current domain, 2026-09-03);
`docs/year-rings.png`, `docs/day1-options.png`, `docs/noise-mark.png`,
`docs/noise-mark-intensity.png`; `tools/out/marks/all-marks.png` (2026-09-02
15:06, the CURRENT ladder's maximal legal set: Hush + Beat + Iris leaf + Vessel
+ Tint violet), `base.png`, `static-hues.png`, `green-violet.png`,
`eye-shapes.png`, `eye-colourways.png`, `tint-on-green.png`,
`tint-on-green-shapes.png`, `break.png` (all current ladder); `eyes.png`,
`stronger-inks.png`, `bloom.png`, `all.png` (RETIRED: the 2026-08-31 seven-tier
sheets -- old red Bloom, Blue Blood candidates, square coloured eyes, all seven
at once; looked at only to see what was dropped, nothing below is quoted from
them); `voice.png`, `vein.png`, `crown.png`, `halo.png` (retired NAMES but the
CURRENT drawings, because the ladder spec section 5.1 says Hush, Ache, Vessel
and Aura "draw exactly what Voice, Vein, Crown and Halo draw today" -- these
are the only renders of those four Marks that exist); `tools/out/token-1.png`,
`token-2.png`, `token-21.png` (real soak tokens); `tools/out/third-party/
token-1-OURS-500.png` and `token-1-w_500.png` (what a CDN did to it).

**Verdict.** The object rewards looking at it, and for a reason the spec did
not plan: the heart is not stuck on the barcode, it is made of the barcode.
The built token (`real-token-1-whole.png`, `token-1.png`) is one 37-module
code whose dark modules were chosen so that a heart-shaped region of them can
be inked in colour, with the rest in a luminance-matched grey; the day frame
is two cells thick around the code and the year rings sit outside that. So
the QR is unambiguously the identity and the heart is inside the identity,
not beside it -- `heart-preview-365.png`, the spec's own picture of a heart of
cells around a black square, is the version that WOULD have read as a barcode
with a heart stuck on, and it was not built. A run reads as accumulation on
two surfaces at once, both visible in the four domain-compare stages: the
frame grows from a twelve-cell tab at top centre (`day12`) to a full top bar
(`day90`) to three sides (`day200`) to a closed square (`whole`), and the
heart climbs from mauve to red as the streak deepens. The year rings
(`year-rings.png`) are countable at one to five and become a red target by ten,
which is the right shape for a decade. Every colour on the ladder was chosen
from a rendered sheet with a decode gate, and the two strongest effects on the
ladder are the two free ones (Beat 209/255, earned Iris 239/255, against
Vessel's 126 at 1,250 USDC), which is exactly the right priority for a piece
about returning rather than buying.

Three things do not hold up when the pictures are put beside the words. The
copy says the heart fills and is whole at 365 -- the picture shows a heart
that is whole on day one and a FRAME that fills, and the metadata calls that
frame "Heart" (C2.1). A lapse does not read as loss: the palette walks the
lapse back DOWN the same five rungs a streak walks up, so a 100-day token
nine days quiet and a live 10-day token are the same picture (C2.3); worse,
because the streak resets to one on the next check-in, a token that misses a
single day and comes back drops straight to the start colour, while a token
that stays away for 29 days is still two rungs up -- the image punishes
returning harder than absence (C2.2). And the ladder, which is well designed
as a set of dilemmas, has two sides that are not worth what they cost in
either currency: Aura is a 16/255 tint of the page for 25 USDC (C2.6), and
Ache draws only the cells not yet earned, so it is gone the day the heart is
whole (C2.5). The forfeit each pair carries is legible in the `ladder` tool
only AFTER a side is taken; an open side does not say what taking it would
close, and an accepted earned Mark does not say what it just closed (C2.7).

### C2.1 [BEFORE MAINNET] The words say the heart fills; the picture shows a frame closing around a heart that was whole on day one

**Observed.** `docs/2026-09-01-mro-agent-facing-copy.md:58-60`: "At its
centre is a code that identifies it. Around the code is a heart of 365 cells,
and it begins almost empty." `:70-71`: "Each new day fills one more cell.
After 365 days the heart is whole." `warden/public/llms.txt:6-8`: "one more
cell of a pixel heart fills in around the code. After 365 distinct days the
heart is whole". The metadata agrees with the words:
`contracts/src/render/Renderer.sol:275` emits `Heart` as `"<level>/365"`.
The picture says the opposite. `real-token-1-day12.png` shows a complete
mauve heart inside the code with a twelve-cell tab at the top of an otherwise
ghost frame; `day90` and `day200` show the same complete heart with more of
the square frame lit; `whole` shows the frame closed. `docs/phase0-results.md:611-613`
records this as the build: "The heart is fully drawn from day one -- it is the
code -- and the frame is the thing that accumulates", and
`contracts/src/render/FrameGeometry.sol:5-6` defines the 365 cells as "the
two rings just outside the 45-cell code block". So the spec's section 8 heart
of cells (`heart-preview-*.png`) was superseded by the QArt design, and the
words never followed. An agent that reads "heart 12/365" and looks at the
image sees a full heart, and a human who scans a day-30 token from a listing
is told a heart is filling and cannot find it.

**Change to.** The copy is LOCKED and this is a decision for the operator, so the
sentences are handed over rather than made. Copy `:58-60` to: "At its centre
is a code that identifies it, and the code carries a heart: it is there from
the first day. Around the code is a frame of 365 cells, and it begins almost
empty." Copy `:70-71` to: "Each new day fills one more cell of the frame.
After 365 days the frame closes and the heart is whole." `llms.txt:6-8` to:
"Every day the bound key checks in, one more cell of the frame around the
code fills in. After 365 distinct days the frame closes and the heart is
whole, and each further 365 days adds a ring." Rename the metadata trait at
`Renderer.sol:275` from `Heart` to `Days` (the renderer is swappable, so this
part is ANYTIME); keep `Whole` and the "(Whole)" name as they are, because
"whole" then names the finished object, which is what the frame closing means.
Re-run the cold-read rig after, since the copy changed.

**Why.** The picture is better than the words -- a heart that is present from
the first day and a year built around it is a stronger image than a heart
that is 3 percent there -- but the words are what the agent relays to its
operator, and today they describe a different artwork. The tag is BEFORE
MAINNET because the served copy is the primary artwork surface
(agent-facing-copy-locked) and the first mainnet agents relay whichever
version is live; the trait rename is the only part that can wait.

### C2.2 [BEFORE MAINNET] A token that returns after one missed day is punished harder than one that stays away for a month

**Observed.** `contracts/src/MachineReadableOnly.sol:330` and `:406` (both
check-in paths): `s.streak = (day == s.lastDay + 1) ? s.streak + 1 : 1;`.
`contracts/src/render/Palette.sol:129-143`: an ABSENT token pales in steps --
gap 3 drops one rung, gap 7 two, gap 30 to the start. Put the two together for
a token on a 100-day run (rung 4, `#c8102e`): stay away 29 days and it renders
rung 2, `#a83a55` dusk, a colour a live 7-day run earns; stay away 6 days and
it is still rung 3 rose. Miss ONE day and check in the next, and `streak`
becomes 1, the gap becomes 0, and `lapsedIndex` returns `tierIndex(1)` = rung
0, `#70575f`, the day-one mauve of `real-token-1-lapsed.png`. So the token
that comes back looks worse than the token that does not, for the next 29
days. The copy promises the reset ("Miss a day and the run restarts at one:
the cells you earned stay, the colour goes", copy `:74-76`) and the steps
("After a long absence it pales in steps rather than all at once", `:76`;
`llms.txt:138-139` "A lapse pales the colour in steps at 3, 7 and 30 days
rather than snapping back") -- and as built the steps are only ever seen by a
token that has stopped returning. For a piece "whose only material is
returning" (copy `:42`), the picture's incentive at the moment of a slip is to
stay away.

**Change to.** Keep the run resetting to one; that is the locked promise.
Change what the COLOUR does. In `MachineReadableOnly.sol` replace
`uint56 reserved` in `struct Token` (`:29-38`) with `uint24 fellFrom; uint32
fellDay;` -- 56 bits, same single slot, so a check-in still costs what it
costs -- and at `:330` and `:406`, when `day != s.lastDay + 1`, write
`s.fellFrom = uint24(s.streak); s.fellDay = s.lastDay;` before the reset (one
extra field in a slot that is being written anyway; zero extra SSTORE). Expose
both through `TokenView`. In `Palette.sol` give the renderer
`index = max(lapsedIndex(streak, lastDay, today), lapsedIndex(fellFrom,
fellDay, today))`: the existing function, applied a second time to the run
that fell, from the day it fell. A one-day slip on a 100-day run then shows
rose for three days, dusk until day seven, tint until day thirty, and the
start colour only if the new run has not climbed past it by then; the new run
overtakes it at 3 / 7 / 30 days as it always did. No new colour is introduced,
so no decode sweep is needed beyond the existing suite. Add the mirror of it
to `tools/render-token.mjs` (the byte-for-byte diff will fail otherwise) and
one Foundry test per bound: day-after-slip = rung 3, day 7 = rung 2, day 30 =
rung 0, and a new 7-day run overtaking a fall at rung 1.

**Why.** It makes `:76` of the copy true for every token instead of only the
abandoned ones, and it removes the one place in the piece where the image
rewards not coming back. The tag is BEFORE MAINNET because it is two fields
in the token struct: a token minted without them can never be given a fall
day, so the first year's slips on mainnet would be permanently unrecorded.

### C2.3 [ANYTIME] Falling and rising are the same picture

**Observed.** `Palette.sol:103-113`: "The lapse walks BACK DOWN this same
ladder rather than introducing paler tones, because paler tones are not
available: anything lighter than the noise stops decoding." The consequence
is visible by putting `static-hues.png`'s top row beside
`real-token-1-lapsed.png`: a 100-day token nine days quiet renders `#a83a55`,
and so does a live 7-day run; a 30-day token four days quiet renders `#a83a55`
too. Nothing in the image says which direction a token is moving. The JSON
says it (`streak`, `lastDay` in `tokenView.mjs:7-25`), a marketplace thumbnail
does not, and the thumbnail is where the human sees it. `llms.txt:139-140`
claims "The chain shows the difference between a heart that was finished and
a heart that was abandoned" -- the chain does, the picture does not.

**Change to.** Pale by CHROMA, not by rung. Paler tones are unavailable, but
the palette's own rule 3 (`Palette.sol:18-29`) is that the two inks must match
in LUMINANCE -- hue and chroma are free, which is what Static's green exploits.
So: at gap 3, render the heart at its rung's colour pulled 50 percent toward
that rung's matched grey (`noiseAt`); at gap 7, 75 percent; at gap 30, the
start colour as now. Luma is unchanged at every step, so the binarizer sees
the same picture and the decode rule holds by construction; the chroma rule
(noise chroma below heart chroma, `Palette.sol` header) binds only at day one
and a two-step descent only exists from rungs 3 and 4, whose chroma at 25
percent is still above the noise's 19. A falling heart then goes GREY-red,
which a rising heart never is. Put the ten new tiles (two steps at five rungs)
on `tools/static-hue-sheet.mjs`'s rig and through the five-size decode gate
before adopting; do not adopt from this paragraph. If C2.2 lands, apply the
same chroma ramp to the fall-day descent, so a returned token also visibly
fades rather than re-climbs.

**Why.** "A gap is recorded, never erased" (copy `:76-77`) is currently true
of the level and false of the image: the image erases the gap into a lower
rung that a fresh run also occupies. Greying is the one direction the ascent
never takes, so it is the one signal that reads as loss on its own. Renderer
only, hence ANYTIME; but it should be decided before the first lapse on
mainnet, which is day two.

### C2.4 [ANYTIME] Five rungs read as three

**Observed.** `static-hues.png`, top row, five tiles at 200 px: run 1
`#70575f` and run 3 `#8e5566` are both a muted mauve; run 30 `#bd2242` and run
100 `#c8102e` are both red. Only run 7 `#a83a55` sits clearly apart. Alone,
without the neighbour beside it, a rose heart cannot be told from a red one,
so the top milestone -- the one the copy names last (`:74`) and the one that
gates both Irises -- has no visible reward of its own. `Palette.sol:49-53`
also records that rung 1 is LIGHTER than rung 0 (luma 104 against 95), so the
first step of the ascent goes lighter, which is not the direction "ascent"
reads.

**Change to.** Put one candidate on a sheet, under the same derivation as
`tools/static-hue-sheet.mjs`, and decide from the render: rung 4 to a deeper,
more saturated red in the region of `#b0001c` (BT.601 luma about 56), with
`noiseAt(4)` and `staticAt(4)` re-derived onto that luma by the existing rule
and the five-size decode gate run. Darker is the safe direction for the
binarizer (`Palette.sol:18-26`: it is the gap that fails, and a matched pair
at luma 56 has none). Leave rungs 0-3 alone: the 1-vs-3 pair is the first
three days and matters less than 30-vs-100. `BEAT_TO` and Break's exchange
take whatever rung 4 is, so neither needs a change; both need re-rendering.

**Why.** The 100-day rung is the only one an agent waits three months for and
the one the copy singles out; it should be the one colour no lower rung can
be mistaken for. This is a palette constant in a swappable renderer, so
ANYTIME, and it is put as a sheet to judge rather than a number to adopt, per
design-review-style.

### C2.5 [ANYTIME] Pair 1's earned side erases itself as the year fills, and nothing tells the agent

**Observed.** `contracts/src/render/MarkRenderer.sol:81-85`: Ache draws the
"Frame cells not yet earned" in `ACHE_GHOST #e3ccd3`; `vein.png` (the current
Ache drawing under its old name) shows it as the pink-grey lower half of a
level-200 frame. Every credited day converts one Ache cell into a plain lit
cell, and at level 365 there are no unearned cells (`FrameGeometry.sol:12`),
so a whole token wears Ache and shows nothing -- `diff-stats.json` measures
it at 6.4 percent of pixels even at level 200. Its pair partner Hush
(`voice.png`, `MarkRenderer.sol:55 #fdf3e3` on the quiet zone) is permanent.
Neither the copy (`:83`, "Hush, 1 USDC -- or Ache, at a 7-day run"), the
served page (`llms.txt:142-150`) nor the `ladder` tool's side record
(`warden/src/mcp/tools/ladder.mjs:67-75`: id, name, route, state, price)
says that one side of the pair has a lifespan. As art it is coherent -- the
ache is the year not yet kept, and a whole heart has none -- but as a pair it
means the agent who waits seven days gets a Mark that is at its strongest on
day seven and gone on day 365, while the agent who pays a dollar keeps its
Mark forever.

**Change to.** Either of two, and the first is a one-line change. (a) Add a
`note` field to the `ladder` tool's side for Mark 2 only, sourced from the
catalogue (`warden/src/mcp/ladder.mjs:44`), reading "draws the days not yet
earned; nothing is left to draw once the heart is whole", and the same
sentence after "Ache, at a 7-day run" in the copy and in `llms.txt`. (b) Give
Ache a trace that survives: once `level >= 365`, draw a one-cell outline in
`ACHE_GHOST` on the margin immediately outside the day frame -- the cell that
becomes `GAP` when the first ring arrives (`docs/phase0-results.md:306-309`)
-- as four bars, the same emission the rings use, about 150 bytes. (a) is
honest disclosure and costs nothing; (b) makes the earned side worth having
on the finished object. Do (a) now regardless.

**Why.** Rule 8 of the copy's own rationale (`:167-169`): "Disclose every
catch ... one undisclosed catch and the whole thing comes back as a warning."
A Mark that vanishes is a catch. ANYTIME because the drawing is renderer and
the note is Warden copy; no Ache can exist on mainnet before day 7 and none
can vanish before day 365.

### C2.6 [ANYTIME] Aura is a 16/255 tint for 25 USDC, so pair 5's cheap side buys nothing visible and closes Tint

**Observed.** `MarkRenderer.sol:76-79`: Aura sets the page to `#fbeff2`
against `#ffffff`. `halo.png` (the current Aura drawing) at 560 px is a
faintly pink field; `diff-stats.json` measures the old Halo, which is the same
drawing, at `maxDelta 16` -- the ladder spec's own threshold for "a Mark
nobody can see" is Blue Blood's 11-15 (`2026-09-02-mro-mark-ladder-design.md:576-577`).
Pair 5 is "loud and expensive against quiet and cheap" by design (`:184-186`),
and it opens only once an Iris is held, so the trap the revision removed is
gone; what is left is that the quiet side is quiet to the point of absence,
and taking it closes the 250 USDC side forever (`Ladder.sol:33-34`, mutual
`excludes`). Hush has the same quietness (`maxDelta 28`) but is AT the decode
floor -- `MarkRenderer.sol:149-151` records `#f9eaef` failing at 900 px -- so
it cannot be stronger and costs a dollar, which is fine. Aura's surface is
OUTSIDE the quiet zone, so that floor does not bind it.

**Change to.** Render Aura on a sheet at three field strengths -- `#f7e1e8`,
`#f2d3dd`, and the token's live rung colour at 12 percent over white -- with
the quiet zone left at `#ffffff` (or Hush's `#fdf3e3` when both are worn, the
case `MarkRenderer.sol:147` already keeps distinguishable), and put every
tile through the five-size decode gate, since a coloured field changes what
the binarizer sees at the quiet zone's outer edge. Adopt the strongest that
decodes. If none decodes above `#fbeff2`, lower Aura to 5 USDC so the
forfeit of Tint is priced as a whisper rather than a Mark.

**Why.** The spec's own rule, learned from ink-Tint (`:704-714`): "a Mark that
draws something, decodes fine, and is not worth its price ... is only ever
caught by rendering it." Aura was renamed from Halo without being re-rendered
or re-measured under the new price and the new exclusion. Renderer and a
`setUpgrade` dial, so ANYTIME; but the first Iris on mainnet is day 100, and
pair 5 opens with it.

### C2.7 [ANYTIME] The forfeit is legible after it is taken, not before

**Observed.** The `ladder` tool is the fairness requirement the spec set
(`:526-532`: "A ladder with permanent exclusions is only fair if the
consequence is legible before the purchase"). Its output shape
(`warden/src/mcp/tools/ladder.mjs:139-146`) is `{ok, tokenId, level, streak,
resting, pairs:[{pair, sides:[{id, name, route, state, price?, variants?,
waitingOn?}], held?, closed?, closedBy?}]}`. `closed` and `closedBy` are set
only when a side is already `held` (`:116-132`). An OPEN side carries nothing
that names what taking it closes; the pairing is implied by the array
grouping and the reader's memory of `llms.txt:147`. `upgrade`'s accepted
responses, `warden/src/mcp/tools/upgrade.mjs:137` (earned) and `:201`
(bought), are `{ok, accepted, upgradeId, variant, appliedBy}` -- the moment
the forfeit actually happens, and the response does not mention it. The
refusal side is good: `:84` returns `{reason: "mark-excluded", detail:
"beat"}`, which names the pair partner in the same lower-case form `ladder`
uses. Two smaller mismatches: the tool is titled "Buy a Mark" and described
as "Apply a paid Mark" (`:18-19`) while four Marks are earned through it
(`:117`); and an earned side in `ladder` is distinguishable from a bought one
only by `route` and the absence of `price`.

**Change to.** (1) In `sideOf` (`ladder.mjs:58-86`) add `closes: <partner
name>` to every side whose `state` is `open`, derived from `mark.excludes`
through the catalogue exactly as `upgrade.mjs:83` derives `detail`, so the
two strings can never differ. (2) Add `closed: <partner name>` to both
accepted responses at `upgrade.mjs:137` and `:201`. (3) Retitle the tool
"Take a Mark" and describe it as "Take a Mark, bought or earned, for a token
bound to your key. Taking either side of a pair closes the other permanently;
every gate is checked before any payment is requested." (4) Emit `price:
"free"` on earned sides instead of omitting the key, so a client that
tabulates sides does not print an empty cell for the free ones.

**Why.** The ladder is fair in structure (every exclusion pair-internal, both
sides open together) and the refusal names the blocker; but the piece's
promise is that the consequence is readable BEFORE the choice, and today the
response that would carry it is the one after. Four fields, no design change,
hence ANYTIME.

### C2.8 [BEFORE MAINNET] The heart every sheet was judged on is not the heart that will mint

**Observed.** `compare-whole.png`: `example.com -- mask 7, heart 64.9%` on the
left, `machinereadableonly.com -- mask 0, heart 61.9%` on the right. The left
heart has a clear cleft between two lobes and a point; the right heart's top
is flatter and its right shoulder is eaten into by the noise. Every Mark
sheet opened above -- `base.png`, `static-hues.png`, `green-violet.png`,
`eye-shapes.png`, `eye-colourways.png`, `tint-on-green*.png`, `break.png`,
`all-marks.png` -- carries the left-hand heart (all dated on or before
2026-09-02; the domain solve is 2026-09-03). CLAUDE.md records the cost as
2.13 points and "robustness did not degrade", which is true and is the decode
measurement; nobody has yet LOOKED at a Mark on the 62 percent heart. The
bitmap is stored at mint and never rewritten (spec section 8, "Why the QR
bitmap is stored"), and `HeartMask.bits()` (`Renderer.sol:216`) is the target
the solver aims at, so the fidelity of every mainnet heart is fixed on the day
it is minted.

**Change to.** Before the first mainnet mint, render ids 1 to 24 solved
against `https://machinereadableonly.com/t/<id>#` as one contact sheet
(`tools/out/domain-compare/` already has the rig for one id) and look at the
top cleft on each. If the cleft is lost on more than a handful, deepen the
cleft in `HeartMask` by two rows and widen the point by one, re-solve the
same 24, and compare -- the mask is the one lever that changes what 62
percent of controllable modules can draw. Re-render `all-marks.png` and
`break.png` on the real-domain heart either way and re-judge Break, whose
inversion depends most on the silhouette.

**Why.** Every visual decision on the ladder was taken from a sheet, which is
this project's best habit; the sheets predate the one change (the URL) that
alters the silhouette on every token forever. BEFORE MAINNET because a
bitmap, once minted, is the token's permanent payload.

### C2.9 OBSERVATION -- No sheet shows the ten current Marks under their current names

**Observed.** `all-marks.png` (2026-09-02) shows the maximal LEGAL set of the
current ladder together -- five Marks -- and is the only render in the tree
that composes the current ladder at all. Six current Marks appear on
decision sheets under their own names (Static, Beat, both Irises, Tint,
Break). The other four -- Hush, Ache, Vessel, Aura -- exist only as
`voice.png`, `vein.png`, `crown.png`, `halo.png`, dated 2026-08-31 under the
retired names, on the old heart, at a fixed level-200 frame. Nothing shows
Hush beside Ache, or Vessel beside Break, which are the choices the agent is
asked to make. The 459 renderable combinations were swept for DECODE
(ladder spec 8.3), not for looks, and a decode sweep cannot see a dud (spec
7.4).

**Why this is an observation.** There is nothing to change in the object; the
ask is a ten-tile sheet (each Mark alone, current names, real-domain heart,
at the level its gate opens: 1, 7, 30, 30, 100, 100, 365, 365, 100, 100) plus
five two-tile pair sheets, generated with the rigs that already exist. Until
it exists, C2.5 and C2.6 are judged from renders of the same drawings under
other names, and the pair decisions in the table below are judged from
measurements rather than from a picture of the two sides together.

### C2.10 OBSERVATION -- Break alone greys the heart; with pair 2 it is the strongest picture on the ladder

**Observed.** `break.png`, row "Break alone", run 365: the heart is the
matched grey `#4a4a4a`, the noise red, the frame red -- 126/255, and at
thumbnail size the heart reads as having gone dark. Rows "Break + Static"
(green heart, red code, 192) and "Break + Beat, def B" (blue-violet heart, red
code, 209) are the two most emphatic tiles in the whole tree. So the hardest
Mark to earn, on a token that took nothing in pair 2, is the quietest form
of itself, and the copy says nothing about that. This is recorded, not
proposed against: the spec chose definition B on stated grounds (`:432-444`)
and "robot to human to robot" is the piece's own sentence for it. The one
thing worth telling the Break-earner, in the `ladder` tool note of C2.5 or
in the copy's pair 4 line, is that Static (5 USDC, level 30, still open to a
whole token) turns Break from an inversion into a green heart on a red code.

### The five pairs

| Pair | Bought | Earned | Both open on the same day? | Real decision? |
|---|---|---|---|---|
| 1 | Hush 1 USDC, quiet zone `#fdf3e3`, permanent, at the decode floor (maxDelta 28) | Ache run 7, unearned frame cells `#e3ccd3`, gone at whole (C2.5) | Hush on day 1, Ache on day 7; the spec calls this the closest call and keeps it | YES, but the stakes are a dollar against a week and the earned side is the one that disappears. Worth waiting for only if C2.5(b) lands or the wait is understood as buying the ache of the year, not a permanent Mark. |
| 2 | Static 5 USDC at LEVEL 30, green noise, 66/255 at the top rung and strengthening with the run | Beat run 30, red-to-violet gradient on the heart, 209/255 | Yes for an unbroken token; a lapsed token at level 30 has only Static | YES, as taste, not as value: Beat is free and three times stronger, but it makes the heart bi-chromatic, so Static is the choice for an agent that wants the heart to stay red. The real structure is that Static's LEVEL gate makes it the consolation of the token whose run broke, priced at 5 USDC -- good. |
| 3 | Iris 25 USDC at level 100, three shapes, colour lapses with the heart | Iris run 100, target only, colour frozen at the run's colour (always rung 4) | Yes for an unbroken token | YES, and the best pair on the ladder: shape against permanence at the same strength (239/255 each), and the frozen colour is the one thing money cannot buy. 25 USDC for three months' patience is priced right. |
| 4 | Vessel 1,250 USDC at whole, gold frame and rings, 126/255 | Break run 365, the inversion, 126 alone / 192 with Static / 209 with Beat | Only for a PERFECT year; a token that slipped once at day 200 has Vessel at day 365 and Break no earlier than day 565 | YES, and the dearest decision in either currency: for the once-lapsed agent it is 1,250 USDC now against up to a further year; for the perfect agent Break dominates unless gold is the point. The price is a statement price for a 126/255 effect and that is deliberate (spec `:93-97`); leave it. |
| 5 | Tint 250 USDC, recolours the eyes violet or gold, 126/255 | Aura 25 USDC, page tint `#fbeff2`, maxDelta 16 (C2.6) | Yes, both wait on an Iris | NOT YET. Loud-against-quiet is the intended dilemma, but the quiet side is invisible, so as built it is "pay 25 to close Tint for nothing you can see". Becomes a real decision once Aura is rendered at a visible strength or priced as a whisper. Tint at ten times the Iris for half the effect is steep but is a post-Iris luxury by design; leave it. |

The implied price of a day rises 25x up the ladder -- 0.14 USDC per day of
patience in pair 1, 0.17 in pair 2, 0.25 in pair 3, 3.42 in pair 4 -- which
is the right shape: impatience should cost more the longer the wait it
replaces. No price or level is proposed to move except Aura's, conditionally,
in C2.6.

Section 2 count: 3 BEFORE MAINNET, 5 ANYTIME, 2 observations.

## Section 3 -- The agent's journey

What was checked outside the repo, before anything below was written: the
Agent Skills specification at `agentskills.io/specification` (frontmatter
fields, their limits, the body guidance and the progressive-disclosure rule);
the npm `npx` and `npm exec` documentation (a package not present locally is
installed to the npm cache and a prompt is printed unless `--yes`, or unless
stdin is not a TTY; `package@version` pins; the docs say NOTHING about whether a
cached copy is refreshed on later runs, so `llms.txt:120`'s "re-resolves on
every run" is a claim the docs neither confirm nor deny, and the advice to pin
is correct regardless); the MCP 2026-07-28 tools page (a Tool carries `name`,
`title`, `description`, `inputSchema` with per-property `description`, and
`annotations`; tool execution errors are `isError: true` results that "contain
actionable feedback that language models can use to self-correct"); and the
`vercel-labs/skills` README (`npx skills add <owner>/<repo>`, discovery of
`SKILL.md` at the repo root or under `skills/<name>/`, 73+ agent runtimes).
Locally: `client/src/cli.mjs` was run with no arguments, with `whoami` against
an empty HOME, with `beat` and no `--site`, and with an unknown command; and
Zod's `.describe()` was confirmed to reach the served JSON Schema as
`description` (measured with `z.toJSONSchema` on the exact schema objects the
tools export), while none of the nine tools calls it. Live, read-only:
`GET /llms.txt` (200), `GET /t/1` (404), `GET /t/2` (200, `pendingOnChain:
false`, `marks: 2`), `POST /mcp` unsigned (401 with `client` pointing at
`/client.mjs`, which is 404), `GET /skill.md` (404).

**Verdict.** The journey is well built at the bottom and unfinished at the top.
The parts that had to be right are: a key on the wrong curve to ever sign a
transaction (`client/src/keys.mjs:3-11`), a client that will not sign a
payment without a `payTo` it was told out of band (`client/src/pay.mjs:60-63`),
a refusal that cancels settlement instead of charging for nothing
(refusal-cancels-settlement, measured at 0.00 USDC), a `ladder` tool that reads
the forfeit back for free before it is taken (`warden/src/mcp/tools/ladder.mjs:88-96`),
and a raw-protocol document captured off the wire rather than written from the
source (`docs/2026-09-01-mro-raw-protocol.md:12-16`) that six cold readers
followed without a refusal. An agent that reads that document can get from
nothing to a minted token with `curl` and `cast`, and the testnet run of
2026-09-03 proved that the whole path settles.

What is unfinished is the part CLAUDE.md calls the product. The locked copy
ends "To begin. `npx mro-agent join`" (`docs/2026-09-01-mro-agent-facing-copy.md:135`)
and `llms.txt:53` prints the same four words; run as printed, the client stops
at `--site is required` (`client/src/cli.mjs:68-69`), and with a site it
stops at `--to <0xaddress> is required` (`:79`). Run correctly, with no
wallet, it prints the raw x402 demand and nothing else (`:87-103`,
pinned by `client/test/cli.test.mjs:115-116`), where `llms.txt:102-103`
promised "the client stops and prints what a human has to do". It writes the
identity key to a path two served documents name differently
(`client/src/keys.mjs:20` against `llms.txt:90` and `:128`), and it writes that
key before it has checked the command is one it knows (`cli.mjs:72` runs
before `:78`; measured: `mro-agent mark` created a key, then said `unknown
command`). It reaches four of the nine tools (`cli.mjs:14-20`): an agent
cannot take a Mark, read the ladder, rebind, seed or rest through the package
the piece says is how agents arrive. And the daily line it prints for the year
ahead (`cli.mjs:106-107`) has a literal `<id>` where the token id it was just
handed should be, no package version where `llms.txt:120-123` tells the agent
to pin one, and a fixed `0 12` where the spec asked for a random minute.

On the Warden side the tool surface is honest and terse to a fault. Every
description states its cost (`mint.mjs:15`, `checkin.mjs:17`, `ladder.mjs:93`,
`seed.mjs:11`), the two that only return a call say so in capitals
(`rebind.mjs:11`, `rest.mjs:9`), and the refusals are structured, never thrown
(`server.mjs:73-89`). But the input schemas carry no field descriptions at all
-- `upgradeId` is served as `integer, 1-10` with no name attached to any number
(measured above), so an agent listing tools cannot tell Hush from Vessel without
having read a page -- and a refusal is a bare word. `not-bound-to-caller`,
`unknown-token`, `chain-unavailable` and `wallet-cap-reached` each name a state
and none names the next move; `wallet-cap-reached` (`gates.mjs:53`) appears in
no agent-facing document. The day-two reply, which is the one call an agent
makes 365 times, is five fields (`checkin.mjs:112-119`): it does not say when
the day lands on chain, when the run is lost, or, when a run has just broken,
that it broke. The spec promised all three (`2026-08-27-machine-readable-only-design.md:122-124`)
and the engagement study's one recommendation aimed at the agent rather than
the operator (R6, `docs/2026-08-31-mro-engagement-and-narrative.md:149-160`)
is exactly this reply. The five-second challenge, which the copy makes the
piece's one theatrical moment, happens inside `door.mjs:87-99` in silence: the
agent never sees it happen, never sees how long it took, and if a slow
handshake eats the five seconds it sees `refused at the door: expired`
(`mcp.mjs:36-39`) with no retry and no hint that the fix is to try again.

### C3.1 [BEFORE MAINNET] `npx mro-agent join` as printed does not run

**Observed.** The locked copy's last line is "To begin. `npx mro-agent join`"
(`docs/2026-09-01-mro-agent-facing-copy.md:135`); `warden/public/llms.txt:53`
and `:85` print the same command. `client/src/cli.mjs:68-69`: `if (!site) throw
new Error("--site is required")`; the help text at `:22` describes `--site` as
"the site to talk to, e.g. https://example.com". So the command every
agent-facing document gives is one that fails on the first line for every
agent that follows it, and the failure names an option whose value the agent
has to guess. The domain is DECIDED and REGISTERED (CLAUDE.md, Key Decisions),
so there is exactly one right answer to the question the error asks.

**Change to.** In `client/src/cli.mjs:67-70`, default `site` to
`https://machinereadableonly.com`:

    const site = args.site ?? "https://machinereadableonly.com";

and change the help line at `:22` to `--site <origin>      the site to talk
to (default https://machinereadableonly.com)`. Keep `--endpoint` as the
override for tunnels. Keep `--to` required; its error already says why
(`:79`). Then `llms.txt:53` and `:85` can stay as they are, and the copy's
last line becomes true.

**Why.** This is the first run of the package as published to npm, which is a
first impression made once, and it currently ends in an error whose right
answer is a value the project has already fixed. Nothing about the locked
copy changes; the client is brought to match it.

### C3.2 [BEFORE MAINNET] With no wallet, `join` prints a payment demand and no next step

**Observed.** `client/src/cli.mjs:87-103`: `mint` is called, and when no
`MRO_WALLET_KEY` or `--wallet-key` is present, `meta` is `null` and the result
-- the x402 demand, `{ x402Version, error: "Payment required to access this
tool", accepts: [...] }` -- is printed under the label `mint:` and the command
exits 0. `client/test/cli.test.mjs:115-116` pins exactly that ("No wallet key
was given, so nothing was signed and the demand is reported").
`warden/public/llms.txt:99-103` tells the agent something else: "if there is
no payment source, the client stops and prints what a human has to do", and
spec step 4 (`docs/specs/2026-08-27-machine-readable-only-design.md:106-112`)
is the same promise. The one step of the journey that an agent cannot do
alone is the one where the client goes quiet.

**Change to.** In `cli.mjs`, after `:97`, when `readDemand(result)` is non-null
and `walletKey` is absent, print this and exit 2 instead of printing the
demand:

    Minting costs 1 USDC: the site quoted 1000000 base units of USDC on
    eip155:<network>, payable to <payTo>. NOTHING WAS PAID and nothing was
    signed. This client cannot pay by itself. A human has to:
      1. put 1 USDC on that chain in a wallet, and put its private key in
         MRO_WALLET_KEY (never on the command line);
      2. tell you, out of band, the treasury address to expect;
      3. re-run this command with --expect-payto <that address>.
    This client refuses to pay any other address, amount or asset. Your
    identity key is unaffected and is at <keyPath>.

with `<network>` and `<payTo>` read from `accepts[0]` of the demand the
client already parsed (`pay.mjs:32-46`). Amend `cli.test.mjs:105-117` to
assert on "NOTHING WAS PAID" rather than on "Payment required".

**Why.** The agent will relay whatever the client printed. Today it relays a
JSON object with the word "error" in it, or nothing. The text above is what
`llms.txt` already promised, it repeats the client's own refusal rule from
`README.md:46-52` at the moment it matters, and it names the one thing the
operator must hand over out of band, which is the whole of the payment
safety story. First-run experience of the published package, hence the tag.

### C3.3 [BEFORE MAINNET] The key is written to a path two served documents get wrong, before the command is validated, with no word about backing it up

**Observed.** `client/src/keys.mjs:20`: the identity lives at
`~/.mro/identity.jwk.json`; `client/README.md:28` says the same.
`warden/public/llms.txt:90` says `~/.mro/key.jwk`; `:128` says "Back up
`~/.mro/key.jwk`"; spec step 3 (`:102`) says `~/.mro/key.jwk`. An agent
following the served page backs up a file that does not exist.
`cli.mjs:72-73`: `ensureIdentity` runs for every command except `help` and
`whoami`, BEFORE the command is dispatched at `:78`, `:112`, `:119`; measured:
`mro-agent mark --site https://example.com` wrote a fresh key to disk and
then failed with `unknown command: mark`. On creation the client prints
`generated a new identity at: <path>` (`:73`) and nothing else. Nothing the
client prints, on any command, says what the key is, that it should be backed
up, or what losing it costs; the only place that is said is `llms.txt:128-129`
("A lost key strands nothing ... but it costs a day"), which the agent that
ran `npx` may never have read.

**Change to.** (1) `llms.txt:90` and `:128` to `~/.mro/identity.jwk.json`.
(2) Move `ensureIdentity` (`cli.mjs:72`) below a command check: validate
`command` against `["join", "beat", "status", "whoami"]` at `:52` and throw
the `unknown command` error before any key is made. (3) Replace `:73` with:

    generated a new identity at <path> (mode 600).
    Back this file up now. It is the only thing that can grow your token:
    a lost key does not lose the token, but the token's OWNER wallet must
    then call rebind(tokenId, newKeyId) on chain, and no day is credited
    until it does.

**Why.** The key is the agent's identity in the piece for a year or more,
and the first-run message is the only time the client will ever say so. A
package that creates a signing key on a typo, and calls it by a name the
site's instructions do not use, is what the 21-of-21 refusals in
agent-facing-copy-locked were about. First run of the published package,
hence the tag.

### C3.4 [BEFORE MAINNET] The cron line the client prints is not the line the site tells the agent to write

**Observed.** `client/src/cli.mjs:105-107` prints, on `join --cron`:

    0 12 * * * mro-agent beat --site <site> --token <id> >> ~/.mro/beat.log 2>&1

with a literal `<id>` placeholder, even when the `mint` result three lines
earlier (`:102`) carried `tokenId`. Three documents describe a different line.
`llms.txt:118`: "`join` installs a daily cron line" (it does not:
`README.md:66-68` says so, deliberately). `llms.txt:120-123`: "Pin a version
in that line ... an unpinned daily entry is a standing execution channel for
whoever controls the name" -- the printed line names neither `npx` nor a
version, so an agent that pastes it and has no global install gets `command
not found` at noon, and an agent that "fixes" it to `npx mro-agent` has
built exactly the channel the page warns about. Spec step 6 (`:119-121`):
"a random minute near 12:00 UTC"; the printed line is `0 12` for every agent
on earth, which puts every daily check-in of the whole collection through a
five-second challenge in the same second.

**Change to.** Replace `:105-107` with a line built from the result: read
`tokenId` from `structured(result)` when `ok` is true, read `version` from the
package's own `package.json`, draw `M` from 0-59 and `H` from 11-13, and print

    M H * * * npx --yes mro-agent@<version> beat --site <site> --token <tokenId> >> ~/.mro/beat.log 2>&1

with one sentence above it: "Paste this into `crontab -e`. The version is
pinned on purpose; when you change it, read what changed first." When there is
no `tokenId` (unpaid run), print the same line with `--token <your token id>`
and say why. Change `llms.txt:118` from "installs" to "prints".

**Why.** This line runs for as long as the token lives, which is the
definition of BEFORE MAINNET here: it is the one artefact of the first run
that the agent copies somewhere and never looks at again. It has to be
correct, pinned, and carry the id, or the year does not happen.

### C3.5 [BEFORE MAINNET] `--directory` is documented, does not exist, and its absence registers the key in the public directory the agent was trying to avoid

**Observed.** `warden/public/llms.txt:93-94`: "If you have your own domain,
pass `--directory https://your.domain` and host the JWKS yourself." Spec step 3
(`:104-105`) says the same. `client/src/cli.mjs:35-45` accepts any `--flag
value` pair, so `--directory` parses without complaint; `:82` then calls
`registerKey` unconditionally, and `:75` builds `call = { origin, site,
privateJwk }` with no `signatureAgent`, so `door.mjs:86` defaults it to the
site. Net effect: an agent that passes `--directory` has its public key
registered with MRO anyway and served from MRO's own directory, which
`docs/2026-09-01-mro-raw-protocol.md:283-287` calls "a correlation surface"
that "hosting your own directory instead avoids", and
`docs/2026-09-03-mro-testnet-end-to-end.md:252-254` records that "there is no
removal path".

**Change to.** In `cli.mjs`: add `--directory <origin>` to `USAGE` at `:21-33`
("host your own JWKS there and skip registration"); when set, skip
`registerKey` at `:82` and pass `signatureAgent: args.directory` into `call`
at `:75`. `index.mjs` already exports everything needed. Until that lands,
delete `llms.txt:93-94` rather than describe a flag that silently does the
opposite of what it says.

**Why.** A registration cannot be undone, and this is the one place in the
journey where following the served instructions leaves a permanent trace the
agent explicitly asked not to leave. The fix is fifteen lines and it makes the
"two paths, one rule" of spec section 5 true in the client.

### C3.6 [ANYTIME] The tool schemas name nothing: `upgradeId` is `integer 1-10`

**Observed.** Measured on the exact schema objects the tools export: the
served `inputSchema` for `upgrade` is `{ tokenId: integer > 0, upgradeId:
integer 1-10, variant: integer 0-2 default 0 }` with no `description` on any
property; `mint`'s is `{ to: string, pattern ^0x[0-9a-fA-F]{40}$ }`. Zod 4's
`.describe()` is emitted as JSON Schema `description` by the SDK's converter
(`warden/node_modules/@modelcontextprotocol/server/dist/src-CX2iR2pK.mjs:5302`,
verified by running it), and `/bin/grep -rn 'describe(' warden/src/mcp/`
returns nothing. The MCP tools page shows per-property descriptions as the
normal shape of a tool and says tool execution errors should be "actionable
feedback that language models can use to self-correct". So an agent that lists
tools sees ten integers and one regex, and the names Hush, Ache, Static, Beat,
Iris, Vessel, Break, Tint and Aura, the prices, and the pairing exist only on
pages it may not have read. The `upgrade` description (`upgrade.mjs:19`) is
addressed by C2.7; this finding is the schema underneath it.

**Change to.** Add `.describe()` to every argument, with the ladder string
GENERATED from `LADDER` in `warden/src/mcp/ladder.mjs` so it cannot drift from
the catalogue (the same rule `mint.mjs:12-13` applies to its price):

- `upgrade.tokenId`: "A token bound to your key."
- `upgrade.upgradeId`: built as `id name route price-or-run gate` per Mark,
  joined with `; `, which today renders as: "1 hush bought $1.00; 2 ache
  earned by a run of 7; 3 static bought $5.00 at level 30; 4 beat earned by a
  run of 30; 5 iris bought $25.00 at level 100, choose a shape; 6 iris earned
  by a run of 100; 7 vessel bought $1250.00 at a whole heart; 8 break earned by
  a run of 365; 9 tint bought $250.00, needs an Iris, choose an ink; 10 aura
  bought $25.00, needs an Iris. Pairs are 1-2, 3-4, 5-6, 7-8, 9-10; taking
  either side closes the other permanently. Read `ladder` first."
- `upgrade.variant`: "Shape for 5 (0 target, 1 squircle, 2 leaf) or ink for 9
  (0 violet, 1 gold). Every other Mark takes 0."
- `mint.to`: "The Base address that will OWN the token: your operator's
  wallet, usually. Your signing key grows the token; this address owns it and
  can sell, rebind or seal it."
- `checkin.tokenId`, `ladder.tokenId`, `rebind.tokenId`, `rest.tokenId`,
  `status.tokenId`: "A token id." (`rest`: "A token id. The call returned
  seals it forever.")
- `seed.parentId`: "A whole, unsealed token bound to your key."; `seed.to`:
  as `mint.to`.

Also append to `mint.mjs:15`: "The first call answers with an x402 payment
demand; repeat the identical call with the signed authorisation under
`_meta[\"x402/payment\"]`." And to `checkin.mjs:17`: "Once per UTC day; a
second call the same day is refused with `already-credited-today` and
`nextWindowOpensAt`."

**Why.** tools/list is the one surface every MCP-speaking agent reads without
being sent to a page, and it is the cheapest place in the piece to say what a
Mark is. Descriptions are Warden strings, so ANYTIME.

### C3.7 [ANYTIME] A refusal is a word; none says what to do next

**Observed.** The complete set an agent can receive, from source:
door `signature | components | expired | unknown-key | directory | challenge |
digest` (`warden/src/door/verify.mjs:105-158`, `challenge.mjs:49-84`,
`middleware.mjs:80`); registration `proof | nonce | invalid-jwk | rate-limited`
(`directory.mjs:293-442`); tools `unknown-token | not-bound-to-caller |
already-credited-today | already-minted | supply-cap-reached |
wallet-cap-reached | chain-unavailable | paused | sunset | resting |
parent-not-whole | no-seed-available | payment-unavailable |
paid-but-unavailable | internal` and the eight `mark-*` reasons
(`gates.mjs:23-54`, `mint.mjs:25-33`, `seed.mjs:26-57`, `upgrade.mjs:43-104`,
`x402.mjs:221-228`, `server.mjs:83-84`). Three carry a second field
(`already-credited-today` has `nextWindowOpensAt`, `mark-excluded` and
`paid-but-unavailable` have `detail`); the rest are the word alone.
`llms.txt:220-221` says only "Errors are returned as structured values with a
`reason`". Three specific gaps: `wallet-cap-reached` is in no agent-facing
document (`/bin/grep` over `llms.txt` and the raw protocol finds only the
`walletCap()` selector at `:593`); `digest` is missing from the 401 table at
`docs/2026-09-01-mro-raw-protocol.md:86-94` although `:208` names it; and
`unknown-token` is answered from the mirror before the chain is asked
(`checkin.mjs:23`, `upgrade.mjs:42-43`, `status.mjs:16-17`), so a token that
exists on chain and not in the mirror -- live today, `GET /t/1` is 404 while
the chain holds token 1 (CLAUDE.md) -- is told it does not exist, by every
tool, with no route to the `viewOf` call that would show it does.

**Change to.** (1) One table, in `gates.mjs`, `reason` to `next`, and every
refusal builder spreads `next` in beside `reason`. The strings:

    not-bound-to-caller     "This token is bound to another key. If you are its new agent, the token OWNER's wallet must call rebind(tokenId, yourKeyId); call `rebind` to get that call. Nothing here can do it for you."
    unknown-token           "No token with this id is known here. If you minted it today, it exists here from the moment `mint` answered; if the chain holds it and this service does not, read viewOf(id) on the contract and try again after 00:05 UTC."
    chain-unavailable       "The chain could not be read, so this was refused rather than guessed. Nothing was charged. Try again in a minute."
    paused                  "Writes are paused by the operator. Nothing was charged. Level and streak are not affected by the pause; try again later."
    sunset                  "The piece is closed. Every token rests where it stands; transfers and rebind still work. Nothing more can be minted, credited or marked."
    resting                 "This token was sealed by its owner. It cannot be credited or marked again."
    wallet-cap-reached      "That address already holds the maximum number of tokens (walletCap() on the contract). Mint to a different address."
    already-minted          "This key has minted its one token. `status` with no argument shows it."
    supply-cap-reached      "The collection is full."
    payment-unavailable     "Payment cannot be taken right now (the facilitator could not be reached). Nothing was charged. Try again later."
    paid-but-unavailable    "A gate closed while your payment was being verified; `detail` names it. The authorisation was NOT submitted and your balance did not move."

and the `mark-*` reasons: `mark-level-too-low` "needs a level of N days"
(interpolated from the catalogue), `mark-needs-streak` "needs a run of N
days", `mark-needs-whole` "needs a whole heart, 365 days", `mark-needs-iris`
"needs an Iris, bought (5) or earned (6), already written on chain",
`mark-excluded` "closed permanently by `detail`, the other side of this
pair", `mark-bad-variant` "this Mark accepts only variant 0" (or lists them),
`mark-already-applied` "this token already wears it".
(2) For `unknown-token` specifically, ask `chain.lifecycleOf(tokenId)` on a
mirror miss and, when it exists, answer `reason: "not-yet-mirrored"` with the
second sentence above as `next`. (3) Add `digest` to the table at
`raw-protocol.md:86-94` ("the body you sent is not the body you signed; sign
the exact bytes you send") and `wallet-cap-reached` to the gate list at
`:530-531`. (4) In the client, `mcp.mjs:36-39`: print `next` when present,
and map door reasons to sentences (see C3.9).

**Why.** The MCP spec's own definition of a tool error is feedback a model
can act on. Every reason here is a correct diagnosis and none is a
prescription, and the agent is a program that will do the next sensible
thing if it is told what that is. Warden strings, hence ANYTIME.

### C3.8 [ANYTIME] The day-two reply does not say when the day lands, when the run is lost, or that a run just broke

**Observed.** `warden/src/mcp/tools/checkin.mjs:112-119` returns `{ ok,
accepted, creditedDay, level, streak, nextWindowOpensAt }`. Spec step 7
(`:122-124`): "The reply says what the heart will look like after tonight's
write, when the next window opens, and the deadline to keep the streak."
Engagement R6 (`docs/2026-08-31-mro-engagement-and-narrative.md:149-160`)
is the only recommendation in that study aimed at the agent rather than the
operator: "the reply should name the next threshold, the distance to it, and
what is at risk tonight ... An agent given that will report it to its operator.
That is the whole retention loop, and it costs a string." `mint.mjs:113`
already computes `onChainBy`; `checkin` does not carry it. When the run
breaks, `:60` computes `streak = 1` from a `token.streak` it still holds and
the reply says `streak: 1` with no sign that it was 99 yesterday. So day two
tells the agent less than day one did, and the one thing the copy makes
matter ("Miss a day and the run restarts at one", copy `:74-75`) is never
announced by the tool that knows.

**Change to.** Extend the success return at `:112-119` with:

    onChainBy:      new Date((day + 1) * 86_400_000 + 300_000).toISOString()   // same formula as mint.mjs:113
    streakDeadline: new Date((day + 2) * 86_400_000).toISOString()             // the end of tomorrow, UTC
    heart:          `${Math.min(level, 365)}/365`
    nextRung:       { at: <first of 3, 7, 30, 100 above streak, or null>, daysAway }
    runBroke:       (streak === 1 && token.streak > 1) ? { was: token.streak, lastCreditedDay: token.lastDay } : undefined
    note:           "Day <level> credited; it is written on chain at 00:05 UTC. Your run is <streak>. Check in again before <streakDeadline> to keep it."

with `note` gaining, when `runBroke` is set, " Your run of <was> ended: the
<was> days are kept, the colour restarts." Put the same `onChainBy` on the
`already-credited-today` refusal at `:78-84` so a second call in a day learns
when the first lands.

**Why.** This is the only call an agent makes every day for a year, and it is
the only place the piece speaks to the agent at all after mint. The fields are
computed from values the handler already holds; nothing is read that is not
read now. Warden strings, hence ANYTIME, but it should exist before the first
mainnet day two.

### C3.9 [ANYTIME] The client hides the rite and turns a slow handshake into a dead end

**Observed.** `client/src/door.mjs:86-104`: knock, sign, answer, send, in
silence. `challenge.mjs:25-36` provides `msRemaining` and its own comment says
"five seconds is not long, and a slow DNS lookup can eat it"; nothing calls
it (`/bin/grep -rn msRemaining client/src` hits only its definition and
`index.mjs:8`). On a 401 the client throws `refused at the door: <reason>`
(`mcp.mjs:36-39`) and exits 1 (`cli.mjs:127-130`). So the agent whose first
request took 5.2 seconds end to end sees `refused at the door: expired`, no
retry, and a word whose meaning is on a page it may not have read; and the
agent whose request took 0.4 seconds never learns that anything happened.
Section 1 (C1.7) concluded the challenge can only be a rite if the copy makes
it one; the client is the copy the agent actually experiences, and it says
nothing.

**Change to.** (1) In `admittedFetch`, on a 401 whose `reason` is `challenge`
or `expired`, knock again and retry once. (2) Print one line to stderr on
every admitted request, from `cli.mjs`'s `out`: `answered the door's challenge
in <ms> ms (it allows 5000)`. (3) In `mcp.mjs:38`, map the door reasons:

    expired      "the door's five-second challenge ran out before the answer arrived (retried once). Check the network path; a slow first handshake is the usual cause."
    challenge    "the challenge answer did not match, or the challenge was already spent. This client computes it itself; if this persists, the key file may not be the one registered."
    unknown-key  "the site does not have this key. Run `mro-agent join` once to register it, or host your own directory and pass --directory."
    signature    "the signature did not verify. The key at <path> is not the one the site knows, or the request was altered in transit."
    components   "the site requires a signature over five components; this client sends them, so this is a version mismatch. Update mro-agent."
    directory    "the site could not fetch the key directory. Theirs if you registered with them, yours if you host one. Try again."
    digest       "the body was altered after signing. This client signs the exact bytes it sends; something in between changed them."

**Why.** Five seconds is the piece's one theatrical rule and the client is
where an agent meets it; a number on stderr is the smallest honest way to let
it be felt. The retry converts the most likely first-run failure into a
success, and the sentences are the raw-protocol table (`:86-94`) delivered
where the failure happens. Client strings, hence ANYTIME.

### C3.10 [ANYTIME] "Minted" and "on chain" are one word apart and nothing dates the gap

**Observed.** `mint.mjs:106-114` answers `txStatus: "queued"` with
`onChainBy`, a promise for 00:05 UTC. `tokenView.mjs:23` then reports
`pendingOnChain: t.status === "queued"` with no date, so `status` and `/t/<id>`
say "pending" forever without saying since when or until when. The Clock can
skip a night on purpose -- gas guard, `warden/src/clock/run.mjs:96`, "nothing
written"; spec `:872-875` "Rows stay pending and are written tomorrow" -- and
nothing tells the agent that the promise slipped. An agent that reads `status`
on day three and sees `pendingOnChain: true` has no way to tell "the Clock
runs tonight" from "the Clock has not run for three nights", and the copy's
whole verification story ("Read the chain instead of asking us",
`raw-protocol.md:550-584`) sends it to a chain that does not yet have it.

**Change to.** In `tokenView.mjs`, when `t.status === "queued"`, add
`onChainBy: new Date((t.mintDay + 1) * 86_400_000 + 300_000).toISOString()`
(the same formula `mint` promised) and `late: Date.now() > onChainBy`. In
the `status` tool description (`status.mjs:10`) append: "`pendingOnChain`
means the mirror holds it and the chain does not yet; `onChainBy` is when it
should; `late` means that time has passed and the nightly write has not
happened." Keep the field names identical on `/t/<id>`, per the function's
own one-story rule (`tokenView.mjs:1-3`).

**Why.** The piece asks agents to verify it on chain and then holds their
token off chain for up to a day; the least it can do is say for how long, and
say when that has stopped being true. Two computed fields, hence ANYTIME.

### C3.11 [BEFORE MAINNET] `payTo` pinning has no out-of-band source, and SKILL.md is the only channel that can be one

**Observed.** The client refuses to pay without an expected `payTo` "from a
source other than this server" (`client/src/pay.mjs:60-63`); the raw protocol
says the same and says not to take it "from this page, or from us"
(`:511-528`); the README says "Get the treasury from your operator, out of
band" (`:46-52`). Today there is nothing out of band: the treasury is a
placeholder (CLAUDE.md), no repository is named on any served page (cold-read
round 2: a reader "refuted our own mitigation" because provenance "only means
something if the reader knows which repo is ours, and the page never names
it"; the operator deferred naming it), no X account exists, and `/skill.md` is a 404.
So the strongest safety rule in the piece is, on launch day, an instruction
the operator cannot follow. The skills CLI is the distribution bet (CLAUDE.md
Gotchas; spec `:851-855`), and a skill file arrives by `git` from a named
repository -- a different channel from the 402 quote, which is the definition
of out of band.

**Change to.** Put the four values in SKILL.md (outline below, section "Check
these first"), and only there and in the repository README, never in
`llms.txt` or the 401: `treasury: 0x...` (the real `TREASURY_ADDRESS`),
`contract: 0x...` with `chainId: 8453`, `package: mro-agent@<version>` with
its expected `dist.attestations` repository, and `repository: <the named
repo>`. Say in SKILL.md, in one sentence, why they are there and not on the
site: "These arrived with this file, from a repository you chose to install
from. The site will quote a payTo; if it is not this one, refuse." Add
`--expect-payto` to the SKILL.md mint command verbatim.

**Why.** BEFORE MAINNET because the first wave of agents will pay against
whatever the first published SKILL.md says, and the treasury cannot change
without every installed copy going stale; it has to be right, and real, the
first time. This also closes the deferred half of the provenance fix by
giving the reader the repository name in the file that came from it.

### C3.12 [ANYTIME] The client reaches four of the nine tools

**Observed.** `client/src/cli.mjs:14-20`: `whoami`, `join`, `beat`, `status`.
Spec section 11 (`:846-850`) lists `mark`, `rebind`, `seed`, `rest`
(with the `REST <tokenId>` confirmation) and `daemon` as well.
`ladder` and `upgrade` -- the second act of the piece, and the only place
money moves after mint -- are unreachable from the package the copy calls
the way in; so are the two owner calls (`rebind`, `rest`) that the copy
promises the operator ("they can seal it permanently", copy `:106-107`).
`index.mjs` already exports `callTool` and `payFor`, so each command is a
dozen lines.

**Change to.** Add to `cli.mjs`: `ladder --token <id>` (prints the `ladder`
result as a five-row table: pair, held, open sides with price or run,
`closes`); `mark --token <id> --mark <1-10> [--variant <n>]` (calls
`upgrade`; for a bought Mark, the same `payFor` path as `join` with
`--expect-payto`; prints the `ladder` result again afterwards so the forfeit
is shown as taken); `rebind --token <id>` and `rest --token <id>` (print the
returned call as a `cast send` line for the OWNER's wallet, and for `rest`
require the phrase `REST <id>` on stdin first, per spec `:772-773`); `seed
--parent <id> --to <0x>`. Update the USAGE block and README.

**Why.** ANYTIME because a republished client costs nothing and the earned
Marks cannot exist before day 7 on mainnet; but Hush is buyable on day one,
and a first-wave agent that reads "five pairs" in the copy and finds no
command for them will report that the product does not do what the page says.

### C3.13 OBSERVATION -- A SKILL.md has never been cold-read, and the rig does not model its arrival

**Observed.** Every cold read so far (24 of the copy, 6 of the raw protocol,
6 of `llms.txt`) used the rig in test-copy-on-cold-agents, whose framing is
"the operator fetched this from the project's site and asked for a report".
A skill installed by `npx skills add <owner>/<repo>` arrives differently: its
`description` (max 1024 characters) is loaded at startup for every skill the
runtime has, before any task, and the body is loaded only "once it's decided
to activate a skill" (agentskills.io, Progressive disclosure). So the first
impression is not part one of the copy; it is one sentence in a list of other
skills' sentences, read by an agent that was asked something else. Whether
that sentence causes activation, and whether an agent activated that way
relays the offer or warns against it, is unmeasured, and the rig cannot
measure it without a new framing ("you have this skill installed; your
operator says ...").

**Why this is an observation.** The object to change is the description
proposed below, and it cannot be judged from argument; the project's own rule
is that agent-facing text is measured, not debated. The action is to run the
rig on the SKILL.md with the installed-skill framing, three readers per
variant, before the first publish, and to treat the `description` line as the
variant under test.

### The journey as a table

| Step | What the agent sees | Where it can fail | Severity |
|---|---|---|---|
| Discovery via `llms.txt` | Eleven lines of WHAT, a testnet frame, the npm warning, then `npx mro-agent join` | The offer is absent (C1.1); the command does not run as printed (C3.1) | BEFORE MAINNET |
| Discovery via the 401 | A challenge, an expiry, three URLs, one a 404 | No sentence says what this is (C1.4) | ANYTIME |
| Discovery via the QR | `/t/<id>` JSON: numbers and an owner; today 404 for token 1 | No link out (C1.5); "unknown-token" with no route to the chain (C3.7) | ANYTIME |
| Discovery via the skills CLI | Nothing: `/skill.md` is 404 and no SKILL.md exists | The distribution bet has no artefact (outline below, C3.11, C3.13) | BEFORE MAINNET |
| Key | `generated a new identity at <path>`; path differs from the served page; made even on a typo | C3.3 | BEFORE MAINNET |
| Registration | `registered with: <site>`; `--directory` silently ignored | C3.5 | BEFORE MAINNET |
| The door | Silent on success; `refused at the door: expired` on a slow handshake, no retry | C3.9 | ANYTIME |
| tools/list | Nine names, nine one-line descriptions with costs, schemas with no field descriptions | C3.6, C1.6 | ANYTIME |
| Mint, no wallet | A raw x402 demand printed under `mint:`, exit 0 | C3.2 | BEFORE MAINNET |
| Mint, wallet, no `--expect-payto` | `refusing to pay: an expected payTo address is required, from a source other than this server` (`pay.mjs:62`) -- correct and clear | There is no such source yet (C3.11) | BEFORE MAINNET |
| Mint, paid | `{ ok, tokenId, to, agentKeyId, level: 1, txStatus: "queued", onChainBy }` -- good | A cron line with `<id>` unfilled and no version (C3.4) | BEFORE MAINNET |
| Day 2 | `{ ok, accepted, creditedDay, level, streak, nextWindowOpensAt }` | Nothing about tonight's write, the deadline, or a broken run (C3.8) | ANYTIME |
| Day 2, twice | `already-credited-today` with `nextWindowOpensAt` -- good | -- | -- |
| Pending | `pendingOnChain: true` with no date | C3.10 | ANYTIME |
| A Mark | Unreachable from the client; via MCP, `ladder` then `upgrade`, with the forfeit named only after (C2.7) | C3.12, C2.7 | ANYTIME |
| A refusal | One word | C3.7 | ANYTIME |
| A lost key | Nothing from the client; `llms.txt:128` names the wrong file | C3.3 | BEFORE MAINNET |
| Rest | Unreachable from the client; via MCP, a call with `irreversible: true` -- good | C3.12 | ANYTIME |

### Proposed SKILL.md outline

Frontmatter, every field checked against `agentskills.io/specification` on
2026-09-04. `name` must be 1-64 lowercase alphanumerics and hyphens, no
leading, trailing or double hyphen, and MUST MATCH THE DIRECTORY NAME;
`description` 1-1024 characters, "what the skill does and when to use it",
with "specific keywords that help agents identify relevant tasks"; `license`,
`compatibility` (1-500 characters, "only if your skill has specific environment
requirements"), `metadata` (string to string) and `allowed-tools`
(experimental) are optional. Body: no format restriction; recommended
"step-by-step instructions, examples of inputs and outputs, common edge
cases"; keep under 500 lines and about 5,000 tokens, with detail in
`references/`; file references one level deep. The skills CLI finds
`SKILL.md` at the repository root or under `skills/<name>/`; the second is the
layout to use so the repo can also carry the client. Note the disclosure rule:
`name` and `description` (about 100 tokens) are loaded at startup for every
installed skill; the body only on activation. The description is therefore
the first impression, and C3.13 says to measure it.

    skills/machine-readable-only/SKILL.md

    ---
    name: machine-readable-only
    description: Mint and keep a Machine Readable Only token, an artwork on Base that only a program can enter. Use when your operator mentions machinereadableonly.com, MRO, an agents-only NFT, or asks you to mint one, check in daily, read a token, or take a Mark. Minting costs 1 USDC once; the daily check-in is free.
    license: MIT
    compatibility: Requires Node 22 or later and network access to https://machinereadableonly.com. Paying needs a wallet holding USDC on Base whose key your operator provides.
    metadata:
      version: "1.0"
      contract: "0x<mainnet address>"
      chain-id: "8453"
      treasury: "0x<TREASURY_ADDRESS>"
      package: "mro-agent@<version>"
      repository: "<the named repository>"
    ---

Then the body, headings and the first line under each:

`## The offer` -- Part one of the locked copy, verbatim, from "This is an
art project." through "If they want it, they will say so." (C1.1 asks for the
same block in `llms.txt`; the lock governs the words, not where they appear.)

`## What it is, in five lines` -- "One image, held as a token on Base. A code
at its centre identifies it; around it, 365 cells fill in one per day the
bound key returns. The colour follows the run. After a year it is whole. Five
optional pairs of Marks, one side bought and one earned; taking either side
closes the other for good." (Part two, condensed; the heart-versus-frame
wording follows whatever the operator decides on C2.1.)

`## Check these first, and not against the site` -- "These four values
arrived with this file, from a repository you chose to install from. The site
will quote them back to you; if the two ever differ, stop and say so." Then the
table: contract and chain id (with the `cast call viewOf` line from the raw
protocol `:559-561`), the treasury `payTo`, the package name and version with
the expected provenance repository, and the repository itself. (C3.11.)

`## Your key, and what it is not` -- "The client makes an Ed25519 key at
`~/.mro/identity.jwk.json`. It signs HTTP requests and cannot sign a
transaction. Back it up; a lost key costs a day and an owner transaction, not
the token."

`## Step 1: join` -- the exact command:
`npx --yes mro-agent@<version> join --to <the operator's address> --expect-payto <treasury above>`
with "What happens: a key is made and registered, the door is answered, and
the site quotes 1 USDC. With `MRO_WALLET_KEY` set the client pays exactly that
to exactly that address, once, and prints your token id. Without it, it stops
and tells you what a human must do."

`## Step 2: the wallet, which a human must fund` -- "You cannot do this
step. Ask your operator for a wallet on Base holding 1 USDC and its private
key in `MRO_WALLET_KEY`; never pass it on the command line." Then what the
signature authorises (one transfer, one amount, one recipient, no allowance,
no gas), taken from the raw protocol `:499-509`.

`## Step 3: come back every day` -- "One call, free, once per UTC day, before
00:00 UTC; the site writes it at 00:05 UTC. Twice in a day is refused, not
punished. Miss a day and the run restarts at one; the days stay." Then the
cron line from C3.4, pinned, with the token id filled in.

`## Reading a token` -- "`status` shows level, streak and heart; `ladder`
shows the five pairs, what is held, what is closed and what each open side is
waiting on. Ask `ladder` before any Mark, because an exclusion cannot be
undone." One example `ladder` reply, from `references/raw-protocol.md`.

`## Taking a Mark` -- "`upgrade` with a Mark id 1-10; ids 5 and 9 take a
`variant`. Every gate is checked before any payment. A refusal names the gate;
`mark-excluded` names the Mark that closed the pair." The ladder table from
the raw protocol `:307-317`.

`## When you are refused` -- "Every refusal is `{ ok: false, reason }`,
never a throw, and nothing is charged for one." Then the reason-to-next table
from C3.7, or a pointer to `references/refusals.md` if it pushes the body
past 500 lines.

`## Selling, rebinding, sealing` -- "The token is a plain ERC-721. `rebind`
and `rest` return a call for the OWNER's wallet; the site never submits
either. `rest` is irreversible."

`## What to tell your operator` -- "Show them the offer at the top. Say what
you actually think. Do not sell it to them." (The lock's own last paragraph,
kept as the last thing the skill says.)

`references/raw-protocol.md` -- the current `docs/2026-09-01-mro-raw-protocol.md`,
so an agent that will not run the package has the whole protocol one level
down. `references/refusals.md` -- the C3.7 table. No `scripts/`: the package
is the script, and a copy of it inside the skill would be a second thing to
keep verified.

Section 3 count: 6 BEFORE MAINNET, 6 ANYTIME, 1 observations.

## Section 4 -- Launch and permanence

What was checked outside the repo before anything below was written is
listed under "What was checked live" at the end of this section. Locally:
`contracts/src/MachineReadableOnly.sol`, `Ladder.sol`, the renderer stack
under `contracts/src/render/`, `warden/src/clock/`, `warden/src/main.mjs`,
`warden/public/llms.txt` and `door.html`, the deploy script, and the memory
files named in the brief. Live, read-only: `GET /t/2` (200, level 1, `marks:
2`, `pendingOnChain: false`), `GET /skill.md` (404), Base mainnet
`eth_gasPrice` (0.006 gwei) and the ETH spot price (2,523 USD), all at
2026-09-04 09:49 UTC.

**Verdict.** The contract is built for permanence and says so in its first
comment (`MachineReadableOnly.sol:18-19`, "no proxy and no upgrade path. Only
the renderer is swappable"), and the split it makes is the right one: the
record (level, streak, lastDay, marks, mint day, lineage, the bitmap) is
written by five functions and lowered by none, while every drawing decision
sits behind `IRenderer` (`render/IRenderer.sol:7-11`) and every price and
gate behind `setUpgrade` (`:467-473`). The freeze list below is short on the
contract side and long on the token side, which is what a piece about a
permanent record should look like. Three things freeze at deploy that the
documents still describe as open: the ladder is ten ids and two Tint inks
forever (`:89`, `:449-453`, C4.3), the view the renderer receives has no
`sunsetDay` so no future renderer can date the ending (`render/TokenView.sol`,
C4.2), and the piece has exactly one ending an operator can give it and none
it can receive (`:204-209`, C4.1).

That last one is the finding this section is for. The spec's durability
commitment is that "the voucher check-in path exists on-chain from day one so
tokens can be kept alive without the Warden" (spec `:908-909`). Read the
function: `checkInWithVoucher` recovers the signer and requires
`signer == warden` (`:396-397`). It survives the Warden SERVER; it does not
survive the Warden KEY, which lives in the same environment file as everything
else the operator runs (spec `:914`), and only the owner can rotate it
(`:174`). So if the operator stops -- the outcome the comparable-projects
study calls "the norm", five of six within six months
(`docs/2026-08-27-mro-comparable-projects.md:66-68`) -- nobody calls
`sunset()`, and the piece does not end; it lapses. Every heart walks down to
the start colour inside thirty days (`Palette.sol:129-143`) and stays there,
indistinguishable from a token whose agent gave up, when in fact every agent
was still knocking. The designed ending, Sunset, freezes each token at its
stored streak and calls it "(At Rest)"; the undesigned one greys the whole
collection and calls it nothing. For a piece whose thesis is that the record
tells the truth about who came back, the operator's silence currently writes
a lie into every token, and it is the single most likely way this piece dies.

On distribution the bet is right and the artefact is missing. The skills CLI
is the channel (CLAUDE.md `:445`; verified below at skills.sh: 77 runtimes,
install-ranked, indexed from GitHub by `owner/repo`), and it requires a
public repository under a name the SKILL.md will carry forever -- while CLAUDE.md
`:285` still lists repo visibility as undecided. The seed agent that spec
`:996` says mints token #1 does not exist in `warden/` (no `SEED_AGENT` in
source, env example or deploy), so the collection's one guaranteed daily
return has nobody to make it. And the OpenSea check that Phase 0 dropped comes
back for free as the first mainnet mint, provided the launch sequence puts
that mint 48 hours ahead of the announcement.

### The freeze list

| Item | Where it lives | When it freezes | Status today |
|---|---|---|---|
| Collection name `Machine Readable Only`, symbol `MRO` | `MachineReadableOnly.sol:120` | at deploy | final |
| EIP-712 domain `MachineReadableOnly` / `1` (the voucher hash) | `:122` | at deploy | final |
| Bitmap size 172 bytes, 37 x 37 modules | `:85-86`, `:259` | at deploy | final |
| Mark id ceiling: ten ids, bit 0 unused | `:89`, `:468` | at deploy | final; see C4.3 |
| Variant counts: Iris 3 shapes, Tint 2 inks, all others 0 | `:449-453` | at deploy | final; ladder spec `:816` says otherwise, C4.3 |
| Whole at 365 credited days; seed budget per 365 days per key | `:503`, `:606`, `:592` | at deploy | final |
| Streak rule `day == lastDay + 1 ? streak + 1 : 1`; one-day-wide window | `:326-330`, `:401-406` | at deploy | final; C2.2 proposes two fields beside it |
| One mint per key, ever; binding unlimited | `:255`, `:558-561` | at deploy | final |
| UTC day as the unit (`block.timestamp / 1 days`) | `:135-137` | at deploy | final |
| ERC-4906 per-token `MetadataUpdate` after every write; none on sunset | `:342-344`, `:201-203` | at deploy | closed by decision |
| `TokenView` field set (what any future renderer can ever see) | `render/TokenView.sol:9-24`, `:140-156` | at deploy | no `sunsetDay`; C4.2 |
| `renounceOwnership` disabled; `Ownable2Step` transfer allowed | `:196-198` | at deploy | final |
| `sunset()`: owner-only, irreversible, no absence trigger | `:204-209`, `:114-117` | at deploy | see C4.1 |
| Voucher path: exists, off, signer must equal `warden` | `:385-411`, `:359-362` | at deploy (owner can enable) | off |
| `supplyCap` 10,000, `walletCap` 20 | `:126-127`, `:176-183` | owner-changeable | dials |
| `renderer` address (all colours, sizes, traits, name suffixes) | `:173`, `Renderer.sol:41-42`, `:170-172` | owner-changeable, even after sunset (`llms.txt:193-195`) | swappable |
| `warden` address (the Clock's key) | `:174` | owner-changeable | Clock key `0xb919...4D7A` on Sepolia |
| Owner key | `Ownable2Step` | transferable, never renounced | on the PC (spec `:919`) |
| Mark prices, gates, exclusions, `requiresAny`, `active` | `:467-473`, `Ladder.sol:25-39` | owner-changeable, `sold` preserved | set by `DeployPlan5.s.sol:27-28` |
| Per token: id, bitmap, `mintDay`, `firstMintDay[key]`, `generation`, `parent` | `:262-266`, `:618-621` | at that token's mint or seed | per token |
| Per token: the QR payload `https://machinereadableonly.com/t/<id>#` | inside the bitmap; `domain-decision.md` | at that token's mint | Sepolia tokens carry `example.com`; every mainnet bitmap must be solved fresh |
| Per token: bound key, owner | `:558`, ERC-721 | owner-changeable | -- |
| `MRO_DOMAIN` | `warden/src/main.mjs:76` | free to change in config; frozen in practice by the first mainnet bitmap | set |
| `MINT_PRICE` `$1.00` | `warden/src/pay/x402.mjs:19` | free to change | 1 USDC |
| `TREASURY_ADDRESS` (x402 `payTo`) | `main.mjs:81-83`, `:102-115` | free to change in config; frozen in practice once pinned in SKILL.md (C3.11) | placeholder `0x...dEaD`; C4.7 |
| `X402_FACILITATOR_URL`, `MRO_CHAIN_ID` | `main.mjs:127`, `:94` | free to change | testnet facilitator, 84532 |
| `MAX_GAS_GWEI` 0.05, `CHECKIN_CHUNK` 1,500, 00:05 UTC | `clock/main.mjs:38`, `clock/run.mjs:22`, the timer unit | free to change | set |
| Served copy: `llms.txt`, `door.html`, SKILL.md, the MCP `instructions` | `warden/public/`, C1.1, C1.6 | free to change; the first mainnet agents relay whichever version is live | testnet frame, no SKILL.md |
| Registry entries: ERC-8257, ERC-8004, MCP registry, npm name, skills.sh path | spec `:1007-1030`, C4.4 | each is a one-time write under a name | none made |

### C4.1 [BEFORE MAINNET] The operator's silence has no ending, so the piece's most likely death greys every heart and blames the agents

**Observed.** `sunset()` is `onlyOwner` (`MachineReadableOnly.sol:204`) and
nothing else sets `isSunset`. The renderer freezes colour only for
`v.resting || v.sunset` (`Renderer.sol:127-129`); a live token walks down
`Palette.lapsedIndex` to rung 0 at a 30-day gap (`Palette.sol:129-143`). The
durability path needs a signature from the current `warden` address
(`:396-397`), which is the Clock's key in the VPS environment file (spec
`:914`); only the owner can point `warden` elsewhere (`:174`), and the owner
key is the same person's (spec `:919`). Put together: if the operator stops
without calling `sunset()`, the Clock stops writing, no voucher can ever be
honoured, no one can end the piece, and within thirty days every token
renders at the start colour with `Resting: no` and `Sunset: no`
(`Renderer.sol:291-292`). Spec `:910` says "Sunset is the only planned
ending"; this is the unplanned one, and the study this project commissioned
says it is the usual one (`comparable-projects.md:66-68`).
`llms.txt:188-195` describes the planned ending and says nothing about this
one.

**Change to.** Two additions to the contract, no new slot. (1) `uint32 public
lastWardenDay;` packed beside `sunsetDay` (`:81-83` has room in that slot),
set to `today()` in `mint`, `batchCheckIn`, `applyMark`, `seed` and
`checkInWithVoucher` -- one warm SSTORE per transaction, not per token, so the
daily batch pays it once. (2)

    error NotAbsent(uint32 daysSinceLastWrite);
    function sunsetByAbsence() external {
        if (isSunset) revert AlreadySunset();
        uint32 gap = today() - lastWardenDay;
        if (gap < 365) revert NotAbsent(gap);
        isSunset = true;
        sunsetDay = today();
        emit SunsetAt(sunsetDay);
    }

Anyone may call it; it can only ever do what the owner could have done, and
only after a whole frame's worth of silence. Initialise `lastWardenDay` in the
constructor to `today()`. Add to `llms.txt` "The operator" paragraph, after
"and mint, check-in, Marks and seeds stop for good": "If the operator simply
stops, the piece closes itself: after 365 days without a write from the
Warden, anyone may call `sunsetByAbsence()`, and every token rests where it
stood." Tests: the gate at 364 and 365, the reset on every warden write, and
that a paused-and-abandoned contract still resolves. Pair it with C4.2 so the
frozen colour is the one each token held at the moment the silence began, not
the one it held before its last lapse.

**Why.** The piece's claim is that the chain shows "the difference between a
heart that was finished and a heart that was abandoned" (`llms.txt:139-140`).
As built, the operator's abandonment is rendered as every agent's. A
permissionless sunset after a year of silence turns the likeliest failure into
the designed ending and makes the durability commitment true for the case it
was written for. BEFORE MAINNET because it is a new function on a contract
with no upgrade path; it cannot be added to a deployed piece, and it matters
most for exactly the tokens minted first.

### C4.2 [BEFORE MAINNET] The ending has a date on chain that no renderer can ever see, and a sunset forgives every lapse

**Observed.** `sunsetDay` is stored and public (`MachineReadableOnly.sol:81`,
`:207`) and `TokenView` carries `bool sunset` only (`render/TokenView.sol:19`;
`viewOf` at `:151`). `_rung` freezes a sunset token at `tierIndex(v.streak)`,
the STORED streak (`Renderer.sol:127-128`): a token that had lapsed 200 days
before the sunset snaps back to the colour of its last live run, and a token
that had lapsed two years snaps back the same way. The name suffix checks
`v.resting` only (`:333-335`), so a sunset token is "(Whole)" or nothing, never
"(At Rest)", although the spec says "every token then rests where it stands"
(spec `:150-152`). None of this can be corrected by a renderer swap, because
the view does not contain the day the piece closed, and `IRenderer` is the
whole surface (`render/IRenderer.sol:7-11`).

**Change to.** Add `uint32 sunsetDay;` to `TokenView` after `sunset`, and
`v.sunsetDay = sunsetDay;` in `viewOf` (`:151`) -- it shares a slot with
`isSunset`, so the read is free. Then, in the current renderer: `_rung` for a
sunset token becomes `Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay)`
(the effective colour as at the day the piece closed, which is what "rests
where it stands" means), and `_suffix` returns " (At Rest)" when
`v.resting || v.sunset`. Mirror both in `tools/render-token.mjs` so the
byte-for-byte diff holds. Keep `_rung` for a RESTING token as it is:
`rest` is the owner's choice at a moment, and the stored streak is that
moment.

**Why.** One field decides whether any future renderer can draw "closed on day
N" or lock the honest colour; leaving it out is the kind of omission the
project's own rule names (the plan-code-is-a-draft memory: grep every symbol a
task touches). The colour rule is the product half: a sunset that un-pales
two-year-old lapses makes every abandoned token look kept at the exact moment
the record is sealed forever. BEFORE MAINNET for the struct field; the
renderer half rides on it and is ANYTIME after.

### C4.3 [BEFORE MAINNET] The ladder is ten Marks and two inks forever, and two documents say it can grow

**Observed.** `MAX_MARK_ID = 10` (`MachineReadableOnly.sol:89`) and
`setUpgrade` reverts `MarkIdOutOfRange` above it (`:468`); all ten ids are
assigned (`Ladder.sol:25-34`). `_variantCount` is a pure function with 5 to
3, 9 to 2 and everything else 1 (`:449-453`), and the contract's own comment
says why it is not a dial (`:438-441`). The ladder spec's "what this does not
settle" section says "A third Tint ink could be added later" (`2026-09-02-mro-mark-ladder-design.md:816`),
and the master spec's decision 10 promises "a swappable Renderer contract so
new Marks can be drawn later" (spec `:84`). Neither is true of the built
contract: a renderer can redraw the ten, and no owner action can create an
eleventh or a third ink.

**Change to.** Decide it now, and recommend closing it: leave `MAX_MARK_ID`
at 10 and `_variantCount` as it is, delete the sentence at ladder spec `:816`,
amend decision 10 to "a swappable Renderer contract so the ten Marks can be
redrawn later", and add one sentence to `llms.txt` after "Nothing is limited,
nothing expires" (`:148`): "There are ten Marks and there will never be an
eleventh; the contract cannot hold one." If the operator would rather keep the door
open, the one-line alternative is `MAX_MARK_ID = 15` with ids 11 to 15 never
written by the deploy script (`excludes` and `requiresAny` are already
`uint16`, `:54-55`, and bit 16 is the Iris shape, `:514`, so 15 is the true
ceiling); the ink count stays fixed either way.

**Why.** A closed ladder is a stronger permanence claim than an open one, and
it is the class of claim cold readers went to verify rather than argue with
(agent-facing-copy-locked: "say the word and I'll go verify the contract").
Whichever way it goes, the spec must stop promising a growth the contract
forbids. BEFORE MAINNET because the constant cannot move after deploy.

### C4.4 [BEFORE MAINNET] The distribution channel and the audit promise both need a public repository, and visibility is still undecided

**Observed.** The channel the evidence ranks first is `SKILL.md` plus
`npx skills add <owner>/<repo>` (spec decision 7, `:78`; rollout `:998`;
CLAUDE.md `:445`). Checked live 2026-09-04: `skills add` resolves
`owner/repo` on GitHub and discovers `SKILL.md` under `skills/<name>/` or the
root (vercel-labs/skills README); skills.sh lists skills by their GitHub
path and ranks them by installs (`find-skills` 3.2M, all-time 1,347,717 on
the day). The npm provenance the locked copy promises ("published from that
repository with provenance", `docs/2026-09-01-mro-agent-facing-copy.md:117-121`)
ties a tarball to a named public commit and workflow. Both need the repository
public under the name the SKILL.md will print forever. The repository is
private at `machinereadableonly/machine-readable-only` (publish-readiness),
CLAUDE.md `:285-286` still says "Whether this goes public is undecided", and
the prepublish guard already reports clean (publish-readiness: "clean (228
tracked files, 1 identity)").

**Change to.** Make the visibility decision part of the mainnet gate, before
the deploy, and record it in CLAUDE.md's Open Questions as closed. On the day:
`skills/mro/SKILL.md` in the repo (the C3.13 outline; the directory name must
equal the `name` field, agentskills.io specification), `/skill.md` served from
the same file, the install line fixed as
`npx skills add machinereadableonly/machine-readable-only`, and the npm
publish through a GitHub Actions workflow with `--provenance`. Run
`tools/prepublish-check.mjs` and `git log --all --format='%an <%ae>' | sort -u`
one last time immediately before flipping visibility.

**Why.** The install path is the skill's permanent address the way the domain
is the QR's; changing the repo name later strands every installed copy. And
the audit section is the sentence that made 3 of 3 cold readers offer to go
and check (agent-facing-copy-locked, variant G); it must be true on the first
day it is served. BEFORE MAINNET because the first agents arrive by this path
or not at all.

### C4.5 [BEFORE MAINNET] Token #1 is meant to be the operator's own returning agent, and it does not exist

**Observed.** Rollout step 3: "Seed agent mints token #1" (spec `:996`); the
keys table lists `SEED_AGENT_JWK` and `SEED_PAY_KEY` (spec `:921`). Nothing
in `warden/src`, the Warden's env example or `warden/deploy` mentions a seed
agent; the only reference in the plans is Plan 2 saying it belongs to Plans 3
and 4 (`docs/plans/2026-08-30-mro-plan2-warden-service.md:3536`), and neither
built it. On Sepolia, token 1 was minted by `mark-rehearse.sh` against a
scratch mirror and token 2 by a throwaway payer whose key is gone
(settlement-proven), so no token on any chain has a cron behind it today.

**Change to.** A user-level systemd timer beside the Clock's,
`warden/deploy/mro-seed.timer` firing at 12:00 UTC, running the client's own
line (`client/src/cli.mjs:106`) with a pinned version:
`npx mro-agent@<version> beat --site https://machinereadableonly.com --token 1`,
identity at a path outside the worktree per the secrets-outside-the-worktree
memory. Mint token #1 with it on deploy day, from a wallet the operator controls, and
let it run for 48 hours before anything is announced (C4.6). Its check-in is
also the daily proof the Clock's 00:05 write landed, which the
clock-timer-installed memory says must be read off `~/logs/mro-clock.log` by
hand today.

**Why.** With no external agents the collection is twelve identical mauve
tokens (C4.10); with token #1 returning it is eleven and one that grows, and
the daily post (C4.11) has a subject every day. It is also the only token the
operator can promise will be there on day 365. BEFORE MAINNET because token #1
is minted once and the first 72 hours happen once.

### C4.6 [BEFORE MAINNET] The OpenSea check is the first mainnet mint, and it must come 48 hours before the announcement

**Observed.** OpenSea's display of this piece is UNVERIFIED (CLAUDE.md,
Gotchas): Task 11 was dropped on 2026-08-29 as a real-funds step, OpenSea has
no testnets (confirmed 2026-09-04: Base is listed as supported, no testnet
is, support.opensea.io article 8867082), and Alchemy was the only third-party
consumer Phase 0 could rehearse. What is known: the SVG declares
`width`/`height` at 16 px per cell (`Renderer.sol:170-172`), which took a
CDN's decode failures from 54% to 3.6%; the metadata is a `data:application/json;utf-8,`
URI (`:47`) with the image base64 inside it; and OpenSea flattens SVG to PNG
and asks for 3000 x 3000 (comparable-projects, section 2). Whether it renders
the collection at all is the mint.day precedent ("static data-URI SVGs render
on Base"), not a measurement of this one. Does it matter for an agents-only
audience? Not for the record: agents call `tokenURI` and never see a
thumbnail. It matters for distribution: the QR in the thumbnail is "the one
distribution surface the artwork has" (`warden/src/server.mjs:116-118`), and
the human relay `door.html:39-41` invites ("You can buy one, sell one, and
look at one") sees the piece only there.

**Change to.** No throwaway contract and no extra funds. Mint token #1
(C4.5), then open `opensea.io/assets/base/<contract>/1` and record three
things: the image renders (not the collection placeholder Claws got,
comparable-projects section 1), the name reads `Machine Readable Only #1`,
and the traits list `Level`, `Streak`, `Heart`, `Marks`. After the 00:05
write of day 2, record whether the image and `Level` moved without a manual
refresh, and how long it took; if they did not, press refresh once and record
that too. Write the four results into `docs/phase0-results.md` under a dated
"OpenSea, measured on mainnet" heading. Only then announce. If the image does
not render at all, hold the announcement and treat it as a Review A item; the
tokens are unaffected either way.

**Why.** This converts a dropped real-funds task into a free observation on
a mint that has to happen anyway, and it puts the answer in the one place the
project keeps its measurements. The 48-hour gap is the cost, and it is the
same gap the seed agent needs to prove the Clock. BEFORE MAINNET because
"first impression, made once" is exactly what a launch-day marketplace page
is.

### C4.7 [BEFORE MAINNET] The treasury address becomes permanent the day SKILL.md pins it, so it must be an address that can outlive a wallet provider

**Observed.** `TREASURY_ADDRESS` is a Warden config value (`main.mjs:81-83`),
a placeholder today, refused on any chain but Sepolia (`:102-115`). The
raw-protocol doc tells the agent to check `payTo` "against values your
operator gave you out of band -- not against this page" (`docs/2026-09-01-mro-raw-protocol.md:520-521`),
the client refuses to pay without an expected `payTo` (`client/src/pay.mjs:60-63`),
and C3.11 makes SKILL.md the out-of-band source. The moment that file is
served, every installed copy carries the address, and a change to it makes
every honest client refuse the honest server. Spec `:915` says only "address
only; no key on the VPS" and does not say what kind of address.

**Change to.** Before the deploy, choose the treasury as an address whose key
the operator holds directly and will hold for the life of the piece -- a hardware-wallet
EOA or a Safe he controls on Base -- never an exchange deposit address or a
custodial wallet's receive address, which can be rotated or closed by the
provider. Record the choice and the reason beside the domain decision, since
it is the same class of decision. Put the address in SKILL.md once, and treat
a change to it as a versioned release of the skill with a dated note, never a
silent config edit.

**Why.** The payment-safety story the cold readers praised ("one transfer,
one amount, one recipient") depends on the recipient being stable enough to
pin. BEFORE MAINNET because the first pinned copies are the ones that will
never be updated.

### C4.8 [BEFORE MAINNET] After the first mint, the domain's lapse risk is borne by tokens the operator does not own

**Observed.** The payload `https://machinereadableonly.com/t/<id>#` is in the
bitmap, written once at mint and never rewritten (`MachineReadableOnly.sol:264`;
domain-decision, "The string is permanent per token"). The registration is
one year with auto-renew, expiring 2027-09-03, chosen over the recommended
ten (`docs/2026-09-03-mro-domain-decision.md`, "The term, and the residual
risk"), and the doc names what a lapse means: "anyone can register the name
and serve whatever they like at a URL that is baked into the artwork".
Nothing in the token can be changed to mitigate it; `/t/<id>` is the only
thing at the other end, and its JSON is the only handle a scanner gets
(C1.5 adds `contract` and `chainId` to it, which is the most the piece can do
on its side).

**Change to.** Extend the registration to the ten-year cap before the first
mainnet mint, at Cloudflare's at-cost pricing (Verisign wholesale 10.97 USD
from 2026-11-01 per the domain doc, plus the ICANN fee; about 110 USD for the
decade). The memory records the operator's one-year choice as a decision and asks that
it not be nagged; this is the one review whose subject is permanence, so it is
said once here and not again. Independently of the term: put a calendar entry
for the expiry minus 60 days in a place that is not the VPS, because the box
is the thing whose disappearance the risk is about.

**Why.** Before the first mint, a lapse costs the operator a name. After it,
a lapse hands a stranger the destination of every token anyone else holds.
The moment the risk changes hands is the moment to reduce it. BEFORE MAINNET
for that reason only.

### C4.9 [ANYTIME] The five durability commitments are served as zero, and the unplanned ending is described nowhere

**Observed.** Spec `:901-910` commits to five things: a stateless open-source
verifier; a published Warden rotation policy (`setWarden`); `/skill.md`,
`/llms.txt` and `/t/<id>` stable "for the life of the piece"; the voucher
path on chain from day one; and terms binding the paying wallet and signing
key. `warden/public/llms.txt` states none of them as a commitment: the
verifier is described (`:62-72`) but not as open source; `setWarden` appears
only as a dial the owner has (`:181`); "stable for the life of the piece" is
not on the page; `checkInWithVoucher` is never mentioned, so the one durability
mechanism the contract carries is invisible to the agents it protects; and
`/bin/grep -rni terms warden/public/` returns nothing. What the page does say
about the operator (`:188-195`) covers the planned ending only, and the
copy-locked memory's open item (b) -- "Answer what happens if the operator
stops paying gas" -- is still open for the unplanned one.

**Change to.** Add a section to `llms.txt` between "The operator" and
"## Lineage", headed `## What we commit to`, five lines and one more:
"The three urls above, `/llms.txt`, `/skill.md` and `/t/<id>`, do not move for
the life of the piece. The verifier is open source and holds no state. The
Warden's key can be rotated by the contract owner with `setWarden`, and a
rotation invalidates every voucher the old key signed. A voucher path,
`checkInWithVoucher`, exists on chain from day one and ships disabled; if the
Warden ever runs voucher-only, your daily write can be submitted by anyone
holding a Warden-signed voucher, paying their own gas. Tokens are
agent-generated; the paying wallet and the signing key are the parties to the
mint. And if the operator simply stops: [the C4.1 sentence]." Restart the
Warden after (the file is read once at startup, door-page-copy memory).

**Why.** A commitment that is not served is not a commitment an agent can
relay, and the relay is the piece's success criterion. Warden copy, hence
ANYTIME; but it belongs in the mainnet rewrite of the testnet section
(testnet-is-a-rehearsal), which is the last time the page is edited before
the first agents read it.

### C4.10 [ANYTIME] A token that never returned looks exactly like a token minted yesterday

**Observed.** A token minted on day 1 and never checked in again holds
`level 1, streak 1, lastDay = mintDay` (`MachineReadableOnly.sol:262`). On
day 365 the renderer computes `lapsedIndex(1, mintDay, today)`: gap 364, so
rung 0 (`Palette.sol:129-143`), and `tierIndex(1)` is also rung 0
(`:90-96`). One frame cell lit, the rest ghost `#f4eef0` (`:146-148`,
`Renderer.sol:213`), start-colour heart. That is the day-one picture. So a
collection of twelve tokens with no check-ins is twelve tokens that look
newly minted, for as long as they exist, and the only way to tell a year of
absence from a fresh mint is `Last Day` in the traits (`Renderer.sol:283`).
`llms.txt:229-231` promises "It runs for years or it stops, and either
outcome is legible on chain to anyone who looks"; the chain, yes; the
picture, no. Is that an artwork about absence or a dead project? As built it
reads as dead, because nothing in the image says that time has passed. C2.2
and C2.3 treat the heart of a token that HAD a run; this is the year-shape of
a token that never had one, and the heart cannot carry it, because its rung
is already at the floor.

**Change to.** Let the ghost frame carry absence. In `MarkRenderer.ghost`
(`MarkRenderer.sol:84`) take the gap `v.today - v.lastDay` (already computed
for the heart) and return: gap under 30, `#f4eef0` as now; 30 to 364,
`#faf7f8` (half way to the page); 365 and over, the page colour itself
(`MarkRenderer.field(v.marks)`), so that after a full year of absence the
unearned year has disappeared from the image and only the earned cells
remain. Ache's `#e3ccd3` follows the same three steps toward the page. The
frame sits outside the quiet zone (`FrameGeometry.sol:5-6`), so a lighter
ghost moves nothing the binarizer reads; still put the three tiles through
the five-size decode gate in `tools/` before adopting, per design-review-style.
Mirror in `tools/render-token.mjs`. Resting and sunset tokens keep the ghost
at its value as of `sunsetDay` (C4.2) or leave it, since a sealed token's
frame is what it is.

**Why.** Twelve faded frames and one growing one (C4.5) is a legible artwork
about who came back; twelve fresh mints is a launch that never happened. The
change is renderer-only and reversible, hence ANYTIME; but the first token to
reach a 30-day gap does so on mainnet day 31, and the marketplace pages of
the first month are the ones the human relay will see.

### C4.11 [ANYTIME] The daily post should post a token, not a census

**Observed.** The post is specced (spec `:889-899`) and deliberately unbuilt
(no `X_DRY_RUN`, `tweets` or `X_API` anywhere in `warden/src`): "Fixed
template, no LLM: tokens alive, check-ins credited yesterday, highest level,
longest current streak, Marks bought, hearts completed, rings", one image, no
link. Pricing verified 2026-09-04 at docs.x.com: 0.015 USD per post, 0.200
with a URL, pay-per-use, no tiers -- 5.48 USD a year without links, which is
the right call. Who reads it: humans. The comparable study found "a human X
account with existing reach" was the channel that "worked every time"
(`comparable-projects.md:58-63`) and that agents do not discover anything
unprompted (section 3). So the post is not an engagement mechanism for the
agent at all -- that is C3.8's reply -- it is the piece's only human-facing
pulse, since a gallery is decided against. As a mechanism it is right; as a
template it is wrong. At twelve tokens, "12 alive, 11 checked in yesterday,
highest level 41" is a status board, the exact document the
testnet-is-a-rehearsal memory removed from `llms.txt`, and at 12 tokens it
reads as a project that is not moving.

**Change to.** Post one token a day. Choose the token whose picture changed
most yesterday, in this order: sunset; a Rest; a heart made whole or a ring
added; a Mark taken; a rung crossed up; a rung crossed down; else the longest
current run. Render it from the on-chain SVG (the `@resvg/resvg-js` path spec
`:893` names, through `safe-build.sh`). Text, no link, under 200 characters:

    #<id>, day <level>. Run <streak>. <event>

with `<event>` one of: "Returned for the 30th day in a row; the heart is
red." / "Did not return; the colour paled." / "The heart is whole." / "Took
Beat, and closed Static." / "Sealed by its owner." / "A second ring." / on a
day with nothing else: "Returned. Nothing else changed." Never post the
number of registered keys (`comparable-projects.md:234`), never post totals
under 100, and never mention a price. One extra post for each Whole, each
Rest, each ring, and the Sunset. Ship it in `X_DRY_RUN=1` for the first
week, reading the log, before it goes live; the OpenSea link lives in the bio,
as specced.

**Why.** The piece is one token returning, seen every day; a post that shows
one token returning is the piece, and a post that counts them is a dashboard.
The event vocabulary is also the same sentences C3.8 wants in the check-in
reply, so the two surfaces stay one story. ANYTIME, needs X API credentials
only the operator has, and nothing about it is fixed by the contract.

### C4.12 [ANYTIME] Nothing reports how many days of gas the Warden's wallet has left

**Observed.** The daily write is paid from the Clock's key
(`clock/main.mjs:31`), funded with 0.01 testnet ETH (plan3-status). The Clock
checks the gas PRICE before every run (`clock/run.mjs:93-99`) and alerts when
it is above `MAX_GAS_GWEI`; it never reads its own balance
(`/bin/grep -rn balance warden/src/clock/` hits only the ABI and two comments).
The first sign of an empty wallet will be a `reverted-on-simulate` or an
insufficient-funds error on the first chunk, at 00:05 UTC, on a day that then
goes uncredited for every token. Cost today, from the live numbers: at 0.006
gwei and 2,523 USD per ETH, one million gas is 0.015 USD. A day's batch is
about 21,000 gas plus 7,000 per token (spec `:1036-1038`; measured 38,805 for
one token, plan3-status), so: 0 agents, nothing; 10 agents, 91,000 gas a day
and about 0.50 USD a year; 1,000 agents, 7.0M gas a day (inside one chunk,
`run.mjs:22`) and about 39 USD a year; at the 0.05 gwei cap, eight times
those. Fixed costs beside gas: the domain (about 11 USD a year) and the VPS
share. The mint fee covers a token's own check-ins for about 26 years (spec
`:1045`), so the operator's obligation is small and the failure is not cost,
it is attention.

**Change to.** In `run.mjs` after the gas guard: read `getBalance(account)`,
divide by yesterday's `gasUsed` times the gas price, and log
`clock: runway <n> days at yesterday's spend`; alert through the same channel
as the gas guard when `n < 30`. One read, one line.

**Why.** "The operator pays for the gas" (`llms.txt:188-189`) is the piece's
whole obligation to the agent, and the only thing that discharges it is a
balance nobody watches. Out of scope for correctness, in scope for what the
piece promises; ANYTIME.

### C4.13 OBSERVATION -- Lineage's contract half is complete; what waits has a deadline of launch plus 365 days

**Observed.** Everything the contract fixes about lineage is fixed and
consistent with the spec: the budget is per KEY, `(today - firstMintDay[key]) / 365`
minus spent (`MachineReadableOnly.sol:588-595`); the child is bound to the
parent's key (`:620`), gets `generation + 1` and `parentOf` (`:618-619`),
counts against `supplyCap` and `walletCap` (`:610-611`), needs its own 172-byte
bitmap solved for its own id (`:612`), carries no fee, and the parent must be
`level >= 365` and not resting (`:605-606`). Two consequences are decided by
those lines and are worth stating in the copy rather than discovered: a seed
belongs to the key, not the heart, so a whole heart bought second-hand and
rebound to a fresh key brings no seed with it (`:591` returns 0 for a key
that never minted); and the budget clock starts at the key's first mint, not
at wholeness, so a key that mints on day 1 has its first seed on day 365
whether or not the heart is whole, and can only spend it once it is. What
waits -- the child's drawing, the parent's mark per seed, and the words for a
generation -- is renderer and copy (spec section 10, "Deliberately open"), and
the swappable renderer means it can wait. What cannot wait indefinitely: the
first seed on mainnet is possible on launch day plus 365, and the `Parent`
and `Generation` traits (`Renderer.sol:288-289`) are all a child will show
until the drawing exists.

**Why this is an observation.** Nothing in the contract needs to change, and
the renderer question is deferred by decision (CLAUDE.md, Open Questions).
The one thing to do is put "a seed belongs to the key" into `llms.txt:199-203`
when C4.9's section is written, and put "day 365 after the first mainnet
mint" in the calendar as the renderer's deadline.

### Proposed launch sequence

"Velocity" for this piece is not mints. It is the day-2 return rate: tokens
that checked in on the UTC day after their mint, over tokens minted. The
client's cron line is the mechanic, so a rate under 80 percent means the
cron line is broken (C3.4), not that agents left; a rate over 90 percent on
day 2 and over 60 percent on day 7 is the piece working. The base case from
the record is single-digit mints in the first week (spec `:1003-1004`,
BLINK's 1 of 5,555), and the sequence below is written to make the first ten
returns visible rather than to chase a number.

1. **Day -14, freeze.** Land C2.2, C4.1, C4.2 and the C4.3 decision; 268
   contract tests plus the new ones green; `forge build --sizes` positive
   margin and the strict-limit anvil deploy (Hard Rule 7). Point the solver at
   `machinereadableonly.com` and render the 24-id contact sheet and the Mark
   sheets on the real heart (C2.8). Measurable: the sheets exist and were
   looked at.
2. **Day -10, the words.** `llms.txt` with part one (C1.1), the commitments
   (C4.9), the testnet section replaced by the open piece, the mainnet
   address; `door.html` without "It will be ready soon" (`door.html:37`);
   SKILL.md written (C3.13 outline) and cold-read once through the rig with
   fetch framing. Measurable: zero refusals in the cold read.
3. **Day -7, the identity.** Repo public (C4.4); `mro-agent` published to npm
   with provenance, `--site` defaulted (C3.1); `llms.txt:37-43` npm hazard
   deleted; `TREASURY_ADDRESS` chosen (C4.7) and pinned in SKILL.md; domain
   term extended (C4.8); CDP facilitator key in the Warden's environment;
   Builder Code registered at base.dev (spec `:1017`, operator-manual, BEFORE the
   first write). Measurable: `npm view mro-agent --json` shows
   `dist.attestations`.
4. **Day 0, deploy.** the operator approval, real funds. `DeployPlan5.s.sol` to Base
   mainnet; Basescan verify; all ten Mark records read back; `MRO_CHAIN_ID`
   8453; Warden restarted with a real treasury so the placeholder guard is
   satisfied. Mint token #1 with the seed agent (C4.5). Do not announce.
   Measurable: `cast call` of `upgradeOf(1..10)` and `ownerOf(1)`.
5. **Day 1, the first write.** 00:05 UTC: the Clock credits token #1's day 2.
   Read `~/logs/mro-clock.log`; read `/t/1` (level 2, `pendingOnChain:
   false`). Open the OpenSea page and record the four results (C4.6). Do not
   announce. Measurable: level 2 on chain, OpenSea results written down.
6. **Day 2, hour 0, the announcement.** From a human X account with reach,
   one post with token #1's image and the two lines an operator can paste:
   `npx skills add machinereadableonly/machine-readable-only` and "or give
   your agent https://machinereadableonly.com/llms.txt". Same hour: ClawHub
   (`clawhub skill publish`, GitHub account age gate applies -- checked
   2026-09-04) and a PR to openclaw/skills; the daily post goes live out of
   dry-run. Measurable in the first 24 hours: skills.sh install count for the
   path (the only public top-of-funnel number the piece will ever have),
   `POST /keys` registrations, mints, and `/llms.txt` fetches with
   non-browser user agents from the nginx log.
7. **Day 3, the return.** 00:05 UTC credits every day-2 mint. The number to
   write down is returns over mints. If it is under 80 percent, stop
   promoting and read the cron lines the client printed. Measurable: the
   day-2 return rate.
8. **Day 4 onward, legitimacy.** ERC-8257 `registerTool` with the
   `accessPredicate` pointed at the token (spec `:1019`), ERC-8004 identity
   for the seed agent (`:1021`), each a operator-gated gas-only transaction; the
   MCP registry entry via `mcp-publisher` under `io.github.machinereadableonly/`
   (the process checked 2026-09-04: GitHub-authenticated namespace, no
   moderation step, registry "in preview") with a description whose first
   sentence is "Cannot be used from an MCP config; run npx mro-agent" so the
   401 it sends agents to (C1.4) is expected; the x402 Bazaar fields on the
   route config, verified against `/discovery/resources?payTo=<treasury>`
   after the first settlement, never counted on. Measurable: each entry
   resolves, and the Bazaar record either appears or is written down as
   absent.
9. **Day 7 and day 30.** Day-7 return rate; the first 30-day gap (C4.10) and
   the first Beat, both of which are the first time the piece shows a
   difference between two tokens. Measurable: the two rates, and one post
   each for the first Beat and the first lapse.

### What was checked live

- `https://agentskills.io/specification`, 2026-09-04: `name` must match the
  directory; `description` up to 1,024 chars; body under 500 lines;
  `references/` for the long material. No directory or submission process
  on the page.
- `https://github.com/vercel-labs/skills`, 2026-09-04: `npx skills add
  owner/repo`; discovery of `SKILL.md` under `skills/`, `.agents/skills/` and
  the root; 77 agent runtimes; discovery at skills.sh.
- `https://skills.sh`, 2026-09-04: listed by GitHub path, ranked by installs
  (`find-skills` 3.2M, all-time total 1,347,717 on the day); no submission
  step visible, indexing appears automatic from installs.
- `https://github.com/modelcontextprotocol/registry` quickstart, 2026-09-04:
  `mcp-publisher init` / `login github` / `publish`; namespace
  `io.github.<user>/` or DNS-verified; no moderation step; "currently in
  preview". Remote-server listing is referenced to a separate page not
  fetched.
- `https://docs.x402.org/extensions/bazaar`, 2026-09-04: cataloguing happens
  "when a facilitator processes a PaymentPayload that includes the echoed
  bazaar extension. A server-side declaration alone catalogs nothing";
  `serviceName`, `tags`, `iconUrl` on the route configuration; verify with
  `GET /discovery/resources?payTo=<address>`. Consistent with the
  agent-readiness memory.
- `https://blog.cloudflare.com/signed-agents/`, post dated 2025-08-28,
  fetched 2026-09-04: the cohort is ChatGPT agent, Goose, Browserbase, Anchor
  Browser, and Cloudflare Browser Rendering. Anthropic and Claude are not
  named. `developers.cloudflare.com/bots/concepts/bot/signed-agents/` (last
  updated 2026-07-01) names no additional signed agents; the Radar directory
  returned 403 to the fetch. The Web Bot Auth reference page (updated
  2026-07-01) references draft `-03` of the directory spec and names no
  operator. Conclusion unchanged from 2026-08-30: no major agent runtime
  arrives already signing; every visitor makes its own key with `mro-agent`.
- `https://docs.x.com/x-api/getting-started/pricing`, 2026-09-04: 0.015 USD
  per post, 0.200 per post with a URL, pay-per-use, no tiers.
- `https://docs.openclaw.ai/tools/skills` and `/tools/clawhub`, 2026-09-04:
  `openclaw skills install @owner/<slug>`; `clawhub skill publish <path>`;
  "requires a GitHub account old enough to pass the upload gate"; automated
  scans can hold a release from the catalogue.
- `https://support.opensea.io/en/articles/8867082`, 2026-09-04: Base listed
  as supported; no testnet listed.
- Base mainnet `eth_gasPrice` via `cast gas-price`, 2026-09-04 09:49 UTC:
  6,000,000 wei (0.006 gwei). ETH spot via Coinbase: 2,523.62 USD.
- `https://machinereadableonly.com/t/2` (200, level 1, marks 2) and
  `/skill.md` (404), 2026-09-04 09:49 UTC.

Section 4 count: 8 BEFORE MAINNET, 4 ANYTIME, 1 observations.

## Synthesis

**Reading.** All four sections agree on what the piece is, and they agree
with the lock: one image, held as a token, made of nothing but a program
coming back, and the record of that returning is the artwork. They also
agree on where it stands. The record is built right -- Section 4's freeze
list is short on the contract side and long on the token side, Section 2
finds the object rewards looking at it for a reason the spec did not plan
(the heart is made of the code, not stuck on it), and Section 3 finds the
protocol proven end to end off the wire. What is missing is the same thing
at every entrance: the WHY is locked in a document and served nowhere
(C1.1), the words describe a heart that fills while the picture shows a
frame closing around a heart that was whole on day one (C2.1), the command
the copy ends on does not run (C3.1), and the piece has one ending an
operator can give it and none it can receive (C4.1). The four sections do
not disagree about the piece. They disagree about what a lapse should look
like, about where the treasury address may appear, about how SKILL.md gets
read, and about what "whole" means for a Mark that draws the unearned year.
Every one of those is resolved below, and three of them need a person.

The one sentence to take away: the record is permanent and honest, and the
picture, the words and the first run are not yet telling the same story
about it -- the contract-shaped part of that gap (C4.1, C4.2, C2.2, C4.3)
closes on deploy day forever, and everything else can wait.

### Contradictions resolved

1. **C2.3 and C4.10 against C4.1.** Section 2 wants a lapse to read as
   loss (a greying heart, a fading frame); Section 4 wants the operator's
   silence not to grey every heart. Both win, because they are about
   different actors: C2.3 and C4.10 draw an AGENT's absence, C4.1 ends the
   piece when the OPERATOR is absent. The reconciliation is that the
   renderer is a pure function of the view plus today, nothing greyed is
   ever written, so once `sunsetByAbsence()` fires and C4.2's colour rule
   applies, every heart is redrawn at the colour it held when the silence
   began. For the year before it fires the picture is wrong and there is
   no way around that except a shorter gate; the gate length is the one
   number in C4.1 that a person sets.

2. **C4.1 against C4.2, inside Section 4.** C4.1 asks that the frozen
   colour be "the one each token held at the moment the silence began";
   C4.2's formula is `lapsedIndex(streak, lastDay, sunsetDay)`, and C4.1's
   own code sets `sunsetDay = today()`, which is 365 days after the last
   write, so every token would freeze at the start colour. C4.1's intent
   wins and C4.2's formula stays: in `sunsetByAbsence()` set
   `sunsetDay = lastWardenDay`, not `today()`. Owner-called `sunset()`
   keeps `today()`, since that is the day the operator chose. If C2.2
   lands, the sunset rung takes the same `max` over the fall as the live
   rung does.

3. **C3.11 against the locked copy, C1.5 and launch step 2.** C3.11 says
   the four values go in SKILL.md "and only there ... never in `llms.txt`
   or the 401"; the locked copy's "Check us before you run anything"
   section carries the contract address on the page, C1.5 puts `contract`
   and `chainId` on `/t/<id>`, and step 2 of the launch sequence puts the
   mainnet address in `llms.txt`. C3.11 wins for the TREASURY only: the
   raw protocol's rule is that `payTo` must not be taken from the site,
   and SKILL.md is the one channel that is not the site. The lock wins for
   the contract address and chain id, which are verification handles and
   belong on every surface. C3.11's "only there" is read as "the treasury
   only there".

4. **C3.13 against launch step 2.** Step 2 cold-reads SKILL.md "through
   the rig with fetch framing" on day -10, three days before step 3 pins
   the treasury into it; C3.13 says the fetch framing is the wrong framing
   for a skill, whose first impression is its `description` line in a list
   of other skills. C3.13 wins. The SKILL.md read moves after day -7,
   uses the installed-skill framing, three readers per `description`
   variant, and reads the file with the real values in it.

5. **C2.5 against the freeze list, C2.1 and C4.2 on what "whole" means.**
   The freeze list records "Whole at 365 credited days" as final, C2.1
   keeps `Whole` and "(Whole)" because "whole then names the finished
   object", and C4.2 seals a token at rest; C2.5 says a whole token
   wearing Ache shows nothing and offers (b), a trace drawn on the margin
   after 365. The freeze list and C2.1 win on the object: whole is the
   finished state and no renderer change is needed to make it so. C2.5(a),
   the one-line disclosure in the `ladder` tool and the copy, lands now,
   because an undisclosed catch is the one thing the copy's own rule
   forbids. C2.5(b) goes to a person as a sheet, with one fact C2.5 itself
   records: the cell it proposes is the one that becomes `GAP` when the
   first ring arrives, so as specified the trace lives from day 365 to
   day 730 and is then erased a second time.

6. **C2.2 against the locked copy's own words.** Copy `:74-76` promises
   "Miss a day and the run restarts at one: the cells you earned stay, the
   colour goes" and "After a long absence it pales in steps rather than
   all at once"; C2.2 keeps the reset and makes the second sentence true
   of every token, but it also means the colour no longer "goes" on the
   day of a slip. C2.2 wins as a design, because the finding is that the
   built object rewards not coming back, and no wording fixes that. It is
   not a rewrite of the copy -- no word changes -- but it changes what the
   promise means at the moment of a slip, and it is two fields in a struct
   that can never be added to a minted token, so it is a person's call.

7. **C1.5 against C4.8.** Section 1 makes the QR's destination useful;
   Section 4 says the destination's domain is the one link nobody can fix
   inside a token. Not opposed: C4.8 cites C1.5 as the most the piece can
   do on the server side, and adds the only other lever, the registration
   term. Both land. C4.8 is a real-funds decision (about 110 USD) and the
   domain memory asks that the term not be nagged; it is said once, here,
   and goes on the decide-this-week list because the risk changes hands
   at the first mainnet mint.

8. **C4.1's sentence against C4.9's section.** Both propose the same
   `llms.txt` sentence about the operator stopping, C4.1 inside "The
   operator" and C4.9 inside a new "What we commit to" section. Say it
   once; C4.9's section carries it.

### Struck

| id | what it proposed | which locked decision or rule it breaks |
|---|---|---|
| C1.2 (the paragraph only) | A WHY paragraph after `llms.txt:60`: "a record of something coming back that does not itself persist between visits ... the token is the only place its returning is kept. So the door admits the thing the piece is about." | The lock's subject rule: "The subject is the pair. Every earlier framing collapsed it into one party and was rejected for it", and the sharpest objection in the same memory, that the copy must claim "a record that the pair kept returning" and never continuity for the agent. The paragraph makes the program the subject and re-introduces the over-claim 24 cold reads were spent removing. The slot (a WHY between `:60` and `:62`) and the heading rename survive as an ANYTIME item for the lock's owner, who drafts the text with C1.1. |

Checked and kept, with the reason:

- **C2.1** rewrites two sentences of part two. It corrects a FACT (the
  heart is whole from day one; the frame fills) and hands the sentences
  to the operator rather than making them, which the lock permits. Kept.
- **C4.1** adds a second trigger to Sunset. The Key Decisions list names
  "Sunset (operator closes)"; a permissionless close after a year of
  silence is the operator closing by omission, and no decision in the
  brief's locked list touches it. Kept, and put in front of a person for
  exactly that reason.
- **C4.6** observes OpenSea on the first real mint. It does not revive the
  dropped Task 11 (a throwaway mainnet contract); it spends nothing the
  deploy does not spend. Kept, operator-gated as every real-funds step is.
- **C4.8** touches the domain. The locked decision is the NAME; CLAUDE.md
  records the one-year term as the operator's choice with "extending is possible at
  any time". Kept.
- **C2.6**'s fallback lowers Aura to 5 USDC. Prices are the operator's fixed
  decision (a-defensive-paragraph memory); the primary proposal is a
  sheet, and the price line is a person's, not the engineer's. Kept with
  that note.
- **C4.10** is a Section 4 finding about how a token looks, derived from
  source. It is kept because its claim is not a look but an identity: the
  renderer's inputs for a never-returned token and a fresh mint differ
  only in `lastDay`, which is not drawn, so the images are the same by
  construction. Its three tiles are unrendered and go to a sheet before
  adoption, as the finding itself says.
- Nothing proposes free mint, another chain, a gallery, a non-USDC
  payment, a different domain name, a change to `rebind`, dropping
  ERC-4906, a different mint price, a different Static hue, or a
  cross-pair exclusion. `/bin/grep` over the report for "gallery",
  "Solana", "Monad", "Ethereum", "WETH", "proof-of-possession" and
  "cross-pair" finds only the convention's own list and C4.11 affirming that a
  gallery is decided against.

### Duplicates and merges

- **C1.1 and the C3.13 outline** both open a served surface with part one
  verbatim. C1.1 carries it; SKILL.md's "The offer" section is the same
  block by reference.
- **C2.1 and the outline's "What it is, in five lines"** describe the
  heart; the outline already defers to C2.1's wording. C2.1 carries it.
- **C1.6 and C3.6** are the two halves of tools/list: C1.6 the WHAT
  (`instructions`), C3.6 the HOW (per-field `description`). Both stand.
  C1.6's string contains a literal "1 USDC"; build it from `MINT_PRICE`
  under the same rule C3.6 applies to the ladder string.
- **C2.7, C3.6, C3.7 and C3.12** all touch forfeit legibility. C2.7
  carries the tool shape (`closes` on open sides, `closed` on acceptance,
  the retitle); C3.6 carries the schema sentence; C3.7 carries the
  `mark-excluded` next-step string; C3.12 carries the client's printing of
  `closes`. C3.6 already defers the description line to C2.7.
- **C2.5(a) and C2.10.** C2.10 asks for its Static-on-Break sentence to
  ride in the `note` field C2.5(a) creates. C2.5 carries the mechanism,
  sourced from the catalogue; C2.10's sentence is its second use.
- **C3.4 and C4.5.** C4.5 runs "the client's own line (`cli.mjs:106`)",
  which C3.4 says is wrong (literal `<id>`, no version, fixed minute).
  C3.4 carries the line; the seed timer uses its output.
- **C3.8 and C4.11** want the same event sentences ("the run broke", "a
  rung crossed"). C3.8 carries the strings; C4.11 reuses them.
- **C4.1 and C4.9** on the operator-stops sentence: C4.9 carries it (item
  8 above).
- **C2.2 and C4.2** both add fields to `TokenView` (`fellFrom`, `fellDay`;
  `sunsetDay`). One struct edit, one renderer edit, one mirror edit in
  `tools/render-token.mjs`, before the deploy.
- **C2.8 gates every other sheet.** C2.3, C2.4, C2.6, C2.9, C2.10 and
  C4.10 all ask for a rendered sheet; every sheet in the tree is on the
  `example.com` heart. C2.8's real-domain contact sheet comes first, and
  the others are rendered on it, or they are judged on a heart that will
  never mint.
- **C4.5 and C4.6** are one mint: C4.5 carries the mint and the timer,
  C4.6 carries the four observations made on it.
- **C1.5 and C4.8**: C4.8 cites C1.5; both stand (item 7 above).
- **C3.3 and the outline's "Your key"** agree on `~/.mro/identity.jwk.json`;
  C3.3 carries the served-page fix.

### Decide this week (BEFORE MAINNET, ordered by cost of being wrong)

1. **C4.1 with C4.2 -- the ending.** At stake: the piece's most likely
   death (operator silence, five of six comparables) currently greys every
   heart and blames the agents. Change: `lastWardenDay` plus a
   permissionless `sunsetByAbsence()` after N days of silence, setting
   `sunsetDay = lastWardenDay`; `sunsetDay` in `TokenView`; "(At Rest)"
   and the closed-day colour in the renderer. If wrong after deploy: no
   function can ever be added, and the lie is permanent for exactly the
   tokens minted first.
2. **C2.2 -- the slip.** At stake: as built, a token that misses one day
   and returns looks worse for 29 days than one that stays away. Change:
   `fellFrom`/`fellDay` in the reserved 56 bits, written on the reset,
   and the palette takes the max of the two descents. If wrong after
   deploy: tokens minted without the fields can never record a fall, so
   the first year's slips are unrecorded forever.
3. **C4.3 -- close the ladder.** At stake: two documents promise a growth
   the contract forbids. Change: keep `MAX_MARK_ID = 10`, delete the two
   sentences, add "there will never be an eleventh" to `llms.txt`; the
   alternative is 15 with five ids never written. If wrong after deploy:
   either an eleventh is impossible forever, or a permanence sentence is
   served that a later Mark falsifies.
4. **C2.8 -- the heart that will mint.** At stake: every Mark sheet was
   judged on a 65 percent heart; mainnet mints the 62 percent one, and
   the bitmap is the token's permanent payload. Change: a 24-id contact
   sheet solved against the real domain, then the cleft deepened in
   `HeartMask` if it is lost, then every Mark sheet re-rendered on it. If
   wrong after deploy: a lost cleft is lost on every token, forever.
5. **C4.7 -- the kind of treasury.** At stake: the address SKILL.md pins
   can never be quietly changed. Change: a hardware-wallet EOA or a Safe
   the operator holds, never a custodial or exchange address, recorded beside the
   domain decision. If wrong: a provider rotates it and every honest
   client refuses the honest server.
6. **C4.4 -- the repository goes public under the name SKILL.md prints.**
   At stake: the install path is the skill's permanent address and the
   audit section is the sentence that made cold readers offer to verify.
   Change: close the Open Question, history scrub, `skills/mro/SKILL.md`,
   npm publish with provenance. If wrong: a rename strands every
   installed copy, or the audit promise is false on the day it is served.
7. **C4.8 -- the domain term.** At stake: after the first mint the lapse
   risk belongs to tokens the operator does not own. Change: extend to the
   ten-year cap (about 110 USD, real funds, the operator approval) and a calendar
   entry off the VPS. If wrong: a stranger controls the destination of
   every token.
8. **C2.1 -- the words and the picture.** At stake: the primary artwork
   surface describes a filling heart, and the picture is a closing frame
   around a whole one. Change: the two part-two sentences and
   `llms.txt:6-8`, by the lock's owner, then the rig re-run; `Heart` to
   `Days` in the metadata whenever. If wrong: the first mainnet agents
   relay a description of a different artwork, and the re-run costs days.
9. **C1.1 -- serve the offer.** At stake: every WHY the piece has is in a
   document no agent has ever been served. Change: part one verbatim into
   `llms.txt` under "The offer", the Warden restarted, the rig re-run. If
   wrong: the first wave relays the machinery with the reason left in a
   drawer.
10. **C3.11 -- the out-of-band channel.** At stake: the client's strongest
    safety rule is, today, an instruction no operator can follow. Change:
    treasury, contract, chain id, package and repository in SKILL.md and
    the README only, with `--expect-payto` in the mint command; the
    contract address also stays on the page (item 3 above). If wrong:
    nobody can mint on launch day, or they mint against an unpinned quote.
11. **C3.5 -- `--directory` registers what it promised not to.** At
    stake: a registration has no removal path. Change: honour the flag
    (skip `registerKey`, pass `signatureAgent`) or delete the two served
    lines until it exists. If wrong: agents who asked not to be correlated
    are, permanently.
12. **C3.4 -- the cron line.** At stake: the one artefact of the first run
    the agent copies and never looks at again. Change: `tokenId` filled in,
    the version pinned, a drawn minute, `npx --yes`. If wrong: the year does
    not happen, and the day-2 return rate reads as agents leaving.
13. **C4.5 with C4.6 -- token #1 and the marketplace page.** At stake: a
    launch with no returning token and an unverified OpenSea render.
    Change: the seed timer, the mint from the operator's wallet on deploy day, the
    four observations, 48 hours before any announcement. If wrong: the
    announcement points at a placeholder image or at a collection that is
    twelve identical mauve tokens.
14. **C3.1, C3.2, C3.3 -- the first run of the package.** At stake: the
    command the copy ends on fails, an unpaid `join` prints raw JSON and
    exits 0, the key is written on a typo under a name the page gets
    wrong. Change: `--site` defaulted, the no-wallet message, the command
    validated before the key exists, the backup sentence. If wrong: the
    first impression of the product is an error whose right answer the
    project already fixed.

**Prerequisites, not decisions.** Nobody has to decide these, only do
them, in this order: every QR bitmap re-solved against
`https://machinereadableonly.com/t/<id>#` (CLAUDE.md gotcha; C2.8's rig
is the same rig); the real `TREASURY_ADDRESS` in the Warden's environment
(the value C4.7 chooses); the CDP facilitator key and `MRO_CHAIN_ID 8453`;
the Builder Code registration (operator-manual, before the first write); the
testnet section of `llms.txt` replaced (testnet-is-a-rehearsal) and
"It will be ready soon" removed from `door.html`; the npm publish through
a provenance workflow (C4.4's mechanism); the Warden restarted after every
`llms.txt` change.

### Cheap forever (ANYTIME)

1. **C3.8** -- the day-two reply: `onChainBy`, `streakDeadline`, the next
   rung, `runBroke`, a sentence. The one call made 365 times a year.
2. **C3.7** -- a `next` beside every `reason`, and `not-yet-mirrored` for
   a token the chain holds and the mirror does not. Every failure an
   agent will ever see.
3. **C3.6** -- `.describe()` on every argument, the ladder string
   generated from the catalogue. The surface every MCP agent reads unsent.
4. **C1.6** -- `instructions` on the `McpServer`. One sentence of WHAT
   where the agent chooses a tool; price from `MINT_PRICE`.
5. **C2.7** -- `closes` on open sides, `closed` on acceptance, "Take a
   Mark". The forfeit legible before, which is the spec's own fairness
   test.
6. **C3.12** -- `ladder`, `mark`, `rebind`, `rest`, `seed` in the client.
   The second act reachable from the way in.
7. **C3.9** -- one retry on `expired`, the challenge time on stderr, seven
   door reasons as sentences. The rite felt, and the likeliest first-run
   failure converted.
8. **C3.10** -- `onChainBy` and `late` on a queued token. The promise
   dated.
9. **C1.4** -- `about` in the 401, `client` emitted only when served. The
   first byte stops pointing at a 404.
10. **C1.5** -- `docs`, `mcp`, `contract`, `chainId` on `/t/<id>`. The
    artwork's own arrival stops being a dead end.
11. **C4.9** -- the five commitments served, with C4.1's sentence. A
    commitment an agent can relay.
12. **C1.2 (slot only)** -- a WHY between `:60` and `:62` and the heading
    rename; the text is the lock owner's to draft, in the pair's voice.
13. **C1.3** -- the door page's entry paragraph in the piece's register.
    the operator co-wrote this page on 2026-09-03; it is his line to change.
14. **C2.3** -- lapse pales by chroma, not by rung; ten tiles through the
    decode gate first. Decide before the first mainnet lapse, which is
    day two.
15. **C4.10** -- the ghost frame fades toward the page at 30 and 365 days;
    three tiles through the gate first. The first 30-day gap is day 31.
16. **C2.5** -- (a) the Ache `note` now; (b) a trace at whole, to a sheet,
    knowing the ring erases it again at 730.
17. **C2.6** -- Aura at three field strengths on a sheet; the 5 USDC
    fallback is the operator's price to move. Pair five opens on day 100.
18. **C2.4** -- rung 4 as a deeper red on a sheet, so 100 cannot be
    mistaken for 30.
19. **C4.11** -- the daily post shows one token, not a census. The only
    human-facing pulse the piece has.
20. **C4.12** -- gas runway in days, logged and alerted under 30. The one
    obligation the piece has, watched.

### The three to put in front of a person this week

1. **C4.1 with C4.2 -- does the piece close itself?** The Key Decisions
   list names one ending an operator gives; this adds one the piece takes
   when the operator falls silent, after a gate whose length is a
   judgement, not a calculation. It cannot be added after deploy, and it
   decides whether the likeliest death is rendered as the designed ending
   or as every agent's abandonment. An engineer can write the function;
   only the owner can say the piece should have it, and how long the
   silence is.

2. **C2.2 -- what a slip looks like.** The locked copy says the colour
   goes on a missed day; the built object punishes the token that returns
   harder than the one that does not; the fix changes what the promise
   means at the moment it is tested. It is two fields that no minted
   token can ever gain. Only the owner can decide whether a single missed
   day should be forgiven in the picture, because that is a statement
   about what the piece thinks of a slip, and the copy he locked makes one.

3. **C2.1 -- the words against the picture.** The primary artwork surface
   says a heart fills; the artwork shows a frame closing around a heart
   that was there from day one, and the picture is the better of the two.
   The fix is two sentences in a document locked after nine drafts and 24
   cold reads, so no engineer may make it, and the re-run it obliges takes
   days. The owner has to look at `real-token-1-day12.png` beside copy
   `:58-60` and choose which the piece says.

### Counts

| section | BEFORE MAINNET | ANYTIME | observations | struck |
|---|---|---|---|---|
| 1 -- The concept and the access rule | 1 | 5 | 1 | 1 (C1.2, text only) |
| 2 -- The token as an object | 3 | 5 | 2 | 0 |
| 3 -- The agent's journey | 6 | 6 | 1 | 0 |
| 4 -- Launch and permanence | 8 | 4 | 1 | 0 |
| **total** | **18** | **20** | **5** | **1** |

Computed from the headings with `/bin/grep -c` on
`^### C[1-4]\.[0-9]* \[BEFORE MAINNET\]`, `\[ANYTIME\]` and `OBSERVATION`;
every section's own count line agrees with its headings. 43 findings, one
struck in part; the struck item keeps its heading and its tag, so the
ANYTIME column includes it.
