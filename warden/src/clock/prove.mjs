// Before the Clock signs a row, it proves the row from evidence the shared
// database cannot forge: the agent's own signed request (re-verified here), the
// chain's binding of the token to that key, and for a paid row the settlement
// transaction's receipt. Treasury, domain and prices come from the Clock's own
// configuration and code, never from the row.
import { createHash } from "node:crypto";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { parseDictionary } from "structured-headers";
import { decodeEventLog } from "viem";
import { extractPaymentFromMeta } from "@x402/mcp";
import { getDefaultAsset } from "@x402/evm";
import { contentDigest, coveredComponents, REQUIRED, MAX_WINDOW_MS, MAX_SKEW_MS } from "../door/verify.mjs";
import { BOUND_COMPONENTS } from "../door/middleware.mjs";
import { keyIdOf } from "../door/directory.mjs";
import { keyIdToBytes32 } from "../mcp/keyId.mjs";
import { LADDER } from "../mcp/ladder.mjs";
import { answerIndex } from "../mcp/question.mjs";
import { MINT_PRICE, authorizationOf } from "../pay/x402.mjs";
import { DAY_MS } from "../day.mjs";
import { AUTHORIZATION_USED, TRANSFER } from "./unresolved.mjs";
import { MRO_ABI } from "./abi.mjs";
import { safeErrorText } from "./redact.mjs";
import { qrProblem } from "./qr.mjs";

const PARAMS_MARKER = '"@signature-params": ';
const lower = (v) => String(v ?? "").toLowerCase();
const refuse = (why) => ({ ok: false, why });

/// "$1.00" -> 1000000n, the USDC base units x402 charges for that demand.
export function priceUnits(price) {
  const m = /^\$(\d+)\.(\d{2})$/.exec(price);
  if (!m) throw new Error(`not a two-decimal dollar price: ${price}`);
  return BigInt(m[1]) * 1_000_000n + BigInt(m[2]) * 10_000n;
}

/**
 * Re-verify one stored signed request, exactly as the door did, and return what
 * it asked for. Refuses anything the door would have refused, and anything not
 * addressed to `domain` or not a call of `tool`.
 */
export async function verifyEvidence(evidence, { domain, tool }) {
  if (!evidence || typeof evidence.base !== "string" || typeof evidence.signature !== "string" ||
      typeof evidence.body !== "string" || !evidence.jwk) {
    return refuse("no signed request is stored for it");
  }
  const lines = evidence.base.split("\n");
  const paramsLine = lines.pop();
  if (!paramsLine?.startsWith(PARAMS_MARKER)) return refuse("its stored request has no signature parameters");
  const fields = new Map();
  for (const line of lines) {
    const m = /^"([^"]+)"((?:;[^:]*)?): (.*)$/.exec(line);
    if (!m || fields.has(m[1])) return refuse("its stored request base is malformed");
    fields.set(m[1], m[3]);
  }
  const covered = coveredComponents(evidence.base);
  if (!covered || ![...REQUIRED, ...BOUND_COMPONENTS].every((c) => covered.includes(c))) {
    return refuse("its stored request does not cover every required component");
  }
  if (fields.get("@authority") !== domain) return refuse(`its stored request was signed for ${fields.get("@authority")}, not ${domain}`);
  if (fields.get("@method") !== "POST" || fields.get("@path") !== "/mcp") return refuse("its stored request is not a POST to /mcp");

  let params;
  try {
    params = parseDictionary("sig=" + paramsLine.slice(PARAMS_MARKER.length)).get("sig")[1];
  } catch {
    return refuse("its stored signature parameters do not parse");
  }
  const keyId = params.get("keyid");
  const created = params.get("created");
  const expires = params.get("expires");
  if (params.get("tag") !== "web-bot-auth" || typeof keyId !== "string" ||
      !Number.isInteger(created) || !Number.isInteger(expires) ||
      (expires - created) * 1000 > MAX_WINDOW_MS || expires < created) {
    return refuse("its stored signature parameters are not ones the door admits");
  }
  if ((await keyIdOf(evidence.jwk)) !== keyId) return refuse("its stored key does not hash to the signed key id");
  try {
    const verify = await verifierFromJWK(evidence.jwk);
    await verify(evidence.base, Buffer.from(evidence.signature, "base64"), {});
  } catch {
    return refuse("its stored signature does not verify");
  }

  const body = Buffer.from(evidence.body, "base64");
  if (fields.get("content-digest") !== contentDigest(body)) return refuse("its stored body is not the one that was signed");
  let call;
  try {
    call = JSON.parse(body.toString("utf8"));
  } catch {
    return refuse("its stored body is not JSON");
  }
  if (call?.method !== "tools/call" || call.params?.name !== tool) return refuse(`its stored request is not a ${tool} call`);
  return {
    ok: true,
    keyId,
    args: call.params.arguments ?? {},
    meta: call.params._meta ?? null,
    // A request reaches the door between created - skew and expires, so the
    // day the Warden stamped is one of these.
    firstDay: Math.floor((created * 1000 - MAX_SKEW_MS) / DAY_MS),
    lastDay: Math.floor((expires * 1000) / DAY_MS),
    hash: createHash("sha256").update(evidence.base, "utf8").digest("hex"),
  };
}

const inDays = (v, day) => day >= v.firstDay && day <= v.lastDay;

/**
 * The settlement of `auth` in `txHash`: an AuthorizationUsed for its payer and
 * nonce, immediately followed in the same receipt by the Transfer it caused,
 * of exactly `units` from the payer to the treasury. Returns the transfer's
 * position, which the ledger keys on.
 */
export async function provePayment({ publicClient, txHash, auth, asset, treasury, units }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) return refuse("no settlement transaction is recorded for it");
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    return refuse(`its settlement receipt could not be read (${safeErrorText(err)})`);
  }
  if (receipt?.status !== "success") return refuse("its settlement transaction did not succeed");
  const decode = (log, event) => {
    if (lower(log?.address) !== lower(asset)) return null;
    try {
      return decodeEventLog({ abi: [event], data: log.data, topics: log.topics }).args;
    } catch {
      return null;
    }
  };
  for (const log of receipt.logs ?? []) {
    const used = decode(log, AUTHORIZATION_USED);
    if (!used || lower(used.authorizer) !== lower(auth.from) || lower(used.nonce) !== lower(auth.nonce)) continue;
    const next = receipt.logs.find((l) => l.logIndex === log.logIndex + 1);
    const moved = decode(next, TRANSFER);
    if (moved && lower(moved.from) === lower(auth.from) && lower(moved.to) === lower(treasury) && moved.value === units) {
      return { ok: true, payment: { txHash, logIndex: next.logIndex } };
    }
  }
  return refuse("its settlement transaction moved no matching payment to the treasury");
}

/**
 * The prover the Clock runs every row through. Each method returns
 * `{ ok: true, ... }` once the row is proven AND its proofs are claimed in the
 * ledger, or `{ ok: false, why }`.
 *
 * `written(tokenId)` is called once a proven mint or seed has landed, so a
 * credit or Mark for that token is proven against the key the Clock just wrote
 * rather than a read straight after the write, which a public RPC may not have
 * caught up with.
 */
export function makeProver({ q, publicClient, contract, chainId, domain, treasury, houseKeyId = null, ledger, bank = null }) {
  for (const [name, value] of Object.entries({ domain, treasury, ledger, contract })) {
    if (!value) throw new Error(`the prover needs ${name}`);
  }
  const asset = getDefaultAsset(`eip155:${chainId}`).asset;
  const bankById = new Map((bank ?? []).map((b) => [b.id, b]));
  const provenKeys = new Map();
  const writtenKeys = new Map();
  const bound = new Map();

  /// The chain's key for a token as bytes32, or null when it cannot be read.
  async function boundKey(tokenId) {
    if (writtenKeys.has(tokenId)) return writtenKeys.get(tokenId);
    if (!bound.has(tokenId)) {
      bound.set(tokenId, publicClient
        .readContract({ address: contract, abi: MRO_ABI, functionName: "viewOf", args: [BigInt(tokenId)] })
        .then((view) => lower(view.agentKeyId))
        .catch(() => null));
    }
    return bound.get(tokenId);
  }

  async function signedBy(tokenId, keyId) {
    const onChain = await boundKey(tokenId);
    if (onChain === null) return "the chain's key for its token could not be read";
    return onChain === lower(keyIdToBytes32(keyId)) ? null : "it was not signed by the key the chain binds to its token";
  }

  async function paid(row, v, tool, price) {
    const auth = authorizationOf(extractPaymentFromMeta({ name: tool, arguments: v.args, _meta: v.meta }));
    if (!auth) return refuse("its signed request carries no payment authorisation");
    if (lower(auth.to) !== lower(treasury)) return refuse("its signed payment is not to the treasury");
    if (BigInt(auth.value ?? -1) !== price) return refuse(`its signed payment is not ${price} units`);
    if (lower(auth.nonce) !== lower(row.payNonce)) return refuse("its signed payment is not the one recorded for it");
    return provePayment({ publicClient, txHash: row.paymentTx, auth, asset, treasury, units: price });
  }

  const claim = (kind, ref, proofs) => ledger.claim(kind, ref, proofs);

  return {
    written(tokenId) {
      if (provenKeys.has(tokenId)) writtenKeys.set(tokenId, provenKeys.get(tokenId));
    },

    async mint(row) {
      const v = await verifyEvidence(q.evidenceFor("mint", row.tokenId), { domain, tool: "mint" });
      if (!v.ok) return v;
      if (v.keyId !== row.agentKeyId || v.keyId !== row.keyId) return refuse("its signed request is from a different key");
      if (lower(v.args.to) !== lower(row.toAddress)) return refuse("its signed request names a different recipient");
      if (!inDays(v, row.day)) return refuse("its day is not the day it was signed");
      if (row.tokenId === 1 && v.keyId !== houseKeyId) return refuse("token 1 is the house token and this is not the house key");
      const badQr = qrProblem(row.qr, { domain, tokenId: row.tokenId });
      if (badQr) return refuse(badQr);
      const money = await paid(row, v, "mint", priceUnits(MINT_PRICE));
      if (!money.ok) return money;
      const claimed = claim("mint", row.tokenId, { requestHash: v.hash, payment: money.payment, mintKey: v.keyId });
      if (claimed.ok) provenKeys.set(row.tokenId, lower(keyIdToBytes32(v.keyId)));
      return claimed;
    },

    async seed(row) {
      const v = await verifyEvidence(q.evidenceFor("seed", row.tokenId), { domain, tool: "seed" });
      if (!v.ok) return v;
      if (v.keyId !== row.agentKeyId) return refuse("its signed request is from a different key");
      if (Number(v.args.parentId) !== Number(row.parentId)) return refuse("its signed request names a different parent");
      const wrongKey = await signedBy(row.parentId, v.keyId);
      if (wrongKey) return refuse(wrongKey);
      if (lower(v.args.to) !== lower(row.toAddress)) return refuse("its signed request names a different recipient");
      if (!inDays(v, row.day)) return refuse("its day is not the day it was signed");
      const badQr = qrProblem(row.qr, { domain, tokenId: row.tokenId });
      if (badQr) return refuse(badQr);
      const claimed = claim("seed", row.tokenId, { requestHash: v.hash });
      if (claimed.ok) provenKeys.set(row.tokenId, lower(keyIdToBytes32(v.keyId)));
      return claimed;
    },

    /// Also returns the answer the agent signed, as an index, or null.
    async credit(row) {
      const v = await verifyEvidence(q.evidenceFor("credit", `${row.tokenId}:${row.day}`), { domain, tool: "checkin" });
      if (!v.ok) return v;
      if (Number(v.args.tokenId) !== Number(row.tokenId)) return refuse("its signed request names a different token");
      if (!inDays(v, row.day)) return refuse("its day is not the day it was signed");
      const wrongKey = await signedBy(row.tokenId, v.keyId);
      if (wrongKey) return refuse(wrongKey);
      const claimed = claim("credit", `${row.tokenId}:${row.day}`, { requestHash: v.hash });
      if (!claimed.ok) return claimed;
      const entry = row.questionId === null ? null : bankById.get(row.questionId);
      const signed = entry && v.args.answer !== undefined ? answerIndex(entry, v.args.answer) : null;
      return { ok: true, answer: signed !== null && signed === row.answer ? signed : null };
    },

    async mark(row) {
      const ref = `${row.tokenId}:${row.upgradeId}`;
      const v = await verifyEvidence(q.evidenceFor("mark", ref), { domain, tool: "upgrade" });
      if (!v.ok) return v;
      if (Number(v.args.tokenId) !== Number(row.tokenId) || Number(v.args.upgradeId) !== Number(row.upgradeId) ||
          Number(v.args.variant ?? 0) !== Number(row.variant)) {
        return refuse("its signed request names a different Mark");
      }
      const wrongKey = await signedBy(row.tokenId, v.keyId);
      if (wrongKey) return refuse(wrongKey);
      const mark = LADDER[row.upgradeId];
      if (!mark || mark.route === "finisher") return refuse("it is not a Mark an agent can take");
      let payment = null;
      if (mark.route === "bought") {
        const money = await paid(row, v, "upgrade", BigInt(mark.priceUsdc6));
        if (!money.ok) return money;
        payment = money.payment;
      }
      return claim("mark", ref, { requestHash: v.hash, payment });
    },
  };
}
