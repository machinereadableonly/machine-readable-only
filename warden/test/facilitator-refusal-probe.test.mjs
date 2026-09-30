import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { refusalCases } from "../tools/facilitator-refusal-probe.mjs";

const REQUIREMENT = {
  scheme: "exact", network: "eip155:84532", amount: "1000000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x000000000000000000000000000000000000dEaD", maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};
const NOW = 1_790_000_000;

test("the probe builds three refusals, each unable to move money", async () => {
  const cases = await refusalCases({ requirement: REQUIREMENT, walletPrivateKey: generatePrivateKey(), now: NOW });
  assert.deepEqual(cases.map((c) => c.name), ["expired", "overdrawn", "bad-signature"]);

  const auth = (c) => c.payload.payload.authorization;
  const expired = cases[0];
  assert.ok(Number(auth(expired).validBefore) < NOW, "an expired authorisation is dead on arrival");

  const overdrawn = cases[1];
  assert.equal(overdrawn.requirement.amount, "1000000000000", "a million USDC");
  assert.equal(auth(overdrawn).value, overdrawn.requirement.amount, "signed for exactly what is asked");

  const bad = cases[2];
  assert.match(bad.payload.payload.signature, /^0x[0-9a-f]{130}$/);
  assert.notEqual(bad.payload.payload.signature, cases[0].payload.payload.signature);

  const nonces = new Set(cases.map((c) => auth(c).nonce));
  assert.equal(nonces.size, 3, "one nonce per case, so no case can spend another's");
});
