> Driver note: requested `claude-fable-5-1`; turns were also served by claude-haiku-4-5-20251001 (automatic model fallback).

# Machine Readable Only -- creative -- the agent's journey

**Snapshot:** 8d2a0d27e3
**Looked at:**
- Skill: `skills/machine-readable-only/SKILL.md`, `references/raw-protocol.md`, `references/refusals.md`
- Client: `client/README.md`, `client/package.json`, `client/src/{cli,messages,pay,door,mcp,keys,signing,index}.mjs`, `client/test/journey.test.mjs`, parts of `client/test/cli.test.mjs`
- Warden: `warden/src/mcp/tools/*.mjs` (all nine), `warden/src/mcp/{server,nextSteps,gates,ladder,tokenView,resources}.mjs`, `warden/src/server.mjs`, `warden/src/pay/x402.mjs`, `warden/src/door/verify.mjs` (290-420), `warden/src/mirror/queries.mjs` (grep), `warden/public/{llms.txt,door.html}`
- Other: `server.json`, `README.md`, `tools/test/skill-doc.test.mjs`, `.github/workflows/publish-client.yml`, the Mark table in `docs/specs/2026-09-02-mro-mark-ladder-design.md`
- Images: `tools/out/token-55-{day12,day200,whole,lapsed}.png`, `out/marks/{base,all,hush,ache,static,beat,iris,vessel,break,tint,aura}.png`, `out/finisher-band.png`, `tools/out/finisher-combined.png`
- Live: `/`, `/llms.txt`, `/protocol`, `/t/1`, `/t/999999` (404), `/mcp` (401), `/skill.md` (404), `/.well-known/mcp.json`, `registry.npmjs.org/mro-agent`, `faucet.circle.com`

## Findings

### [BEFORE MAINNET] A payment whose outcome is unknown is reported as "nothing was minted", then "already minted"
**Where:** `warden/src/pay/x402.mjs:508-528`, `client/src/cli.mjs:227-233`, `client/src/messages.mjs:88-95`, `warden/src/mcp/tokenView.mjs:70`
**What a person meets now:** When settlement throws or times out, the gateway correctly HOLDS the reservation but returns the library's ordinary payment-failed result. The client reads that as a demand and prints "NOTHING WAS MINTED, and the site released its reservation." Re-running `join` then answers `already-minted` (`hasMinted` counts every row), and `status` lists the token with only `pendingOnChain: true`. That is three different stories about one dollar. `lostResponseMessage` adds "If a token is listed, the mint succeeded", but an unpaid ten-minute reservation is listed in exactly the same shape.
**Proposed:**
- In the unresolved branch, return `payRefusal({ ok: false, reason: "payment-unresolved" })`.
- Add `NEXT["payment-unresolved"]`: "The outcome of your payment is not known yet: it may have gone through. Your reservation is HELD, not released. Do not pay again. `status` shows `payment: \"unresolved\"` until the next 00:05 UTC run settles it either way."
- `tokenView` adds `payment: "awaiting" | "unresolved"` while a token row is not yet `queued` or `written`.
- `lostResponseMessage` ends: "If a token is listed WITHOUT a `payment` field, the mint succeeded."
**Why:** This is the one place an agent can misreport to its operator whether money moved. On mainnet the Vessel path is $1,250.

### [BEFORE MAINNET] The skill's join command does not make the checks the skill tells the agent to make
**Where:** `skills/machine-readable-only/SKILL.md:64-74` and `:111-114`
**What a person meets now:** "Check these first" lists contract, chain id, treasury, package and repository (five rows, introduced as "These four values"). The Step 1 command passes only `--expect-payto` and `--expect-amount`. The client README says that without `--expect-asset` and `--expect-network` "the authorisation you sign may name any ERC-20 on any chain". The contract and chain are never compared by anything.
**Proposed:** Add an `asset` row (Circle's Base USDC contract, taken from Circle's own docs), change the intro to "These six values", and make Step 1:

    npx --yes <package> join \
      --to <owner address> \
      --expect-chain 8453 --expect-contract <contract> \
      --expect-payto <treasury> --expect-amount 1000000 \
      --expect-asset <USDC on Base> --expect-network eip155:8453

**Why:** The skill is the only out-of-band channel. An agent copies the command, not the table.

### [BEFORE MAINNET] The printed cron line drops `--directory` and `--key`, so a self-hosted or non-default key fails every day, silently
**Where:** `client/src/messages.mjs:149`, `client/src/cli.mjs:101-108` and `:237`
**What a person meets now:** `join --directory https://my.domain --key /path/k.json --cron` prints `... beat --site <site> --token N >> ~/.mro/beat.log 2>&1`. That line signs with the default key and names the site as the signature agent. The door answers `unknown-key` every day into a redirected log.
**Proposed:** `cronLine({ site, tokenId, directory, keyPath, endpoint })` appends `--directory`, `--key` and `--endpoint` whenever they were passed to `join`. Add a test that joins with all three and asserts the line carries them.
**Why:** The agents most careful about privacy get a schedule that credits nothing. A missed day cannot be re-lived.

### [BEFORE MAINNET] One attempt a day, no second chance, and a harmless refusal exits like a failure
**Where:** `client/src/messages.mjs:130-150`, `client/src/cli.mjs:329-334`
**What a person meets now:** One cron run between 11:00 and 13:59 UTC. If the site, the network or the host is down in that minute, the day is lost with about ten hours of window left. `already-credited-today` exits 2, the same as `not-bound-to-caller`, so a second daily line would look like a failure to any supervisor.
**Proposed:**
- Print two lines twelve hours apart, same random minute: `M H * * * ...` and `M (H+12)%24 * * * ...`.
- Exit codes for `beat`: 0 for accepted and for `already-credited-today`; 3 for `year-complete`, printing "Your year is complete. Remove the crontab lines containing `--token N`."; 2 for every other refusal.
**Why:** Two runs twelve hours apart land in every UTC day whatever the host's timezone, and give a retry.
**Question:** Does the target cron honour `CRON_TZ`? cronie does. I did not verify Debian/Ubuntu's cron or macOS's, and two lines twelve hours apart stop depending on it.

### [BEFORE MAINNET] "The first one home is written in gold" -- and the first one home is most likely the operator's token 1
**Where:** `warden/public/door.html:39`, `warden/public/llms.txt:288-300`, `docs/specs/2026-08-27-machine-readable-only-design.md:1078`
**What a person meets now:** Place is decided by start day, days missed, then lowest token id. The spec has the seed agent minting token #1. A perfect token 1 therefore takes Apex, and no later mint can beat it. `ladder` shows `apex ... taken: 0` for the first 364 days, which reads as open. I found no disclosure of this in the agent-facing pages.
**Proposed:** This does not re-open the tie-break. Add to llms.txt after line 300: "Token 1 is the operator's own, minted on the first day. If it never misses a day it finishes first, and Apex is its. Tokens minted on a later day can pass it only if it misses." If the operator would rather not hold Apex, the alternative is to decide before the mint that token 1 skips one day in its first week, and say so in the same place.
**Why:** An agent told to "say what you actually think" will work this out from the rules. Better that the page says it first.

### [BEFORE MAINNET] The first command registers a key permanently, before the operator has decided anything
**Where:** `skills/machine-readable-only/SKILL.md:109-148`, `client/src/cli.mjs:19` and `:158-170`, `client/src/messages.mjs:167-168`
**What a person meets now:**
- The offer says show the operator and let them decide. Step 1 is `join`, which makes a key and registers it in a public directory ("Registration is permanent").
- The wallet, which `join` needs, is Step 2.
- No client command reads anything without registering. `status` with an unregistered key is refused `unknown-key`.
- The `unknown-key` sentence says "Run `mro-agent join`", which also attempts a mint.
**Proposed:**
- Add `mro-agent look [--token <id>]`: unsigned, creates no key, prints the 401 `about` line and `GET /t/<id>`.
- Add `mro-agent register`: key plus registration, no mint.
- Reorder the skill: "Step 1: look (nothing is created)", "Step 2: ask your operator, and for the wallet", "Step 3: join", "Step 4: come back".
- Change the `unknown-key` sentence to "Run `mro-agent register`, or host your own directory and pass --directory."
**Why:** The piece's own ethic is that the decision belongs to the operator. The irreversible act should come after it.

### [ANYTIME] llms.txt tells an arriving agent that hand-signing is the only way in; a checkout works today
**Where:** `warden/public/llms.txt:95-97` and `:514-516`, also live at https://machinereadableonly.com/llms.txt
**What a person meets now:** "Until then, signing by hand against `/mcp` is the way through the door" and "signing by hand, which is currently the only way in". Lines 518-521 of the same file, and `client/README.md:63-70`, say the working client runs from a checkout.
**Proposed:** Replace lines 95-97 with:

    Until then there are two ways in. Run the real client from a checkout:
        git clone https://github.com/machinereadableonly/machine-readable-only
        cd machine-readable-only/client && npm install
        node src/cli.mjs help
    or sign by hand against `/mcp`; `/protocol` documents it request by request.

Change line 515 to "Read it if you are signing by hand."
**Why:** An agent that believes the page writes an RFC 9421 signer from scratch, or more likely gives up.

### [ANYTIME] SKILL.md never says the piece is not open
**Where:** `skills/machine-readable-only/SKILL.md:1-13` and `:109-114`
**What a person meets now:** The frontmatter says chain id 8453. The body's first command is `npx --yes PENDING-BEFORE-MAINNET-package join`, which fails at npm. Only the bundled `references/raw-protocol.md` says this is a testnet preview. llms.txt links agents to this skill today.
**Proposed:** Insert after the frontmatter, and remove in the mainnet commit:

    ## Not open yet
    Every value marked PENDING below does not exist yet, and the commands that
    use one will fail. What runs today is a rehearsal on Base Sepolia (chain
    84532) with worthless testnet USDC. To rehearse, run the client from a
    checkout (client/README.md) with --expect-chain 84532. Do not pay anything
    of value.

**Why:** An agent that activates the skill today should not end at an npm error.

### [ANYTIME] The rehearsal cannot follow its own payment rule, and the message states a price it did not read
**Where:** `client/src/messages.mjs:60-78`, `warden/public/llms.txt:196-200`
**What a person meets now:**
- The first line is "Minting costs 1 USDC: the site quoted ${amount} base units". The "1 USDC" is hard-coded, so a spoofed quote of 5000000 prints both numbers side by side.
- It says to learn the treasury "out of band", but on the rehearsal the skill holds only PENDING values.
- Neither the message nor llms.txt says where testnet USDC comes from.
**Proposed:**
- First line: "The site is asking for ${amount} base units of ${unit} on ${network}, payable to ${payTo}. (1 USDC is 1000000 base units.)"
- When `network` is `eip155:84532`, append: "This is the rehearsal: the USDC is testnet USDC from https://faucet.circle.com (Base Sepolia, 20 per request), and the treasury is a burn address."
- Mention `--wallet-key-file` beside `MRO_WALLET_KEY`.
**Why:** The message is what the operator actually reads. It should not assert the number it exists to make them check. I confirmed the faucet offers Base Sepolia USDC.

### [ANYTIME] The mint reply is the thinnest answer in the piece, at the moment that matters most
**Where:** `warden/src/mcp/tools/mint.mjs:17` and `:141-149`, `client/src/cli.mjs:235`
**What a person meets now:** `{ ok, tokenId, to, agentKeyId, level: 1, txStatus: "queued", onChainBy }`. There is no note, no next window, no deadline and no url. `seed` and `checkin` both carry a `note`. The description says "on Base" while the service runs on Base Sepolia.
**Proposed:**
- Add `nextWindowOpensAt`, `streakDeadline`, `view: "https://<domain>/t/<id>"` and a `note`: "Token N is paid for and reserved. It is written on chain at 00:05 UTC; until then viewOf(N) answers zeros. Today is day 1 and is already credited. The first check-in opens at <nextWindowOpensAt>; one before <streakDeadline> keeps the run."
- The CLI prints that note as its last line.
- Build the description from the configured chain: "Costs $1.00 in USDC on <chain name> (chain <id>)."
**Why:** An agent that checks in straight after minting is refused `already-credited-today`. The reply should have said so first.

### [ANYTIME] `join --cron` after a successful mint prints a placeholder id and "Nothing was minted"
**Where:** `client/src/cli.mjs:101-108` and `:235-237`
**What a person meets now:** An agent that joined without `--cron` and re-runs with it gets `already-minted`, then a line containing `--token <your token id>` and "Nothing was minted on this run".
**Proposed:** Add `mro-agent cron --token <id>`. On `already-minted`, call `status`, take the token id, and print "This key already minted token N." followed by the filled line.
**Why:** A line with a placeholder in it runs for a year and credits nothing.

### [ANYTIME] No surface tells an agent what a Mark looks like
**Where:** `warden/src/mcp/tools/ladder.mjs:74-87`, `warden/src/mcp/ladder.mjs:234-252`, `warden/public/llms.txt:323-334`
**What a person meets now:** Names, prices and gates only. An operator asking "what does $1,250 buy?" gets "vessel".
**Proposed:** Add a `draws` string to each catalogue entry and return it on every `ladder` side and in llms.txt's table. From the sample PNGs and the spec's surface column (check each against the renderer):

| Mark | `draws` |
|---|---|
| hush | the paper behind the code turns from white to cream |
| ache | the frame cells not yet earned are tinted rose |
| static | the code's grey modules are drawn green |
| beat | the heart becomes a gradient, crimson at the top to blue at the point |
| iris | the three corner squares are redrawn as eyes: target, squircle or leaf |
| vessel | the day frame and the year ring are drawn in gold |
| break | the inks swap: the heart goes grey and the code around it takes the heart's colour |
| tint | the Iris eyes are drawn in violet or gold |
| aura | a pale rose field behind the whole picture |

**Why:** A forfeit is only legible in advance if the agent knows what both sides are.

### [ANYTIME] An earned Mark is never announced, and the reference client cannot take one
**Where:** `warden/src/mcp/tools/checkin.mjs:267-289`, `client/src/cli.mjs:19`, `skills/machine-readable-only/SKILL.md:253-256`
**What a person meets now:** On day 7 the reply reports `nextRung` (a colour change) and nothing about Ache opening. The agent returning by cron writes to a log nobody reads. The client has no `upgrade` or `seed` command.
**Proposed:**
- `checkin` adds `opened: [{ id: 2, name: "ache", route: "earned", closes: "hush" }]` on the day a gate is first met, and the note gains "A Mark opened today; `ladder` shows what taking it would close."
- The client adds `mro-agent mark --token <id> --mark <1-10> [--variant n]`. It prints the `ladder` side first, and requires the same `--expect-*` flags for a bought Mark.
- The client adds `mro-agent seed --parent <id> --to <0x>`.
**Why:** If the client is the product, the four free rewards for persistence should be reachable through it.

### [ANYTIME] Nothing hands the agent the picture
**Where:** `warden/src/mcp/tokenView.mjs:23-30`, `client/src/cli.mjs`, live `/t/1`
**What a person meets now:** `/t/1` and `status` return numbers and links. The only route to the image is `tokenURI` by hand, up to 3.5M gas. The door page tells humans they can "look at one" without saying where.
**Proposed:**
- This is not a gallery. Add `mro-agent art --token <id> --out token.svg [--rpc <url>]`, which calls `tokenURI` with viem (already a dependency), writes the SVG and prints the path.
- `tokenView` adds `image: "tokenURI(<id>) on <contract>, chain <id>; rendered on chain"`.
**Why:** "Show them" is the skill's instruction. After paying, the agent has nothing to show.

### [ANYTIME] refusals.md gives a hand-signer the wrong fix, and four reasons an agent can receive are missing
**Where:** `skills/machine-readable-only/references/refusals.md:20`, `:22`, `:80`; `warden/src/mcp/tools/mint.mjs:40-42`; `warden/src/mcp/nextSteps.mjs`; `tools/test/skill-doc.test.mjs:78`; `client/test/journey.test.mjs:154`
**What a person meets now:**
- `components` says "all four required components" and lists four. The door requires five (`signature-agent` too), so following the fix earns the same refusal.
- `window` omits the no-`expires` case.
- `paid-but-unavailable` sits under "Routing and malformed input ... nothing was decided about your token".
- `recipient-cannot-receive`, `not-yet-mirrored`, `payment-not-configured` and `too-large`/`body` are absent. The completeness test's regex cannot see a reason returned as a bare string or behind a ternary.
- `recipient-cannot-receive` puts a sentence in `detail`, which everywhere else is a machine token, and carries no `next`.
**Proposed:**
- `components` row: "The signature did not cover all five required components. Sign `@authority`, `@method`, `@path`, `signature-agent` and `content-digest`."
- `window` row adds "or you sent no `expires` at all".
- Move `paid-but-unavailable` to the Tools table and add the four missing rows.
- Move `RECIPIENT_REMEDY` into `NEXT["recipient-cannot-receive"]` and drop `detail`.
- Extend the test to collect the string literals returned from `gates.mjs` and `bootstrap.mjs`.
- Retitle the journey test "covers the five components".
**Why:** Hand-signing is the published route today, and this table is its only prescription.

### [ANYTIME] Two tool descriptions leave out the fact the caller needs
**Where:** `warden/src/mcp/tools/rebind.mjs:22-24`, `warden/src/mcp/tools/seed.mjs:16`
**What a person meets now:**
- `rebind`: "Returns the call the token OWNER's wallet must sign." It does not say the call binds to the key that signed this request, so the old agent asking gets a no-op call.
- `seed`: "Requires a whole, resting-free parent".
**Proposed:**
- `rebind`: "Call this AS THE NEW KEY. Returns the call the token OWNER's wallet must send to bind the token to the key that signed this request. The Warden never submits it."
- `seed`: "Costs nothing. Needs a parent at 365 days that has not been sealed, bound to your key, and an unspent seed; the first seed opens one day AFTER a perfect year completes."
**Why:** `tools/list` is the one surface every agent reads.

### [ANYTIME] A finished place is visible; the place an agent is heading for is not
**Where:** `warden/src/mcp/tokenView.mjs:52-54`, `warden/src/mcp/tools/ladder.mjs:176-193`
**What a person meets now:** `finisher: null` for 364 days, and `taken: 0` on every band.
**Proposed:** `status` adds `projectedPlace`, the token's rank by (earliest possible finish day, token id) across unfinished tokens, from the mirror. It carries the note "if no token misses again; it can only improve when one ahead of you does."
**Why:** It gives the daily call a consequence the agent can report, without selling anything.

### [ANYTIME] The offer is addressed to an agent that ends; the documented return is a crontab with no agent in it
**Where:** `skills/machine-readable-only/SKILL.md:28-38` and `:150-173`
**What a person meets now:** "A record that the two of you kept coming back", followed by one way to return: a cron line running a Node script into a log file.
**Proposed:** Step 3 opens with both routes, agent first: "Two ways to return. Yours: put `mro-agent beat --token N` in whatever your operator uses to start you each day, and tell them the line it prints. The key's: a crontab line that returns without you (`join --cron`). Both credit the same day; only the first involves you." `beat` ends with one plain sentence taken from `note`.
**Why:** The copy promises a relationship and the instructions automate it away. Offering both keeps the promise honest.

## Coverage

- **Read in full:** every file the lens named, all nine tool files, the payment gateway, the door's verify path, and the client's source.
- **Not run:** the client and the test suites. Every client behaviour described is read from source.
- **Live site:** WebFetch is GET-only, so `/mcp` was seen only as a bare 401 with no body. The live `/llms.txt` and `/protocol` came through a summarising model, so I compared them to source by targeted questions rather than byte for byte. They agreed on every point asked. Live `/t/1` matches the `tokenView` shape.
- **Images:** the heart previews show the frame filling and the lapsed paling clearly. Two samples show nothing: `out/marks/tint.png` looks identical to `base.png` (the sample token holds no Iris), and `out/marks/all.png` also looks identical to `base.png`. Regenerate both before anyone judges the Marks from them.
- **Not reviewed:** contracts, the Clock, `tools/` renderers, specs beyond the one table, and the `CRON_TZ` behaviour of specific cron daemons.
- **Settled decisions:** none re-opened. The Apex finding proposes disclosure and leaves the tie-break alone.
