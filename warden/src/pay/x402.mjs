// x402 payment for the two paid tools.
//
// THE VERSION SEAM, verified by reading @x402/mcp 2.24.0's own source on
// 2026-08-30. That package declares @modelcontextprotocol/sdk ^1.12.1 and
// zod ^3.24.2 -- the v1 SDK -- while this server is @modelcontextprotocol/server
// 2.0.0 with zod 4. Its `createPaymentWrapper` reads the payment payload as
// `extra?._meta`, which was the v1 tool-context shape. Under v2 the same data
// lives at `ctx.mcpReq._meta`.
//
// The consequence of ignoring this is not a crash. The wrapper would simply
// never find a payment, conclude none was made, and answer "payment required"
// forever -- to paying agents included. A silent failure, so it is adapted here
// and pinned by a test.
import { createPaymentWrapper, extractPaymentFromMeta } from "@x402/mcp";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { withNext } from "../mcp/nextSteps.mjs";

/// What a mint costs. One place, because the tool's own description quotes it.
export const MINT_PRICE = "$1.00";

/// How `mint` names itself in a payment demand. Shared with the startup warm-up
/// so both build the SAME cache entry -- warming up under a different name
/// would leave the first paying agent waiting on a second round trip anyway.
export const MINT_RESOURCE = {
  tool: "mint",
  description: "Mint a Machine Readable Only token",
};

/// Translate the v2 tool context into the shape the payment wrapper reads.
export function adaptContext(mcpCtx) {
  return { _meta: mcpCtx?.mcpReq?._meta };
}

/**
 * The identifier a reservation and its settlement have in common.
 *
 * THE PROBLEM IT SOLVES. A paid effect must not be committed until the money
 * has moved, and the only place this service is told that is
 * `hooks.onAfterSettlement`. That hook receives `toolName`, `arguments`,
 * `paymentRequirements`, `paymentPayload` and `settlement` -- and NOT the
 * handler's return value, so it cannot see the token id the handler chose.
 * Something else has to join the two, and it must be known to the handler
 * before it writes and to the hook after the money moves.
 *
 * The EIP-3009 nonce is that thing. It is generated per authorisation by the
 * paying client, it is what the settlement actually submits on chain, and both
 * sides read it off the same payload.
 *
 * BOTH ENVELOPES ARE HANDLED because @x402/evm's exact scheme can carry either
 * an EIP-3009 authorisation or a Permit2 one, and the nonce sits at a different
 * path in each. An envelope with neither returns null, and the caller refuses
 * rather than guessing -- a reservation with no key to settle it by is a row
 * nothing can ever promote, which is a free token.
 */
export function payNonceOf(paymentPayload) {
  const p = paymentPayload?.payload;
  return p?.authorization?.nonce ?? p?.permit2Authorization?.nonce ?? null;
}

/// The same value, read from the raw `_meta` a tool handler is given. Uses
/// @x402/mcp's own extractor rather than reaching into `_meta` by key, so the
/// handler side and the hook side cannot drift apart.
export function payNonceFromMeta({ toolName, args, meta }) {
  if (!meta) return null;
  return payNonceOf(extractPaymentFromMeta({ name: toolName, arguments: args, _meta: meta }));
}

/**
 * Build the resource server and fetch what the facilitator supports.
 *
 * THE SERVER-SIDE SCHEME LIVES AT A SUBPATH. `@x402/evm`'s root export also has
 * an `ExactEvmScheme`, and it is the CLIENT one -- it holds a signer, exposes
 * `createPaymentPayload`, and has no `parsePrice`. Registering it here does not
 * fail at registration; it fails later, inside buildPaymentRequirements, with
 * `SchemeNetworkServer.parsePrice is not a function`. Measured on 2026-08-31,
 * not inferred: the published seller quickstart shows the root import, and it
 * is wrong for this side of the protocol.
 *
 * NETWORKS ARE NAMED, not the `eip155:*` wildcard the helper defaults to. This
 * server accepts payment on exactly the chain its contract is deployed on; a
 * facilitator advertising some other EVM chain must not become a chain this
 * piece will quote a price on.
 */
async function initResourceServer(facilitatorUrl, network, createAuthHeaders = undefined) {
  // HTTPS ONLY. This host is told what every agent must pay and is trusted to
  // report that a payment settled; over plain HTTP anyone on the path could
  // rewrite the treasury address in a payment demand, or forge a settlement.
  // It is operator configuration rather than agent input, which is why this is
  // a startup-shaped check and not a request-shaped one -- but a typo in a
  // deployment file must not silently downgrade it.
  if (!/^https:\/\//i.test(facilitatorUrl)) {
    throw new Error(`X402_FACILITATOR_URL must be https, got: ${facilitatorUrl}`);
  }
  // AUTHENTICATION, when the facilitator wants it. The testnet host takes none
  // and Coinbase's mainnet host answers 401 without it -- and `url` was the
  // only field ever passed, so the mainnet cutover would have produced a piece
  // that boots healthy and refuses every mint. `createAuthHeaders` is keyed by
  // request path because a CDP token names the exact call it authorises; see
  // pay/cdp.mjs.
  const server = registerExactEvmScheme(
    new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl, createAuthHeaders })),
    { networks: [network] }
  );
  // A LIVE HTTP CALL, and it THROWS when the facilitator cannot be reached
  // ("Failed to initialize: no supported payment kinds loaded from any
  // facilitator", reproduced 2026-08-31). That is why nothing here runs at
  // startup -- see makePaymentGateway.
  await server.initialize();
  return server;
}

/**
 * Make a post-gate refusal legible to the PAYMENT LAYER, so the agent is not
 * charged for it.
 *
 * MEASURED 2026-09-03 against the real facilitator, not inferred. `@x402/evm`'s
 * `exact` scheme defaults to the `authorization` payment flow, and @x402/core's
 * PAYMENT_FLOWS table gives that flow `settleBeforeHandler: false,
 * settleAfterHandler: true`: the payment is VERIFIED before the handler and
 * SETTLED after it returns. @x402/mcp then decides which of those to do by
 * reading ONE field of what the handler returned --
 *
 *     if (result.isError) { ...cancel... }
 *     return settlePaymentResult(...)      // otherwise: take the money
 *
 * -- and our tools answer with plain `{ ok: false, ... }` values that have no
 * `isError` at all. So every `paid-but-unavailable` ever returned was read as a
 * SUCCESS by the payment layer and settled: an agent paid 1 USDC and got a
 * refusal. Reproduced on Base Sepolia (payer 18.0 -> 17.0 USDC, settlement tx
 * 0x019854ce...), and reproduced as 0.00 USDC with this wrapper in place.
 *
 * Nothing has been settled at the moment a post-gate refusal is produced, so
 * cancelling costs the payer nothing: the signed EIP-3009 authorisation is
 * simply never submitted. The agent still proved it could pay, and keeps its
 * money.
 *
 * WHY HERE AND NOT IN THE TOOLS. Everything inside `paid()` is by construction
 * a post-gate refusal -- both tools decide every gate they can BEFORE asking
 * for payment -- so one conversion covers `mint` and `upgrade` together and
 * cannot come apart when a third paid tool is added. It also keeps the tools
 * answering in plain values, which is what every other tool here returns.
 *
 * The result is a COMPLETE MCP tool result. `content` is what makes
 * mcp/server.mjs pass it through untouched instead of wrapping it and burying
 * `isError` one level down -- the exact defect that made the piece unenterable
 * in eaac15a, and it would land here in the other direction.
 */
function cancelSettlementOnRefusal(handler) {
  return async (...callArgs) => {
    const result = await handler(...callArgs);
    if (!result || result.ok !== false) return result;
    return payRefusal(result);
  };
}

/**
 * One refusal shape for everything a PAID call can answer with.
 *
 * `isError` is what the payment layer reads, and it is not optional anywhere
 * inside a paid tool -- including the gateway's OWN refusals, which are
 * produced outside the payment wrapper. Those two (`no-price`, and a
 * facilitator that will not build) used to return plain values, so
 * mcp/server.mjs wrapped them without `isError` and x402MCPClient's extractor
 * -- which opens `if (!result.isError) return null` -- handed the agent
 * `paymentMade: false` beside a result shaped like a success. No money is at
 * risk in either (nothing has been verified yet), but it is the same
 * wire-format family as eaac15a, and the reachable one fires whenever the
 * facilitator has a transient outage. The reference client reads `ok`, which is
 * exactly how eaac15a survived a live check.
 *
 * `withNext` is applied HERE because a complete tool result is passed through
 * mcp/server.mjs untouched, so it never reaches the withNext call there. Every
 * refusal carries its next step (C3.7); a paid one is no exception.
 */
function payRefusal(value) {
  const answered = withNext(value);
  return {
    content: [{ type: "text", text: JSON.stringify(answered) }],
    structuredContent: answered,
    isError: true,
  };
}

/**
 * The `paid()` wrapper both paid tools call through.
 *
 * WHY THIS IS LAZY. Building the real thing needs `initialize()`, which is a
 * live HTTP call to a third-party host that throws on failure. Doing that at
 * startup would make the WHOLE process's boot -- the door, check-ins, status,
 * every free tool -- depend on reaching x402.org. It is built on the first
 * paid call instead, and cached.
 *
 * WHY A FAILURE IS NOT STICKY. A failed build clears the cache, so the next
 * call retries. A facilitator that is down for a minute must not disable
 * minting until someone restarts the process.
 *
 * WHY THE PRICE IS PER CALL, not baked into one wrapper. `mint` costs $1.00 and
 * the six bought Marks cost from $1.00 to $1,250.00. A single fixed-price
 * wrapper shared by both tools would silently charge $1.00 for a Vessel -- a
 * money bug sitting in the seam between two correct tasks, which is exactly
 * where this project has found its worst defects.
 * Requirements are built and cached per (tool, price, description).
 *
 * WHY THE TOOL NAMES ITSELF. Left alone, @x402/mcp derives the resource from
 * `config.resource.url` and falls back to the literal string "paid_tool"
 * (paymentWrapper.ts). Both paid tools then demand payment for
 * `mcp://tool/paid_tool`, so an agent about to spend $1,250.00 on a Vessel is
 * told only that it is paying "a paid tool" -- and every x402 receipt and
 * discovery listing says the same. Observed in the live journey
 * check on 2026-08-31, not guessed.
 *
 * `build` and `wrapFactory` are injectable so tests can drive every branch --
 * unreachable facilitator, empty accepts, retry after failure -- without a
 * network call.
 */
export function makePaymentGateway({
  facilitatorUrl,
  network,
  payTo,
  // Called with (payNonce, transactionHash) when, and only when, a payment has
  // actually settled. This is what promotes a reservation into something the
  // Clock will write on chain; without it the gateway takes money and tells
  // nobody, which is the state this service shipped in until 2026-09-05.
  //
  // It is a callback rather than the mirror itself so that this file keeps
  // knowing nothing about SQL, and so a test can watch settlement without a
  // database.
  onSettled = null,
  // Called with the nonce of a call whose handler reserved something and whose
  // settlement then did NOT happen. The counterpart to onSettled, and the
  // reason this gateway can release a dead reservation immediately instead of
  // waiting for it to age out.
  onUnsettled = null,
  // Supplied only for a facilitator that authenticates. Undefined is the
  // testnet host's correct configuration, not a missing setting.
  createAuthHeaders = undefined,
  alert = console.error,
  build = initResourceServer,
  wrapFactory = createPaymentWrapper,
}) {
  let serverPromise = null;
  const wrappers = new Map();

  /**
   * Nonces whose settlement hook has fired.
   *
   * WHY THIS EXISTS. @x402/mcp has an onAfterSettlement hook and no
   * onSettlementFailed to pair with it, so a failed settlement is reported to
   * this service by silence. Silence is not something a caller can await -- but
   * absence from this set, checked at the one moment the wrapper has returned,
   * is. By then the hook has already run: @x402/mcp awaits it inside
   * settlePaymentResult before the wrapper resolves.
   *
   * Matching on the nonce rather than a flag is what makes it safe under
   * concurrency: a nonce belongs to exactly one authorisation, so two agents
   * paying at the same moment cannot read each other's outcome.
   *
   * Entries are removed by the call that consumes them, so this never grows.
   */
  const settled = new Set();

  function resourceServer() {
    if (!serverPromise) {
      serverPromise = build(facilitatorUrl, network, createAuthHeaders);
      // Clear the cache on failure so the next paid call retries. The rejection
      // is still delivered to the awaiting caller below; this handler exists
      // only to reset the cache, and to keep the rejection from being seen as
      // unhandled when no call is awaiting yet (the startup warm-up).
      serverPromise.catch(() => {
        serverPromise = null;
      });
    }
    return serverPromise;
  }

  async function wrapperFor(price, tool = "paid_tool", description = undefined) {
    const key = JSON.stringify([tool, price, description]);
    const cached = wrappers.get(key);
    if (cached) return cached;
    const server = await resourceServer();
    const accepts = await server.buildPaymentRequirements({
      scheme: "exact",
      payTo,
      price,
      network,
    });
    // createPaymentWrapper THROWS SYNCHRONOUSLY on an empty accepts array, so
    // this check only changes the message, not the outcome. It is here because
    // an empty accepts means the facilitator does not support this network and
    // saying so is worth more than "must have at least one payment requirement".
    if (!accepts.length) {
      throw new Error(`no payment requirements for ${price} on ${network}`);
    }
    const wrap = wrapFactory(server, {
      accepts,
      resource: {
        url: `mcp://tool/${tool}`,
        description,
        serviceName: "machine-readable-only",
      },
      hooks: {
        // THE ONLY PLACE THIS SERVICE LEARNS THE MONEY MOVED. @x402/mcp fires
        // this after settlePaymentResult and only when settleResult.success is
        // true; there is deliberately no failure hook to pair with it, which is
        // why a reservation has to expire on its own rather than be cancelled.
        //
        // It must never throw. An exception here happens AFTER the payer has
        // been debited, and letting it propagate would turn a successful sale
        // into an internal error for the agent while the money stayed gone.
        onAfterSettlement: async ({ paymentPayload, settlement }) => {
          try {
            const nonce = payNonceOf(paymentPayload);
            if (!nonce) return alert(`settled payment carries no nonce: nothing can be promoted`);
            settled.add(nonce);
            const moved = await onSettled?.(nonce, settlement?.transaction ?? null);
            if (!moved) {
              alert(
                `settled payment ${settlement?.transaction ?? "(no tx)"} matched no reservation ` +
                  `(nonce ${nonce}): an agent has paid and holds nothing`
              );
            }
          } catch (err) {
            alert(`settlement recorded but could not be applied: ${err.message}`);
          }
        },
      },
    });
    wrappers.set(key, wrap);
    return wrap;
  }

  /**
   * Wrap one tool handler in payment at one price.
   *
   * Refusals are STRUCTURED VALUES, never throws: a throw is reported to the
   * agent as "internal" and tells it nothing it can act on. Never a crash, and
   * never a free mint.
   */
  function paid(handler, price, { tool, description } = {}) {
    return async (args, ctx) => {
      // A missing or malformed price is a WIRING error, not an agent error, and
      // it must never fall back to a default -- a default price is how the
      // wrong amount gets charged silently. Refuse, and say so in the log.
      if (typeof price !== "string" || !/^\$\d/.test(price)) {
        alert(`paid tool called with an unusable price: ${JSON.stringify(price)}`);
        return payRefusal({ ok: false, reason: "payment-unavailable", detail: "no-price" });
      }
      let wrap;
      try {
        wrap = await wrapperFor(price, tool, description);
      } catch (err) {
        alert(`payment unavailable (${facilitatorUrl}, ${network}): ${err.message}`);
        return payRefusal({ ok: false, reason: "payment-unavailable" });
      }

      // THE HANDLER IS TOLD WHAT WILL SETTLE IT. Every row a paid handler
      // writes has to carry the nonce, because that is the only thing
      // onAfterSettlement can find it by later. Deriving it here rather than in
      // each tool means `mint` and `upgrade` cannot disagree about where it
      // comes from, and a third paid tool gets it for free.
      //
      // A missing nonce REFUSES, and refuses before the handler runs. The
      // alternative is a row no settlement can ever promote -- which the Clock
      // would never write, so the agent would pay and get nothing. Refusing
      // costs it nothing: this returns `ok: false`, which
      // cancelSettlementOnRefusal converts, so the authorisation is never
      // submitted.
      // The nonce this call reserved something against, or null when the
      // handler refused and therefore wrote nothing. Only a call that actually
      // reserved has anything to release.
      let reservedNonce = null;

      const withNonce = async (handlerArgs, x402Ctx) => {
        const payNonce = payNonceFromMeta({ toolName: tool, args: handlerArgs, meta: x402Ctx?.meta });
        if (!payNonce) {
          alert(`${tool}: a verified payment carried no usable nonce, so nothing could be reserved`);
          return { ok: false, reason: "payment-unavailable", detail: "no-nonce" };
        }
        const result = await handler(handlerArgs, { payNonce });
        if (result?.ok) reservedNonce = payNonce;
        return result;
      };

      const result = await wrap(cancelSettlementOnRefusal(withNonce))(args, adaptContext(ctx.mcpCtx));

      // DID THE MONEY ACTUALLY MOVE? By this line the wrapper has finished, so
      // onAfterSettlement has either run for this nonce or is never going to.
      // A reservation with no settlement behind it is released now rather than
      // left to age out, so the agent can try again immediately.
      if (reservedNonce) {
        if (settled.delete(reservedNonce)) return result;
        try {
          const released = await onUnsettled?.(reservedNonce);
          alert(
            `${tool}: settlement did not complete, so the reservation was released` +
              (released?.tokenId ? ` (token ${released.tokenId})` : "")
          );
        } catch (err) {
          // The sweep is the backstop for exactly this: the row keeps its
          // 'awaiting-payment' status, so it is still unwritable by the Clock.
          alert(`${tool}: a reservation could not be released and will expire instead: ${err.message}`);
        }
      }
      return result;
    };
  }

  // Build the wrapper for one price without running a tool call. The startup
  // warm-up uses this; nothing else should. It is a property rather than a
  // second return value so `paid` stays the same shape the tools already call.
  paid.prepare = wrapperFor;
  return paid;
}

/**
 * Ask the gateway to build itself now, and swallow any failure.
 *
 * A misconfigured facilitator or a wrong network otherwise stays invisible
 * until the first paying agent arrives. This surfaces it in the boot log
 * instead, WITHOUT making startup depend on it: the returned promise always
 * resolves, and the gateway's own retry still applies afterwards.
 */
export async function warmUp(paid, price = MINT_PRICE, alert = console.error) {
  try {
    await paid.prepare(price, MINT_RESOURCE.tool, MINT_RESOURCE.description);
    return true;
  } catch (err) {
    alert(`payment is not ready: ${err.message}`);
    return false;
  }
}
