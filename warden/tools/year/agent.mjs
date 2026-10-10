// One scripted agent at the door, through the published client library rather
// than a second implementation of it: the same signing, the same demand
// reading, the same payment as `mro-agent join`.
import {
  loadIdentity, registerKey, callTool, structured, readDemand, payFor,
} from "../../../client/src/index.mjs";
import { LADDER } from "../../src/mcp/ladder.mjs";

/// A mint costs 1 USDC (the Warden's MINT_PRICE). Pinned here, out of band, so
/// a demand asking for more is refused before anything is signed.
export const MINT_AMOUNT = "1000000";

/// What a Mark costs, from the catalogue the contract's Ladder.sol mirrors by
/// hash -- never from the demand, which is the thing being checked.
export function markAmount(upgradeId) {
  const mark = LADDER[upgradeId];
  if (!mark) throw new Error(`no Mark ${upgradeId} in the ladder`);
  return String(mark.priceUsdc6);
}

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

  async function mint(to, expectedPayTo) {
    const first = await tool("mint", { to });
    if (!readDemand(first)) return answer(first);

    const meta = await pay({
      result: first,
      walletPrivateKey: walletKey,
      expected: { payTo: expectedPayTo, amount: MINT_AMOUNT },
      binding: { keyId: identity.keyId, tool: "mint", args: { to } },
    });
    const second = await tool("mint", { to }, meta);
    // A paid call answered with another demand is a settlement that failed;
    // @x402/mcp reports it with the same payment-required result.
    const failed = readDemand(second);
    if (failed) return { ok: false, reason: "payment-failed", demand: failed };
    return answer(second);
  }

  /**
   * Take a Mark.
   *
   * `paid` says whether an authorisation was signed and spent on this call, and
   * it is not the same question as `outcome`: a priced Mark can be refused by a
   * gate BEFORE any demand is issued, which looks identical in the answer. The
   * caller needs the difference to know whether asking again would pay twice.
   */
  async function upgrade(tokenId, upgradeId, variant = 0, { pay: shouldPay = false, expectedPayTo, expectedAmount } = {}) {
    const args = { tokenId, upgradeId, variant };
    const first = await tool("upgrade", args);
    const demand = readDemand(first);

    if (!demand) {
      const result = answer(first);
      return { outcome: result?.ok ? "applied-queued" : "refused", result, paid: false };
    }
    if (!shouldPay) return { outcome: "demand-only", demand, result: answer(first), paid: false };

    const meta = await pay({
      result: first,
      walletPrivateKey: walletKey,
      expected: { payTo: expectedPayTo, amount: expectedAmount ?? markAmount(upgradeId) },
      binding: { keyId: identity.keyId, tool: "upgrade", args },
    });
    const second = await tool("upgrade", args, meta);
    // A second demand means THIS call's payment was not accepted. Whether the
    // transfer was mined anyway is a question only the facilitator can answer,
    // so `paid` reports what the door did, not what the chain holds.
    const failed = readDemand(second);
    if (failed) return { outcome: "refused", demand: failed, result: answer(second), paid: false };
    const result = answer(second);
    return { outcome: result?.ok ? "applied-queued" : "refused", result, paid: true };
  }

  return {
    keyId: identity.keyId,
    register: () => register({ origin, privateJwk: identity.privateJwk }),
    mint,
    upgrade,
    ask: async (tokenId) => answer(await tool("question", { tokenId })),
    beat: async (tokenId, reply) => answer(await tool("checkin", reply === undefined ? { tokenId } : { tokenId, answer: reply })),
    /// Every token bound to this key, which the Warden reads from the VERIFIED key
    /// id rather than from an argument -- so this asks for nothing and is the only
    /// way back to a token whose mint or seed answer was lost in transit.
    status: async () => answer(await tool("status", {})),
    seed: async (parentId, to) => answer(await tool("seed", { parentId, to })),
    /// `rebind` and `rest` answer with a call for the token OWNER's wallet; this
    /// agent holds no wallet that could send one.
    ownerCallFor: async (name, tokenId) => answer(await tool(name, { tokenId })),
  };
}
