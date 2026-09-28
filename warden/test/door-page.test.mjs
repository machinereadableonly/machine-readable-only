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

// The page carries two plain links a person can check without an agent: where
// the source lives and where the contract is verified. Everything else a
// payer needs is in llms.txt.

test("the door page links the source repository", () => {
  assert.match(html, /github\.com\/machinereadableonly\/machine-readable-only/);
});

// The live address is the first one llms.txt names -- the same rule
// adopt-deployment.sh reads it by -- so a redeploy that rewrites llms.txt and
// misses this page goes red here.
const llms = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
const liveContract = llms.match(/0x[0-9a-fA-F]{40}/)?.[0];

test("it links the LIVE contract on an explorer that publishes the source", () => {
  assert.ok(liveContract, "llms.txt names no contract");
  assert.ok(html.includes(`basescan.org/address/${liveContract}`), `Basescan link is not ${liveContract}`);
  assert.ok(html.includes(`blockscout.com/address/${liveContract}`), `Blockscout link is not ${liveContract}`);
  const others = [...html.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0]).filter((a) => a !== liveContract);
  assert.deepEqual(others, [], "the page names an address that is not the live contract");
});

test("llms.txt names the rehearsal treasury", () => {
  assert.match(llms, /treasury[\s\S]{0,200}0x000000000000000000000000000000000000dEaD/i);
});

test("the page never links a testnet OpenSea url", () => {
  // OpenSea has no testnet environment since OS2, so such a link points at
  // nothing. CLAUDE.md: OpenSea is UNVERIFIED and must never be described otherwise.
  assert.doesNotMatch(html, /opensea\.io[^"]*base-sepolia/i);
});

test("no token is rendered on the page", () => {
  // The gallery decision, pinned. An <img> or an inline <svg> here would
  // quietly reopen it.
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<svg\b/i);
});
