# The third-party raster finding

Task 10c Phase 2, 2026-08-29. Measured against Alchemy's NFT API on Base
Sepolia.

## The short version

Three findings, in descending order of how much they matter.

1. **The ERC-4906 refresh did not happen.** A state change that the chain
   confirms, with the event emitted correctly after the write, left Alchemy's
   cached metadata frozen for at least 35 minutes -- through polling,
   `refreshCache=true` twice, and `invalidateContract`. For a piece whose whole
   subject is an image that changes as the agent returns, this is the serious
   one. No contract change fixes it; the gap is on the consumer side.
2. **Declaring an intrinsic SVG size cuts third-party decode failures from 54%
   to 3.6%**, measured as a controlled A/B between two live contracts that
   differ in nothing else. It costs about 1,600 gas and 32 bytes.
3. **The artwork was never at fault.** Our renderer at the identical pixel width
   decoded in 55 of 56 cases where theirs failed 30 times. The difference is
   that their CDN interpolates and ours does not.

## What was measured, first pass

Against `0xfd8AaAc531b02fCA9Df5dDdAa97a78fF2b102190` -- the sweep D soak
contract, which carries the current palette but pre-robust-solve bitmaps. The
numbers in this section are that older contract; the A/B further down re-runs
everything on fresh contracts with current bitmaps and is the one to quote.

Seven token bitmaps (ids 1, 2, 3, 5, 8, 12, 13), each fetched from Alchemy at
ten URLs: the two the API advertises, and eight widths constructed from the
documented Cloudinary transform. Every image was decoded with ZXing through the
same oracle the whole suite uses -- `scanPixels`, a new entry point into
`tools/test/helpers/decode.mjs`, not a second copy of the rules.

| URL | What it is | Renders at | Grey levels | Decoded |
|---|---|---|---|---|
| `thumbnailUrl` | advertised by the API | 250px | 3 | 7 / 7 |
| `pngUrl` (`convert-png`) | advertised by the API | 53-57px | 3 | 7 / 7 |
| `w_NNN/scaled` | constructed per the FAQ | 256-1600px | 170-205 | 33 / 56 |

Per token, failures out of eight constructed widths:

| Token | Failures | Which widths |
|---|---|---|
| 1 | 8 | all of them |
| 2 | 3 | 1000, 1080, 1600 |
| 3 | 3 | 1000, 1080, 1600 |
| 5 | 7 | all but 700 |
| 8 | 1 | 256 |
| 12 | 0 | -- |
| 13 | 1 | 1080 |

**23 of 56 constructed resizes failed: 41%.** The control column -- our own
renderer at the same width, decoded the same way -- failed once in 56, and that
one case (token 12 at 700px) is the known pre-robust-solve fragile bitmap that
this contract still carries.

## The mechanism

The grey-level count is the tell. The artwork is duotone on white, so a crisp
rasterisation of it holds **3** distinct grey levels. Every constructed resize
came back holding **170 to 205**.

That is interpolation. Alchemy's CDN rasterises the SVG once at its intrinsic
size and then scales that bitmap to the requested width, smoothing as it goes.
Module edges soften into gradients, and a binarizer that has to place a
threshold between "dark" and "light" loses modules that are now halfway between.
Our renderer is asked for the width directly, rasterises the vectors at that
width, and every module edge stays a hard step -- 3 levels, and it decodes.

The two advertised URLs escape this because Cloudinary rasterises those from the
vectors rather than resampling a bitmap: both come back at 3 grey levels.

## The part that touches settled ground

`pngUrl` renders at **53px** -- and 57px for a token with a year ring. That is
the canvas in viewBox units, one pixel per cell, because **our SVG declares no
intrinsic width or height**. The consumer is not choosing 53px; it is falling
back to our units in the absence of a size.

Phase 1 considered declaring `width` and `height` (option C) and did not build
it, on the reasoning that it "only helps consumers that honour it". This is a
measured instance of a real consumer honouring it: Cloudinary derives both its
PNG dimensions and its upscale factor from that intrinsic size. Declaring
`width = canvas * K` would mean their single rasterisation happens at K times
the resolution before any smoothing is applied.

**That reasoning is not proof.** Whether it actually fixes the constructed
resizes can only be settled by deploying a sized SVG and re-running this exact
sweep. It is free to do so on Sepolia. It is not being done unilaterally,
because it changes the shipped image bytes and it reverses a decision already
made.

## THE A/B, AND IT SETTLES IT

Run 2026-08-29 after the above. Two contracts were deployed to Base Sepolia
carrying the **same twenty-six states and the same bitmaps**, differing only in
whether the SVG declares `width`/`height`. `RendererSized.t.sol` pins that the
two images are otherwise byte-identical, so a decode difference can only come
from the intrinsic size.

| | address |
|---|---|
| `Renderer` (plain) | `0xf63d235B178faEdFcf7cba64632e330bcE94554c` |
| `RendererSized` | `0x8db8a6d5cb6BFE2F868c6D50936C20F0aF336aD6` |
| token, plain | `0x12C641d5C15DeEc21D71912973Bd8f63967b9bF6` |
| token, sized | `0x12c82BCE6f64f797358031Caae3c9652bD5Bd209` |

Seven bitmaps x eight constructed widths, decoded off Alchemy's own PNG:

| Build | Failures | Rate | `pngUrl` renders at |
|---|---|---|---|
| unsized (shipped today) | 30 / 56 | **54%** | 53px |
| sized, `canvas * 16` | 2 / 56 | **3.6%** | 848px |

The two residuals are token 3 at 700px and 850px. Their grey-level counts fall
from 170-208 to 143-174 as well: the CDN still interpolates, but it is now
downscaling an 848px raster instead of upscaling a 53px one, and a downscale of
a crisp source loses far less.

`pngUrl` moving from 53px to 848px is the second win, and arguably the larger
one: that is the URL a consumer is handed, and 53px was never going to survive
being stretched into a display card.

### What it costs

Measured over RPC on the two live contracts:

| Token | Plain | Sized | Delta |
|---|---|---|---|
| 1, day one | 1,410,174 gas / 8,850 B | 1,411,606 / 8,882 | +1,432 gas, +32 B |
| 16, ten years | 1,501,957 / 9,431 | 1,501,259 / 9,467 | -698 gas, +36 B |
| 21, level 364 worst case | 1,631,616 / 8,892 | 1,633,224 / 8,924 | +1,608 gas, +32 B |

About 1,600 gas and 32 bytes. The worst case moves to 1,633,224 gas and 8,924
bytes, leaving 366,776 gas and 11,076 bytes inside the hard limit. The negative
delta on token 16 is optimiser noise, not a saving.

## ERC-4906: THE REFRESH DID NOT HAPPEN

Rehearsed 2026-08-29 on the plain contract, and this is the most serious thing
in this document.

Token 1 was warmed in Alchemy's cache at Level 365, then moved on chain to Level
300 by `setState`, which emits `MetadataUpdate(1)` **after** the write. The chain
was confirmed to have changed: a direct `tokenURI` read returns Level 300,
Streak 77, and still decodes to its own url.

Alchemy did not update. Measured:

- **35 minutes of polling** without a refresh flag: Level 365 throughout, and
  still stale when this was written; a poller is still running.
- **`refreshCache=true`**, twice, ten minutes apart: Level 365.
- **`invalidateContract`**, then four more minutes of polling: Level 365.
- `timeLastUpdated` stayed frozen at `2026-08-29T12:38:35.181Z` -- the moment of
  the pre-write read. It is not re-reading at all, rather than re-reading and
  getting a stale answer.

A longer poll is running; the catch-up time, if it comes, lands in
`tools/out/erc4906-watch.log`.

**Why this matters more here than for most NFTs.** This piece is defined as a
living record of return visits -- the image is supposed to change as the agent
comes back. An indexer that caches the first render and will not re-read it
displays a token frozen at day one. The ERC-4906 event is emitted correctly and
in the right order; the gap is on the consumer side, and no contract change
fixes it.

**Stated honestly:** this is one token, one indexer, over about 35 minutes.
It is not proof that Alchemy never refreshes. It is proof that the event plus
both documented refresh mechanisms did not produce an update in that window,
which is enough to stop anyone assuming the refresh path works.

## How much this matters

An honest reading of the severity, in both directions:

- **The URLs a marketplace is handed all work.** `thumbnailUrl` and `pngUrl` are
  what the NFT API returns; a consumer that displays what it is given displays a
  decodable code. Nothing here shows a wallet or marketplace failing.
- **`w_NNN/scaled` is developer-constructed**, documented in Alchemy's FAQ as a
  thing you can build, not a field they return. Nobody is obliged to use it.
- **But 53px is what `pngUrl` hands over**, and any consumer that scales that up
  for display -- a browser stretching a 53px image into a 400px card -- applies
  exactly the same smoothing client-side, where we cannot measure it.

## Two operational findings, both worth keeping

1. **A cold token returns no CDN copy at all.** The first read of a token that
   Alchemy has never ingested comes back with `cachedUrl` set to our raw `data:`
   URI and `thumbnailUrl`, `pngUrl`, `contentType` and `size` all `null`.
   `refreshCache=true` starts the ingest, and the ingest is **asynchronous** --
   three of five tokens in an early probe still had no image seconds later.
   `metadataWithImage` polls for it. Reading once and reporting "no image" would
   have been wrong, the same trap as reading a tokenURI straight after a write.
2. **Alchemy's documented 30,000-byte tokenURI limit is not close.** Our worst
   case is 10,066 bytes and Alchemy stored these SVGs at 7,818 to 8,302 bytes.
   This is the first third-party number this project has.

## Basescan

Inconclusive, stated as such. The server-rendered HTML for the token page
carries `/images/main/nft-placeholder.svg` rather than the artwork. That is not
proof it never renders -- the media may load client-side -- and this VPS has no
browser to settle it. Not claimed either way.

## Sources

- Alchemy NFT API FAQ, image caching, `convert-png`, `w_NNN/scaled`, the
  30,000-byte limit -- <https://www.alchemy.com/docs/reference/nft-api-faq>
- getNFTMetadata v3, `refreshCache` -- <https://www.alchemy.com/docs/reference/nft-api-endpoints/nft-api-endpoints/nft-metadata-endpoints/get-nft-metadata-v-3>
- Refresh NFT metadata / `invalidateContract` -- <https://www.alchemy.com/support/how-can-i-update-the-nfts-metadata-using-alchemy-s-nft-api>
