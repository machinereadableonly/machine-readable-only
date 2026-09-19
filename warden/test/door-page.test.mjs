// The door page carries the Base Dashboard ownership tag.
//
// Base verifies that an app owns its domain by fetching the homepage and
// looking for `<meta name="base:app_id" content="<id>">` in the <head>. The
// homepage is public/door.html, which main.mjs reads once at startup, so the
// tag has to be in THIS file -- not merely somewhere in the repository. The id
// is a public identifier, published in the page by design; it is not a secret.
//
// The static-route tests serve a stub page, so nothing else reads the real
// file's head. This does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Issued by the Base Dashboard (dashboard.base.org) on 2026-09-12. If Base
// issues a new id on re-registration, change it here and in door.html together.
const BASE_APP_ID = "6a9f0b233fc122c236410831";

const html = readFileSync(new URL("../public/door.html", import.meta.url), "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";

test("the door page has a head", () => {
  assert.ok(head.length > 0, "no <head> element found in public/door.html");
});

test("the head carries the Base app id tag, exactly once, with the issued id", () => {
  const tags = [...head.matchAll(/<meta\s+name="base:app_id"\s+content="([^"]*)"\s*\/?>/gi)];
  assert.equal(tags.length, 1, `expected one base:app_id tag in <head>, found ${tags.length}`);
  assert.equal(tags[0][1], BASE_APP_ID);
});

// -----------------------------------------------------------------------
// WHAT A PERSON IS TOLD BEFORE THEY FUND AN AGENT
//
// Added 2026-09-19 from the outside-in probe. The page had no explorer link,
// no repository link, and nothing about who runs the piece or where a payment
// lands -- so an operator deciding whether to let an agent spend up to
// $1,250 had nowhere on this site to look.
//
// This is disclosure, NOT a gallery: no token is rendered here, and the
// decision against a human-facing gallery is untouched.
// -----------------------------------------------------------------------

test("the door page says who runs the piece and how to reach them", () => {
  assert.match(html, /github\.com\/machinereadableonly\/machine-readable-only/, "the repository");
  assert.match(html, /\/issues/, "and a way to raise something");
});

test("it links the contract on an explorer that publishes the source", () => {
  assert.match(html, /basescan\.org\/address\/0x5bAC4E9B/i);
  assert.match(html, /blockscout\.com\/address\/0x5bAC4E9B/i);
});

test("it says where the money goes, and that testnet USDC is worth nothing", () => {
  assert.match(html, /treasury/i);
  assert.match(html, /worth\s+nothing/i);
});

test("the OpenSea link is MAINNET, and is marked as not yet real", () => {
  // OpenSea retired its testnet environment with OS2: measured 2026-09-19,
  // opensea.io/assets/base-sepolia/<contract>/1 answers 404 while the mainnet
  // path answers 200. A testnet link would point at nothing, which is exactly
  // the /client.mjs failure this project already made once.
  assert.doesNotMatch(html, /opensea\.io[^"]*base-sepolia/i, "never a testnet OpenSea link");
  assert.match(html, /opensea\.io\/assets\/base\/PENDING-BEFORE-MAINNET-contract/);
  // And it must not claim the artwork is known to render there. CLAUDE.md:
  // "OpenSea is UNVERIFIED and must never be described otherwise."
  assert.match(html, /never been tested/i, "the page must not imply OpenSea rendering is proven");
});

test("no token is rendered on the page", () => {
  // The gallery decision, pinned. An <img> or an inline <svg> here would
  // quietly reopen it.
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<svg\b/i);
});
