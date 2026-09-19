// The repository is a conformant Agent Plugin, and stays one.
//
// Agent Plugins 1.0.0 (agent-plugins.org, published 2026-08-06; core
// maintainers from Amazon, Cursor, Microsoft, OpenAI and Vercel) defines a
// package FORMAT loaded from a directory path. It deliberately says nothing
// about distribution -- no HTTP fetch, no registry -- which is why the
// 2026-09-16 probe's ask to SERVE this at /plugin/ was declined: it would
// advertise a convention no spec defines and no client is known to fetch.
// What the spec does define, this file asserts.
//
// The manifest schema is CLOSED: "If plugin.json contains any other top-level
// field, it does not conform to the schema." So an extra field is a defect
// even though clients are told to ignore it, and that is what makes this test
// worth having -- nothing else in the repo would notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("plugin.json", root), "utf8"));

/// Every field the 1.0.0 schema permits at the root, and nothing else.
const ALLOWED = new Set([
  "$schema", "name", "version", "description",
  "author", "homepage", "repository", "license", "keywords", "extensions",
]);

test("plugin.json carries both required fields, with the right schema url", () => {
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length >= 1 && manifest.name.length <= 64);
});

test("the manifest has no field the closed schema forbids", () => {
  const extra = Object.keys(manifest).filter((k) => !ALLOWED.has(k));
  assert.deepEqual(extra, [], "a top-level field outside the 1.0.0 schema");
});

test("the plugin name obeys the spec's naming rule", () => {
  // Lowercase alphanumeric plus hyphens and periods, alphanumeric at both
  // ends, no consecutive hyphens or periods.
  assert.match(manifest.name, /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
  assert.ok(!manifest.name.includes("--"), "no consecutive hyphens");
  assert.ok(!manifest.name.includes(".."), "no consecutive periods");
});

test("a skill is discoverable where the spec looks for it", () => {
  // Fixed discovery location: skills/<name>/SKILL.md. This is the whole reason
  // the repository is one file from being a plugin -- the layout was already
  // right.
  assert.ok(
    existsSync(new URL("skills/machine-readable-only/SKILL.md", root)),
    "skills/<name>/SKILL.md is where a client looks; without it the plugin has no components"
  );
});

test("the author carries no personal identifier", () => {
  // The project-only GitHub account is package identity, which the identifier
  // rules permit; a real name or mailbox here would not be.
  const blob = JSON.stringify(manifest.author ?? {});
  assert.ok(!blob.includes("@") || blob.includes("github.com"), "no email address in the manifest");
});
