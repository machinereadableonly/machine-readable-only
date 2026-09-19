// Paying, and refusing to.
//
// THE ONE THING TO UNDERSTAND ABOUT THIS FILE. Signing an EIP-3009
// authorisation is safe in a narrow, precise sense: it authorises ONE transfer
// of ONE amount to ONE address, and leaves no allowance behind. It is not safe
// in the sense of "the amount and the address are correct" -- those come out
// of the server's own 402 response, and a server that has been replaced or
// spoofed simply quotes a different address.
//
// So `assertExpected` is not optional politeness. It is the whole security
// boundary on the money path, and `payFor` refuses to sign without it.
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationTypes } from "@x402/evm";

/// Where an x402 payment authorisation travels on an MCP call.
export const PAYMENT_META_KEY = "x402/payment";
/// Where the receipt comes back.
export const PAYMENT_RESPONSE_META_KEY = "x402/payment-response";

/**
 * The payment demand inside an MCP tool result, or null if there is none.
 *
 * `isError` FIRST, exactly as the official x402 client does it. A result
 * without it is not a demand no matter what its body contains, and this
 * ordering is not pedantry: a server that double-wraps its refusal produces a
 * result whose body still looks like a demand while `isError` has been buried
 * one level down, and a client that pattern-matched the body instead would
 * "find" a demand the reference client cannot see. Match the reference
 * implementation, not the bytes.
 */
export function readDemand(result) {
  if (!result?.isError) return null;
  const fromObject = (o) => (o && Array.isArray(o.accepts) && o.accepts.length ? o : null);

  const direct = fromObject(result.structuredContent);
  if (direct) return direct;

  const first = result.content?.[0];
  if (first?.type !== "text") return null;
  try {
    return fromObject(JSON.parse(first.text));
  } catch {
    return null;
  }
}

/**
 * Refuse a demand that is not the one you were told to expect.
 *
 * `expected` must come from your operator, out of band. Not from this page,
 * not from the site's documentation, and not from the response itself -- those
 * all arrive over the same wire as the demand does, so they are not a second
 * source.
 *
 * Every field given in `expected` is compared; anything omitted is not
 * checked, and omitting `payTo` is refused outright because it is the field
 * that decides who receives the money.
 */
/// The longest this client will ever sign an authorisation for, and the
/// default when a demand names no window at all.
export const MAX_AUTHORISATION_SECONDS = 600;
export const DEFAULT_AUTHORISATION_SECONDS = 300;

/**
 * Pick the offered requirement that matches what you expect.
 *
 * WHY THIS EXISTS. `accepts` is a LIST, and the client read `accepts[0]` and
 * compared that one against the expectation. An honest site offering mainnet
 * first and the chain you asked for second was refused; a hostile one could
 * put an attractive entry first and keep the real terms out of reach. Reading
 * the whole list and refusing when none matches is both more permissive to
 * honest sites and stricter about what gets signed.
 *
 * The expectation is still checked in full by assertExpected: this only
 * decides WHICH entry that check is applied to.
 */
export function chooseAccepted(accepts, expected) {
  const list = Array.isArray(accepts) ? accepts : [];
  if (!list.length) throw new Error("refusing to pay: the demand offered no payment requirements");

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const fields = ["payTo", "amount", "asset", "network"].filter((f) => expected?.[f] !== undefined);
  const match = list.find((one) => fields.every((f) => same(one?.[f], expected[f])));
  if (match) return match;

  // ONE OFFER THAT DOES NOT MATCH IS HANDED BACK, NOT REFUSED HERE. There is
  // no ambiguity about which entry was meant, and assertExpected's complaint
  // names the field that is wrong ("payTo is X, expected Y") where anything
  // this function could say would be vaguer. It is refused either way; the
  // difference is whether the operator is told WHAT is wrong.
  if (list.length === 1) return list[0];

  throw new Error(
    `refusing to pay: none of the ${list.length} offered requirement(s) matches what you expected ` +
      `(${fields.map((f) => `${f}=${expected[f]}`).join(", ")})`
  );
}

export function assertExpected(accepted, expected) {
  if (!expected || typeof expected.payTo !== "string") {
    throw new Error("refusing to pay: an expected payTo address is required, from a source other than this server");
  }
  // THE AMOUNT IS MANDATORY TOO, since 2026-09-18. It was compared only when
  // supplied, and the instructions printed at the moment of payment asked for
  // `--expect-payto` alone -- so the documented flow signed whatever sum the
  // site named, provided it named the right treasury. A site that is
  // compromised, or simply wrong, does not become harmless by being the right
  // destination: the ladder runs to $1,250.00, and an authorisation is signed
  // once and cannot be recalled.
  if (typeof expected.amount !== "string" && typeof expected.amount !== "number") {
    throw new Error("refusing to pay: an expected amount is required, from a source other than this server");
  }
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  if (!same(accepted.payTo, expected.payTo)) {
    throw new Error(`refusing to pay: payTo is ${accepted.payTo}, expected ${expected.payTo}`);
  }
  for (const field of ["amount", "asset", "network"]) {
    if (expected[field] !== undefined && !same(accepted[field], expected[field])) {
      throw new Error(`refusing to pay: ${field} is ${accepted[field]}, expected ${expected[field]}`);
    }
  }
  // "exact" is the scheme that means one transfer with no allowance. Anything
  // else is a different bargain than the one this client will make.
  if (accepted.scheme !== "exact") {
    throw new Error(`refusing to pay: scheme is ${accepted.scheme}, this client only signs "exact"`);
  }
  return accepted;
}

/**
 * Sign one EIP-3009 transferWithAuthorization.
 *
 * What is signed is TYPED DATA, not a transaction. There is no gas here, no
 * nonce from your account, and nothing that can be broadcast on its own: the
 * facilitator submits it and pays the fee. If it is never submitted, nothing
 * happened.
 *
 * `validBefore` is deliberately short. It is the window in which this
 * authorisation can be used at all, so a signature that leaks after the fact
 * is already dead. The default follows the demand's own maxTimeoutSeconds.
 */
export async function signAuthorization({ accepted, walletPrivateKey, now = Math.floor(Date.now() / 1000) }) {
  const account = privateKeyToAccount(walletPrivateKey);
  // THE WINDOW IS NOT THE SITE'S TO CHOOSE. `maxTimeoutSeconds` arrives in the
  // demand, and until 2026-09-18 it was used verbatim -- so a site that asked
  // for a year got an authorisation valid for a year. An EIP-3009
  // authorisation cannot be recalled: anyone holding it can spend it at any
  // point inside the window, and the ladder runs to $1,250.00. Ten minutes is
  // far longer than a settlement takes and short enough that a leak is already
  // dead. A shorter ask is honoured; a nonsense one is refused rather than
  // silently replaced, because a demand this malformed is not one to trust the
  // rest of.
  const asked = Number(accepted.maxTimeoutSeconds ?? DEFAULT_AUTHORISATION_SECONDS);
  if (!Number.isFinite(asked) || asked <= 0) {
    throw new Error(`refusing to pay: the demand's maxTimeoutSeconds is ${accepted.maxTimeoutSeconds}`);
  }
  const window = Math.min(asked, MAX_AUTHORISATION_SECONDS);
  const authorization = {
    from: account.address,
    to: accepted.payTo,
    value: BigInt(accepted.amount),
    // Backdated by a minute so a small clock difference between us and the
    // chain cannot make a fresh authorisation invalid on arrival.
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + window),
    nonce: `0x${randomBytes(32).toString("hex")}`,
  };

  const signature = await account.signTypedData({
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization",
    domain: {
      name: accepted.extra?.name,
      version: accepted.extra?.version,
      chainId: Number(String(accepted.network).split(":")[1]),
      verifyingContract: accepted.asset,
    },
    message: authorization,
  });

  return {
    signature,
    // Serialised as strings: these are uint256 values on the wire, and a
    // BigInt does not survive JSON.stringify.
    authorization: {
      ...authorization,
      value: authorization.value.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
    },
  };
}

/**
 * The `_meta` an MCP tool call carries to pay for itself.
 *
 * Attach this to `params._meta` and repeat the same call.
 */
export function paymentMeta({ demand, accepted, payload }) {
  return {
    [PAYMENT_META_KEY]: {
      x402Version: demand.x402Version ?? 2,
      resource: demand.resource,
      accepted,
      payload,
    },
  };
}

/**
 * The whole paid path: read the demand, check it against what you expect,
 * sign, and hand back the `_meta` to retry with.
 *
 * Returns null when there was nothing to pay for, so a caller can use this on
 * any tool result without asking first.
 */
export async function payFor({ result, expected, walletPrivateKey }) {
  const demand = readDemand(result);
  if (!demand) return null;

  const accepted = assertExpected(chooseAccepted(demand.accepts, expected), expected);
  const payload = await signAuthorization({ accepted, walletPrivateKey });
  return paymentMeta({ demand, accepted, payload });
}
