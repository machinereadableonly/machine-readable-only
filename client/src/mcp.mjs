// JSON-RPC over the door.
//
// MCP revision 2026-07-28: no initialize handshake, no session id, a fresh
// server per request. So a "call" here really is one HTTP request, and there
// is no connection to keep alive.
import { admittedFetch } from "./door.mjs";

/**
 * Read one JSON-RPC response.
 *
 * The server may answer as plain JSON or as a single Server-Sent Event, and
 * which one you get is not worth branching on elsewhere, so it is normalised
 * here. An SSE body is `data: {...}` on its own line.
 */
async function readRpc(res) {
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  try {
    return JSON.parse((line ?? text).replace(/^data:\s*/, ""));
  } catch {
    throw new Error(`response was not JSON-RPC (${res.status}): ${text.slice(0, 200)}`);
  }
}

/// One JSON-RPC call through the door. Returns the whole envelope, because a
/// payment demand arrives inside `result` and the caller has to see it.
export async function rpc({ origin, site, privateJwk, signatureAgent, method, params = {}, id = 1, fetchImpl = fetch }) {
  const res = await admittedFetch({
    origin,
    site,
    privateJwk,
    signatureAgent,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    fetchImpl,
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`refused at the door: ${body.reason ?? "no reason given"}`);
  }
  return readRpc(res);
}

/// The tools this site offers, as `{ name, description, inputSchema }`.
export async function listTools(opts) {
  const body = await rpc({ ...opts, method: "tools/list" });
  return body.result?.tools ?? [];
}

/**
 * Call one tool.
 *
 * Returns the raw MCP tool result rather than digging out the structured
 * value, because for a paid tool that result IS the payment demand and losing
 * its shape is how a caller ends up unable to pay. See pay.mjs.
 */
export async function callTool({ name, arguments: args = {}, _meta, ...opts }) {
  // `_meta` is how a payment authorisation travels: the same call, repeated,
  // with the signed authorisation attached. Omitted entirely when there is
  // none, rather than sent as undefined.
  const params = { name, arguments: args, ...(_meta ? { _meta } : {}) };
  const body = await rpc({ ...opts, method: "tools/call", params });
  if (body.error) throw new Error(`${name} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

/// The structured value a tool returned, for the tools that do not charge.
export function structured(result) {
  return result?.structuredContent ?? null;
}
