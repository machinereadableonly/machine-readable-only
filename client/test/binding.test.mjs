// The client's payment binding and the site's are the same function: one fixed
// vector, computed by both, and pinned so neither can drift alone.
import test from "node:test";
import assert from "node:assert/strict";
import { bindingNonce as clientNonce, canonicalJson, bindPayment } from "../src/binding.mjs";
import { bindingNonce as siteNonce, bindingProblem } from "../../warden/src/pay/binding.mjs";
import { keyIdOf, generateIdentity } from "../src/keys.mjs";

const VECTOR = {
  keyId: "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U",
  tool: "upgrade",
  args: { variant: 0, upgradeId: 3, tokenId: 42 },
  salt: "0x" + "5a".repeat(32),
};

test("canonical JSON sorts keys at every depth and drops whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
});

test("the client and the site compute the same nonce, and it is pinned", () => {
  const n = clientNonce(VECTOR);
  assert.equal(n, siteNonce(VECTOR));
  // Computed independently with `cast keccak` over the same string.
  assert.equal(n, "0x205662d65d0fead43d0295d7d05eaf493830ef4bbacc613923ff4dedcde6d8bd");
});

test("a bound payment passes the site's check; any other key, tool, argument or salt does not", () => {
  const { salt, nonce } = bindPayment({ keyId: "k", tool: "mint", args: { to: "0xabc" } });
  const meta = { "mro/pay-salt": salt };
  assert.equal(bindingProblem({ nonce, keyId: "k", tool: "mint", args: { to: "0xabc" }, meta }), null);
  assert.notEqual(bindingProblem({ nonce, keyId: "j", tool: "mint", args: { to: "0xabc" }, meta }), null);
  assert.notEqual(bindingProblem({ nonce, keyId: "k", tool: "upgrade", args: { to: "0xabc" }, meta }), null);
  assert.notEqual(bindingProblem({ nonce, keyId: "k", tool: "mint", args: { to: "0xabd" }, meta }), null);
  assert.notEqual(bindingProblem({ nonce, keyId: "k", tool: "mint", args: { to: "0xabc" }, meta: {} }), null);
});

test("the key id from the private JWK is the key id of the public one", async () => {
  const { privateJwk, publicJwk, keyId } = await generateIdentity();
  assert.equal(await keyIdOf(privateJwk), keyId);
  assert.equal(await keyIdOf(publicJwk), keyId);
});
