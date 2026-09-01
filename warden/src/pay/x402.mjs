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
import { createPaymentWrapper } from "@x402/mcp";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

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
async function initResourceServer(facilitatorUrl, network) {
  // HTTPS ONLY. This host is told what every agent must pay and is trusted to
  // report that a payment settled; over plain HTTP anyone on the path could
  // rewrite the treasury address in a payment demand, or forge a settlement.
  // It is operator configuration rather than agent input, which is why this is
  // a startup-shaped check and not a request-shaped one -- but a typo in a
  // deployment file must not silently downgrade it.
  if (!/^https:\/\//i.test(facilitatorUrl)) {
    throw new Error(`X402_FACILITATOR_URL must be https, got: ${facilitatorUrl}`);
  }
  const server = registerExactEvmScheme(
    new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })),
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
 * the seven Marks cost from 1 to 100,000 USDC. A single fixed-price wrapper
 * shared by both tools would silently charge $1.00 for a Crown the day the Mark
 * catalogue is wired -- a money bug sitting in the seam between two correct
 * tasks, which is exactly where this project has found its worst defects.
 * Requirements are built and cached per (tool, price, description).
 *
 * WHY THE TOOL NAMES ITSELF. Left alone, @x402/mcp derives the resource from
 * `config.resource.url` and falls back to the literal string "paid_tool"
 * (paymentWrapper.ts). Both paid tools then demand payment for
 * `mcp://tool/paid_tool`, so an agent about to spend 100,000 USDC on a
 * Singularity is told only that it is paying "a paid tool" -- and every x402
 * receipt and discovery listing says the same. Observed in the live journey
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
  alert = console.error,
  build = initResourceServer,
  wrapFactory = createPaymentWrapper,
}) {
  let serverPromise = null;
  const wrappers = new Map();

  function resourceServer() {
    if (!serverPromise) {
      serverPromise = build(facilitatorUrl, network);
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
        return { ok: false, reason: "payment-unavailable", detail: "no-price" };
      }
      let wrap;
      try {
        wrap = await wrapperFor(price, tool, description);
      } catch (err) {
        alert(`payment unavailable (${facilitatorUrl}, ${network}): ${err.message}`);
        return { ok: false, reason: "payment-unavailable" };
      }
      return wrap(handler)(args, adaptContext(ctx.mcpCtx));
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
