import { test } from "node:test";
import assert from "node:assert/strict";
import { makeChallengeTool } from "../src/mcp/tools/challenge.mjs";

test("the challenge tool returns a challenge, an expiry, and where to use it", async () => {
  const tool = makeChallengeTool({ challengeSecret: "s3cr3t", domain: "example.test" });
  const r = await tool.handler({}, {});
  assert.equal(typeof r.challenge, "string");
  assert.equal(typeof r.expires, "string");
  assert.equal(r.mcp, "https://example.test/mcp");
  assert.equal(r.docs, "https://example.test/llms.txt");
});

test("two successive calls return different challenges", async () => {
  const tool = makeChallengeTool({ challengeSecret: "s3cr3t", domain: "example.test" });
  const r1 = await tool.handler({}, {});
  const r2 = await tool.handler({}, {});
  assert.notEqual(r1.challenge, r2.challenge);
});
