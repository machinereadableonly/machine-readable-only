// One scripted agent at the door, through the published client library rather
// than a second implementation of it: the same signing, the same demand
// reading, the same payment as `mro-agent join`.
import {
  loadIdentity, registerKey, callTool, structured, readDemand, payFor,
} from "../../../client/src/index.mjs";

/// A mint costs 1 USDC (the Warden's MINT_PRICE). Pinned here, out of band, so
/// a demand asking for more is refused before anything is signed.
export const MINT_AMOUNT = "1000000";

const DEPS = { callTool, payFor, registerKey };

/**
 * Build one agent.
 *
 * The identity must already exist: generating one here would silently give an
 * agent a key its tokens are not bound to.
 */
export function makeAgent({ identityPath, walletKey, site, origin }, deps = {}) {
  const { callTool: send, payFor: pay, registerKey: register } = { ...DEPS, ...deps };
  const identity = loadIdentity(identityPath);
  if (!identity) throw new Error(`no identity at ${identityPath}: run wallets.mjs first`);

  // The door call exactly as the CLI builds it: the SITE is what the signature
  // covers, the origin is only where the bytes go.
  const call = { origin, site, signatureAgent: site, privateJwk: identity.privateJwk };

  const tool = (name, args, _meta) => send({ ...call, name, arguments: args, ...(_meta ? { _meta } : {}) });
  const answer = (result) => structured(result) ?? result;

  /// The offered requirement this payment is measured against, chosen by the
  /// treasury the operator named rather than by position.
  const offerFor = (demand, expectedPayTo) =>
    demand.accepts.find((a) => String(a.payTo).toLowerCase() === String(expectedPayTo).toLowerCase()) ?? demand.accepts[0];

  async function mint(to, expectedPayTo) {
    const first = await tool("mint", { to });
    if (!readDemand(first)) return answer(first);

    const meta = await pay({
      result: first,
      walletPrivateKey: walletKey,
      expected: { payTo: expectedPayTo, amount: MINT_AMOUNT },
    });
    const second = await tool("mint", { to }, meta);
    // A paid call answered with another demand is a settlement that failed;
    // @x402/mcp reports it with the same payment-required result.
    const failed = readDemand(second);
    if (failed) return { ok: false, reason: "payment-failed", demand: failed };
    return answer(second);
  }

  async function upgrade(tokenId, upgradeId, variant = 0, { pay: shouldPay = false, expectedPayTo } = {}) {
    const args = { tokenId, upgradeId, variant };
    const first = await tool("upgrade", args);
    const demand = readDemand(first);

    if (!demand) {
      const result = answer(first);
      return { outcome: result?.ok ? "applied-queued" : "refused", result };
    }
    if (!shouldPay) return { outcome: "demand-only", demand, result: answer(first) };

    const meta = await pay({
      result: first,
      walletPrivateKey: walletKey,
      expected: { payTo: expectedPayTo, amount: offerFor(demand, expectedPayTo).amount },
    });
    const second = await tool("upgrade", args, meta);
    const failed = readDemand(second);
    if (failed) return { outcome: "refused", demand: failed, result: answer(second) };
    const result = answer(second);
    return { outcome: result?.ok ? "applied-queued" : "refused", result };
  }

  return {
    keyId: identity.keyId,
    register: () => register({ origin, privateJwk: identity.privateJwk }),
    mint,
    upgrade,
    beat: async (tokenId) => answer(await tool("checkin", { tokenId })),
    seed: async (parentId, to) => answer(await tool("seed", { parentId, to })),
    /// `rebind` and `rest` answer with a call for the token OWNER's wallet; this
    /// agent holds no wallet that could send one.
    ownerCallFor: async (name, tokenId) => answer(await tool(name, { tokenId })),
  };
}
