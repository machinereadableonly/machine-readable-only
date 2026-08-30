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

/// Translate the v2 tool context into the shape the payment wrapper reads.
export function adaptContext(mcpCtx) {
  return { _meta: mcpCtx?.mcpReq?._meta };
}

/**
 * Build the `paid()` wrapper.
 *
 * `accepts` comes from the resource server's buildPaymentRequirements, so the
 * price and network are declared in one place rather than per tool.
 */
export function makePaid(resourceServer, accepts) {
  const wrap = createPaymentWrapper(resourceServer, { accepts });
  return (handler) => {
    const wrapped = wrap(handler);
    return (args, ctx) => wrapped(args, adaptContext(ctx.mcpCtx));
  };
}
