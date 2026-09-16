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
