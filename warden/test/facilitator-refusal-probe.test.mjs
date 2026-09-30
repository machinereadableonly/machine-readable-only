import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
// The same types the client signer uses, from the same package, so a recovery
// here cannot pass by disagreeing with how the authorisation was signed.
import { authorizationTypes } from "@x402/evm";
import { refusalCases } from "../tools/facilitator-refusal-probe.mjs";

const REQUIREMENT = {
  scheme: "exact", network: "eip155:84532", amount: "1000000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x000000000000000000000000000000000000dEaD", maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};
const NOW = 1_790_000_000;

function signerOf(kase) {
  const a = kase.payload.payload.authorization;
  return recoverTypedDataAddress({
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization",
    domain: {
      name: kase.requirement.extra.name,
      version: kase.requirement.extra.version,
      chainId: Number(String(kase.requirement.network).split(":")[1]),
      verifyingContract: kase.requirement.asset,
    },
    message: {
      ...a,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
    },
    signature: kase.payload.payload.signature,
  });
}

test("the probe builds three refusals, each unable to move money", async () => {
  const walletPrivateKey = generatePrivateKey();
  const wallet = privateKeyToAccount(walletPrivateKey).address;
  const cases = await refusalCases({ requirement: REQUIREMENT, walletPrivateKey, now: NOW });
  assert.deepEqual(cases.map((c) => c.name), ["expired", "overdrawn", "bad-signature"]);

  const auth = (c) => c.payload.payload.authorization;
  const expired = cases[0];
  assert.ok(Number(auth(expired).validBefore) < NOW, "an expired authorisation is dead on arrival");

  const overdrawn = cases[1];
  assert.equal(overdrawn.requirement.amount, "1000000000000", "a million USDC");
  assert.equal(auth(overdrawn).value, overdrawn.requirement.amount, "signed for exactly what is asked");

  const bad = cases[2];
  assert.match(bad.payload.payload.signature, /^0x[0-9a-f]{130}$/);
  // The CONTROL first: an untouched signature recovers to the wallet, so a
  // failed recovery below is the tampering and not a broken recovery here.
  assert.equal(await signerOf(expired), wallet, "an untouched authorisation recovers to its signer");
  assert.notEqual(await signerOf(bad), wallet, "a tampered authorisation must not recover to the wallet");

  const nonces = new Set(cases.map((c) => auth(c).nonce));
  assert.equal(nonces.size, 3, "one nonce per case, so no case can spend another's");
});
