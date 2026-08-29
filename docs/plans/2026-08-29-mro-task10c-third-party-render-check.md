# Task 10c: the third-party render check, and closing the decode blind spot

Written 2026-08-29, after the operator stopped Task 11 a second time: "We are not ready
for mainnet. First we test on testnet. We need to make sure everything works
before we spend real money."

Status: APPROVED by the operator 2026-08-29 ("Use placeholder" for the domain question).

Phase 1 is complete and changed the shape of the task -- it found a real defect
in the solver rather than merely closing a blind spot. the operator chose **option A** from
`docs/2026-08-29-mro-fragile-mask-finding.md`: select the code by robustness
first, heart match second. Option C's intrinsic SVG pixel size was NOT chosen and
is not being built; step 3 below is therefore superseded and step 4 reduces to
re-running the sweep against the new selection.

---

## Why this exists

Task 11 was written on one premise: OpenSea has no testnet, so the only way to
learn how a third party displays this token is to pay for a mainnet deploy.

**That premise was checked today and it is half wrong.**

OpenSea's own farewell notice (23 July 2025) gives their reason for dropping
testnets, and one of the three reasons they list is that *"blockchain explorers
now support basic NFT features"*. OpenSea is not the only party that takes a
`tokenURI`, parses the JSON, and rasterises an on-chain SVG into a PNG it
chooses the dimensions of. At least two others do exactly that, both run on
Base Sepolia, and both are free:

- **Alchemy's NFT API** caches NFT media through a Cloudinary CDN, generates a
  256x256 thumbnail, exposes arbitrary resizes (`w_400,h_400`), and offers a
  `/convert-png` path that flattens an SVG. Base Sepolia is a supported network.
- **Basescan** renders the NFT image on its token page, from the same verified
  contract we already have deployed.

Neither *is* OpenSea. But the specific failure mode this project is exposed to
is not an OpenSea quirk -- it is **"a rasteriser we do not control picks its own
pixel size"**, which is exactly what sweep D found on token 12. Any third-party
flattener probes that. Getting two of them to agree, for free, before spending,
is the right order.

Alongside that, the research turned up a genuine blind spot in our own suite and
one probable root cause we can fix outright. Both are cheap.

### What is already covered, honestly

| Sweep | What it covered | Result |
|---|---|---|
| A | 88 colour boundary pairs, Solidity vs JS | clean |
| B | 32-state differential, byte-for-byte | clean |
| C | 80 decodes offline + 8 extremes x 5 sizes | found the palette bug, now clean |
| D | 26 states on Base Sepolia, 5 sizes each | 25/26 |

That is real coverage and it earned its keep. What follows is what it still
cannot see.

### What is genuinely left, and who can answer it

**Only mainnet can answer:** does OpenSea itself display the token, and does the
ERC-4906 event plus a refresh call actually update its cached image. Confirmed
live today: `testnets.opensea.io` 307-redirects to a shutdown notice. There is
no preview path for a contract-deployed NFT. Task 11 remains necessary.

**Testnet or offline can answer everything below, and none of it has been done.**

1. **Our decode sweep tops out at 900px, and the bug it caught lived at 1200px.**
   `DECODE_SIZES` is `[250, 350, 500, 700, 900]`. Sweep C diagnosed the palette
   bug by going to 1600px by hand, but the standing regression sweep never
   followed it up there. Nothing in either test suite decodes above 900px today.
   **The sweep that found the bug cannot currently see it come back.** This is
   the single most important gap on the list and it costs minutes.

2. **The SVG declares no pixel size.** Both renderers emit
   `<svg viewBox="0 0 c c" shape-rendering="crispEdges">` with no `width` or
   `height`. That hands the choice of raster size to whatever consumes it --
   which is the precise condition that made token 12 fail at 700px. The canvas
   is not even a fixed number of cells; it grows with year rings:

   | Years | Canvas | At a fixed 500px | At a fixed 1080px |
   |---|---|---|---|
   | 0 | 51 | 9.80 px/cell | 21.18 px/cell |
   | 1 | 53 | 9.43 | 20.38 |
   | 5 | 69 | 7.25 | 15.65 |
   | 10 | 89 | 5.62 | 12.13 |

   Every one of those is fractional. A third party that picks a round number
   lands on a fractional ratio for essentially every token. Declaring
   `width = height = canvas * K` makes the SVG's own intrinsic size an exact
   multiple, which is the one lever we hold over rasterisers we do not own.
   Whether a given consumer honours it is the open question -- and step 4 is how
   we find out without paying.

3. **State and bitmap have never been crossed.** The offline sweep renders every
   state with token 1's bitmap. The on-chain sweep gives each of 26 bitmaps a
   single state. Each token has its own QArt solve, so module layout differs per
   token -- that is exactly how token 12 slipped through -- and the interaction
   of "unusual state" with "unusual bitmap" is untested in both directions.

4. **No third party has ever parsed this token.** Every decode to date has run
   through our own resvg + ZXing pipeline, against an SVG we rendered. Nobody
   else's JSON parser, base64 decoder, SVG rasteriser or CDN has touched it.

5. **A hard external limit exists and we had not found it.** Alchemy's NFT API
   documents that a `tokenURI` response over **30,000 bytes** returns a broken
   token URI error. Our worst case is 10,066 bytes, so we pass -- but this is the
   first real third-party number anyone has produced for this project, and it
   belongs in the budget table next to the 20,000-byte self-imposed limit.

6. **The payload is not realistic.** Every bitmap ever solved uses
   `example.com` and token ids 1-26. The real domain changes the payload length,
   which changes the QArt solve, the heart match rate and potentially the decode
   margin. A longer domain is not a cosmetic difference.

7. **`Pulse`'s `animation_url` is still unbudgeted and unbuilt.** Two of the
   seven Marks do not draw. This is a build gap carried since Task 7 and it is
   the operator's call whether it belongs in Phase 0.

---

## The plan

Three phases. Nothing here spends real money, and nothing is irreversible.
Phase 1 is offline. Phase 2 uses Base Sepolia, where the deployer already holds
**0.050 ETH** against a measured run cost of 0.0000356 ETH -- roughly 1,400 runs
of headroom, so no faucet trip is needed.

### Phase 1 -- close the blind spot and control the raster (offline, free)

1. **Extend the decode sweep above 900px.** Add 1100, 1200, 1400 and 1600 to
   `DECODE_SIZES` in `tools/state-matrix.mjs`, and run the extremes batch. Run
   it in batches through `~/scripts/safe-build.sh`, per the memory rule -- this
   is exactly the shape of sweep that took the box down on 2026-08-28.
   *Expected:* clean, because the palette fix was verified at 1600px by hand
   during diagnosis. If it is not clean, that is a finding and I stop and report
   rather than fix it silently.

2. **Cross state against bitmap.** Extend the offline sweep to render each state
   against several distinct token bitmaps rather than only token 1's, at the
   sizes third parties actually pick (256, 500, 1000, 1080) as well as our exact
   multiples. Report the failure rate as a fraction, the way sweep D did.

3. **Give the SVG an intrinsic pixel size.** Emit
   `width="{canvas*K}" height="{canvas*K}"` from both renderers, K chosen so the
   result sits in a sensible range (K=20 gives 1020px at year zero, 1780px at
   the cap). Measure the cost in bytes and gas -- expected to be about 30 bytes
   and a few thousand gas, but it gets measured, not assumed. Re-run the
   differential and the full suite; both renderers must stay byte-for-byte
   identical.

4. **Re-run steps 1 and 2 against the sized SVG** and state plainly whether the
   fractional-resonance failures disappear. This is the measurement that decides
   whether step 3 was worth its bytes.

### Phase 2 -- put it in front of third parties (Base Sepolia, free)

5. **Deploy a fresh soak contract to Base Sepolia** carrying the current palette
   and the sized SVG, with the same 26 states, and **without applying sunset** --
   the existing soak contract `0xfd8A...2190` was sunset at the end of Task 10b,
   so every token on it is frozen and no longer shows its true state.

6. **Drive Alchemy's NFT API against it.** For all 26 tokens: fetch the
   metadata, confirm the JSON parses and the attributes survive, then pull the
   Cloudinary-cached image at the 256px thumbnail, at `/convert-png`, and at
   several explicit resizes. Rasterise nothing ourselves -- take *their* PNG,
   and run ZXing on it, checking each token decodes to its own URL. This is the
   nearest available analogue to what OpenSea does, and it is the whole point of
   the phase. Poll rather than read once; a cache that has not warmed is not a
   failure.

7. **Check Basescan's rendering** of the same contract as a second, independent
   consumer. Capture what it produces and decode it the same way.

8. **Exercise ERC-4906 end to end.** Change a token's state, emit the event,
   and confirm the indexer's cached image actually changes -- polling, because a
   read straight after a write returned stale state on Sepolia during Task 10b.
   This rehearses the exact sequence Task 11 has to get right on OpenSea, where
   a mistake costs a redeploy.

9. **Record the 30,000-byte Alchemy limit** in `docs/phase0-results.md` beside
   the existing budget table.

### Phase 3 -- the two open decisions (no spend, the operator's call)

10. **Re-solve QArt at a realistic payload.** Pick a plausible real domain
    length and 4-5 digit token ids, re-solve, and report the heart match rate
    and decode margin against the `example.com` baseline. If the match rate
    falls materially, that is a design input, not a bug -- and better known now
    than after mainnet.

11. **Bring `Pulse`'s `animation_url` to the operator as a decision** with a measured
    byte and gas cost for the cheapest workable version, rather than leaving it
    on the open list for a fourth task running.

12. **Then, and only then, Task 11.** Unchanged, still requiring explicit
    approval and a freshly measured cost on the day.

---

## Trade-offs, stated up front

- **This delays Task 11 by roughly a session.** That is the cost. The return is
  that the eight-cent mainnet deploy gets to answer one question instead of
  discovering three, and a redeploy caused by a bug we could have caught costs
  more than the delay does.
- **Step 3 changes the shipped image bytes.** It is a real change to a settled
  artefact, so it is measured and put in front of the operator before it stands. If the
  measurement says it does not help, it comes back out.
- **None of this proves OpenSea works.** Two third parties agreeing raises
  confidence; it does not substitute for Task 11. I will not claim otherwise in
  the results.
- **Nothing here is irreversible.** No real funds, no mainnet, no deletions.

## operator-manual steps

After completing any operator-only step, tell Claude so it can update memory
immediately.

- **None in Phase 1 or 2.** The Sepolia key, RPC URL and Etherscan key are in
  place and funded; Alchemy's NFT API uses the same key already in the secrets
  file, read by script and never printed.
- **Phase 3, step 10** needs one input from the operator: the domain to solve against, or
  a confirmed placeholder length if the domain is still undecided.
- **Task 11** keeps both existing gates: the two secrets, and explicit approval
  for the mainnet spend.

## Sources checked today

- OpenSea, *Farewell testnets* -- <https://support.opensea.io/en/articles/11833955-farewell-testnets>
  (confirmed live: `testnets.opensea.io` 307-redirects here; ended 23 July 2025)
- OpenSea metadata standards -- <https://docs.opensea.io/docs/metadata-standards>
- Alchemy NFT API FAQ, image caching, `/convert-png`, the 30,000-byte limit --
  <https://www.alchemy.com/docs/reference/nft-api-faq>
- Alchemy NFT API, Base Sepolia among supported networks --
  <https://www.alchemy.com/docs/reference/nft-api-endpoints/nft-api-endpoints/nft-metadata-endpoints/get-nft-metadata-v-3>
- ERC-4906 -- <https://eips.ethereum.org/EIPS/eip-4906>
- MetaMask mobile does not render base64 data-URI NFT images; closed as not
  planned -- <https://github.com/MetaMask/metamask-mobile/issues/6200>
  (recorded as a known consumer limitation, not something this plan fixes)
