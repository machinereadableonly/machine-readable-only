// Seed a SCRATCH mirror for the mainnet-fork rehearsal's Clock steps. TEST-ONLY.
//
//   node tools/mainnet-fork-clock.mjs key-id      --token <id>
//   node tools/mainnet-fork-clock.mjs seed-mint   --db <path> --token <id> --to <addr> --domain <d> --rpc <fork> --treasury <addr>
//   node tools/mainnet-fork-clock.mjs seed-credit --db <path> --token <id> --domain <d> --rpc <fork>
//   node tools/mainnet-fork-clock.mjs seed-mark   --db <path> --token <id> --mark <1-10> --domain <d> --rpc <fork> --treasury <addr>
//
// Called by tools/mainnet-fork-rehearsal.sh, which then runs the REAL Clock
// entrypoint (src/clock/main.mjs) against a local fork of Base mainnet.
//
// Every row is seeded the way production makes it, so the real Clock proves it:
// the same mirror calls the tools make, the signed request the door would
// store beside the row, and for a paid row a real USDC transferWithAuthorization
// settled ON THE FORK (the payer is funded through USDC's own minter role,
// impersonated on the fork). Requests are signed at the fork's time, because the
// Clock checks a row's day against when it was signed.
//
// Token N's agent key is derived from N, so `key-id --token 1` names the house
// key the rehearsal's Clock is told about.
//
// SCRATCH ONLY. It refuses any database that is not inside a rehearsal work
// directory -- never the Warden's mirror, never the fast copy's.
import { basename, dirname, resolve } from "node:path";
import { createHash, createPrivateKey, randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, http, parseAbi, parseSignature, numberToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getDefaultAsset } from "@x402/evm";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { contentDigest } from "../src/door/verify.mjs";
import { keyIdOf } from "../src/door/directory.mjs";
import { LADDER } from "../src/mcp/ladder.mjs";
import { robustSolveFor } from "../../tools/robust-solve.mjs";
import { packModules } from "../../tools/qart.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i]?.startsWith("--")) throw new Error(`expected a --flag, got ${rest[i]}`);
  args[rest[i].slice(2)] = rest[i + 1];
}
const need = (name) => {
  if (args[name] === undefined) throw new Error(`--${name} is required for ${command}`);
  return args[name];
};
const tokenId = Number(need("token"));

/// Token N's Ed25519 key, the same on every run.
function keyFor(id) {
  const seed = createHash("sha256").update(`mro-mainnet-rehearsal-key-${id}`).digest();
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const jwk = createPrivateKey({ key: der, format: "der", type: "pkcs8" }).export({ format: "jwk" });
  return { jwk, pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x } };
}

if (command === "key-id") {
  console.log(await keyIdOf(keyFor(tokenId).pub));
  process.exit(0);
}

const dbPath = resolve(args.db ?? "");
if (!basename(dirname(dbPath)).startsWith("mro-mainnet-rehearsal.")) {
  throw new Error(`refusing ${dbPath}: seeded rows belong only in a mro-mainnet-rehearsal.* work directory`);
}
const q = queries(openDb(dbPath));
const rpc = need("rpc");
const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
const forkNow = async () => Number((await publicClient.getBlock()).timestamp);
const forkDay = async () => Math.floor((await forkNow()) / 86_400);

/// The signed request the door would store for this tools/call, signed at the fork's time.
async function evidenceFor(id, tool, toolArgs, meta = null) {
  const { jwk, pub } = keyFor(id);
  const domain = need("domain");
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: tool, arguments: toolArgs, ...(meta ? { _meta: meta } : {}) },
  });
  const inner = await signerFromJWK(jwk);
  let base = null;
  const signer = { ...inner, keyid: inner.keyid, alg: inner.alg, sign: async (data) => { base = data; return inner.sign(data); } };
  const message = {
    method: "POST",
    url: `https://${domain}/mcp`,
    headers: {
      "signature-agent": `"https://${domain}"`,
      "content-digest": contentDigest(body),
      challenge: "rehearsal",
      "challenge-response": "rehearsal",
    },
  };
  const created = new Date((await forkNow()) * 1000);
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + 60_000),
    components: ["@authority", "@method", "@path", "signature-agent", "content-digest", "challenge", "challenge-response"],
  });
  const signature = /^[^=]+=:([^:]+):$/.exec(headers.Signature ?? headers.signature)?.[1];
  if (!base || !signature) throw new Error("could not capture the signed base");
  return { evidence: { base, signature, jwk: pub, body: Buffer.from(body).toString("base64") }, keyId: inner.keyid };
}

const USDC_ABI = parseAbi([
  "function masterMinter() view returns (address)",
  "function configureMinter(address minter, uint256 allowance) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

/// Pay `units` of USDC to the treasury on the fork, the way a facilitator settles x402.
async function settleOnFork(units) {
  const usdc = getDefaultAsset("eip155:8453").asset;
  // A fresh payer every time: anvil's public test accounts carry EIP-7702
  // delegations on Base mainnet, and USDC checks a delegated account's
  // signature through its code instead.
  const payer = privateKeyToAccount(generatePrivateKey());
  const treasury = need("treasury");
  const wallet = createWalletClient({ chain: base, transport: http(rpc) });
  const read = (functionName) => publicClient.readContract({ address: usdc, abi: USDC_ABI, functionName });
  const masterMinter = await read("masterMinter");
  await publicClient.request({ method: "anvil_impersonateAccount", params: [masterMinter] });
  for (const who of [masterMinter, payer.address]) {
    await publicClient.request({ method: "anvil_setBalance", params: [who, numberToHex(10n ** 18n)] });
  }
  const wait = (hash) => publicClient.waitForTransactionReceipt({ hash });
  await wait(await wallet.writeContract({ account: masterMinter, address: usdc, abi: USDC_ABI, functionName: "configureMinter", args: [payer.address, units] }));
  await wait(await wallet.writeContract({ account: payer, address: usdc, abi: USDC_ABI, functionName: "mint", args: [payer.address, units] }));

  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const validBefore = BigInt((await forkNow()) + 3600);
  const signature = await payer.signTypedData({
    domain: { name: await read("name"), version: await read("version"), chainId: 8453, verifyingContract: usdc },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: payer.address, to: treasury, value: units, validAfter: 0n, validBefore, nonce },
  });
  const { v, r, s } = parseSignature(signature);
  const receipt = await wait(await wallet.writeContract({
    account: payer, address: usdc, abi: USDC_ABI, functionName: "transferWithAuthorization",
    args: [payer.address, treasury, units, 0n, validBefore, nonce, Number(v), r, s],
  }));
  if (receipt.status !== "success") throw new Error("the fork refused the USDC settlement");
  const meta = {
    "x402/payment": {
      x402Version: 2, scheme: "exact", network: "eip155:8453",
      payload: {
        signature,
        authorization: {
          from: payer.address, to: treasury, value: String(units),
          validAfter: "0", validBefore: String(validBefore), nonce,
        },
      },
    },
  };
  return { meta, nonce, txHash: receipt.transactionHash };
}

if (command === "seed-mint") {
  const to = need("to");
  const day = await forkDay();
  const paid = await settleOnFork(1_000_000n);
  const { evidence, keyId } = await evidenceFor(tokenId, "mint", { to }, paid.meta);
  q.transact(() => {
    q.insertMint({ tokenId, toAddress: to, keyId, payNonce: paid.nonce });
    q.putEvidence("mint", tokenId, evidence);
    q.insertToken({ tokenId, keyId, owner: to, lastDay: day, mintDay: day });
    q.setTokenAwaitingPayment(tokenId);
  });
  const moved = q.settleByNonce(paid.nonce, paid.txHash);
  if (moved?.kind !== "mint" || moved.tokenId !== tokenId) {
    throw new Error(`settlement did not promote mint ${tokenId}: ${JSON.stringify(moved)}`);
  }

  const solved = robustSolveFor(need("domain"), tokenId);
  q.completeSolve(tokenId, Buffer.from(packModules(solved.modules, solved.size)).toString("hex"));

  const pending = q.pendingMints().map((m) => m.tokenId);
  if (!pending.includes(tokenId)) throw new Error(`mint ${tokenId} is not pending after seeding: ${JSON.stringify(pending)}`);
  console.log(`seeded paid mint ${tokenId} for ${to} on day ${day}, settled on the fork in ${paid.txHash}; pending: ${pending.join(",")}`);
} else if (command === "seed-credit") {
  const day = await forkDay();
  const { evidence } = await evidenceFor(tokenId, "checkin", { tokenId });
  q.transact(() => {
    q.insertCredit(tokenId, day, "mainnet-rehearsal");
    q.putEvidence("credit", `${tokenId}:${day}`, evidence);
  });
  console.log(`seeded a check-in for token ${tokenId} on day ${day}`);
} else if (command === "seed-mark") {
  const mark = Number(need("mark"));
  const toolArgs = { tokenId, upgradeId: mark, variant: 0 };
  if (LADDER[mark]?.route === "bought") {
    const paid = await settleOnFork(BigInt(LADDER[mark].priceUsdc6));
    const { evidence } = await evidenceFor(tokenId, "upgrade", toolArgs, paid.meta);
    if (!q.reserveMarkPaid(tokenId, mark, 0, paid.nonce, Date.now(), evidence)) throw new Error(`mark ${mark} was not reserved for token ${tokenId}`);
    if (q.settleByNonce(paid.nonce, paid.txHash)?.kind !== "mark") throw new Error(`settlement did not promote mark ${mark}`);
  } else {
    const { evidence } = await evidenceFor(tokenId, "upgrade", toolArgs);
    if (!q.reserveMark(tokenId, mark, 0, evidence)) throw new Error(`mark ${mark} was not reserved for token ${tokenId}`);
  }
  console.log(`seeded Mark ${mark} for token ${tokenId}`);
} else {
  throw new Error(`unknown command ${command}: key-id | seed-mint | seed-credit | seed-mark`);
}
