// Does Coinbase's CDP facilitator actually accept our Bearer token?
//
//   node --env-file=.env tools/cdp-live-check.mjs
//
// test/cdp.test.mjs proves the token is a well-formed EdDSA JWT with the right
// claims, verified against the public half of the signing key. It cannot prove
// that CDP accepts it -- only CDP can say that, and until it does, "mainnet
// payment works" is an assumption. This is the counterpart to
// tools/x402-live-check.mjs, which does the same job for the testnet host.
//
// IT SETTLES NOTHING AND COSTS NOTHING. The only call made is /supported, which
// is a read; CDP's own pricing page says verification is always free and only
// onchain settlement is metered (1,000 a month at $0.00, then $0.001). No
// payment is created, verified or settled here.
//
// What it prints, and why each line is worth having:
//   - whether the token was ACCEPTED (a 401 is the whole failure this exists
//     to catch, and it is invisible on testnet because that host takes no key)
//   - the networks and schemes mainnet actually offers, read from the host
//     rather than from documentation, so `eip155:8453` + `exact` is confirmed
//     against the thing that will be asked to settle
import { makeCdpAuthHeaders, isCdpFacilitator } from "../src/pay/cdp.mjs";

const url = process.env.X402_FACILITATOR_URL ?? "https://api.cdp.coinbase.com/platform/v2/x402";
const keyId = process.env.CDP_API_KEY_ID;
const secret = process.env.CDP_API_KEY_SECRET;

if (!isCdpFacilitator(url)) {
  console.error(`not a CDP facilitator: ${url}`);
  console.error("this check is only meaningful against Coinbase's host, which is the one that needs a key");
  process.exit(2);
}
if (!keyId || !secret) {
  console.error("set CDP_API_KEY_ID and CDP_API_KEY_SECRET (they are what is being tested)");
  process.exit(2);
}

const headers = await makeCdpAuthHeaders({ keyId, secret, facilitatorUrl: url })();

// The key id is printed in a TRUNCATED form and the secret never is. This
// output is the kind of thing that gets pasted into a note.
console.log(`facilitator : ${url}`);
console.log(`key id      : ${keyId.slice(0, 12)}...`);

const res = await fetch(`${url.replace(/\/+$/, "")}/supported`, { headers: headers.supported });
const body = await res.text();

console.log(`GET /supported -> ${res.status} ${res.statusText}`);

if (res.status === 401 || res.status === 403) {
  console.error("\nREFUSED. No agent could pay on mainnet with these credentials.");
  console.error(body.slice(0, 400));
  console.error(
    "\nThe token SHAPE is not the likely cause: it is transcribed from @coinbase/cdp-sdk's own\n" +
      "generateJwt and pinned against it in test/cdp.test.mjs. Measured 2026-09-05, Coinbase's own\n" +
      "generator was refused by this host with the same key -- which points at the CREDENTIAL:\n" +
      "wrong project, never activated, revoked, or without x402 access. Check it in the CDP portal.\n" +
      "To re-confirm that reading, generate a token with their SDK and send it yourself. If theirs\n" +
      "is refused too, nothing in this repository is at fault."
  );
  process.exit(1);
}
if (!res.ok) {
  console.error(`\nUnexpected status. This is not necessarily an auth failure:\n${body.slice(0, 400)}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  console.error(`\nAccepted, but the body is not JSON:\n${body.slice(0, 400)}`);
  process.exit(1);
}

console.log("\nACCEPTED. The token is good and the host answered.\n");
const kinds = parsed.kinds ?? [];
console.log(`kinds offered: ${kinds.length}`);
for (const k of kinds) console.log(`  ${k.network}  ${k.scheme}`);

// The one combination this piece needs. Named explicitly rather than left for a
// reader to spot in the list.
const BASE_MAINNET = "eip155:8453";
const wanted = kinds.some((k) => k.network === BASE_MAINNET && k.scheme === "exact");
console.log(
  `\n${BASE_MAINNET} + exact: ${wanted ? "OFFERED -- this is the pair the piece settles on" : "NOT OFFERED -- mainnet payment cannot work against this host"}`
);
process.exit(wanted ? 0 : 1);
