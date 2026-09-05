// JSON-RPC over the door.
//
// MCP revision 2026-07-28: no initialize handshake, no session id, a fresh
// server per request. So a "call" here really is one HTTP request, and there
// is no connection to keep alive.
import { admittedFetch } from "./door.mjs";

/**
 * The revision this client speaks, sent in two places that MUST agree.
 *
 * Revision 2026-07-28 removed the initialize handshake, so every request
 * carries its own protocol version and capabilities instead. The transport
 * then MIRRORS selected body fields into headers, so intermediaries can route
 * without parsing the body -- and a server MUST reject a request whose header
 * and body disagree with `-32020 HeaderMismatch`.
 *
 * Without this envelope a request is served by the SDK's LEGACY leg, the
 * 2025-era compatibility path. That leg works today and is a fallback the SDK
 * can drop in one release, which for a piece meant to run for years is a
 * standing dependency on somebody else's deprecation schedule.
 */
export const PROTOCOL_VERSION = "2026-07-28";

/// Identifies this client on every request, which the revision SHOULDs.
const CLIENT_INFO = { name: "mro-agent", version: "0.1.0" };

/**
 * Header-safe, or the Base64 sentinel the spec requires.
 *
 * `Mcp-Name` carries a tool name or a resource URI, and neither is guaranteed
 * to be plain ASCII. RFC 9110 allows visible ASCII, space and tab in a field
 * value; anything else -- and any value that would be mistaken for the
 * sentinel itself -- MUST be encoded as `=?base64?<b64>?=`. Ours are all
 * plain today, which is exactly why the rule would otherwise be discovered
 * broken by the first agent whose name is not.
 */
export function headerSafe(value) {
  const plain = /^[\x20-\x7E]*$/.test(value)
    && value.trim() === value
    && !(value.startsWith("=?base64?") && value.endsWith("?="));
  return plain ? value : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * The transport headers for one call.
 *
 * `Mcp-Method` is required on every request. `Mcp-Name` only on the three
 * methods that name a thing -- tools/call, resources/read, prompts/get --
 * taken from `params.name` or `params.uri`, and a server MUST reject a
 * mismatch. Sending it where the spec does not define one would be inventing
 * a header rather than mirroring a field.
 */
export function transportHeaders(method, params = {}) {
  const headers = {
    "mcp-protocol-version": PROTOCOL_VERSION,
    "mcp-method": method,
  };
  const named = method === "tools/call" || method === "prompts/get" ? params.name
    : method === "resources/read" ? params.uri
    : null;
  if (named != null) headers["mcp-name"] = headerSafe(String(named));
  return headers;
}

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
  // The protocol fields go LAST so a caller cannot overwrite them. `_meta` is
  // shared with the x402 payment authorisation, which uses its own namespaced
  // keys, so the two sit side by side rather than competing.
  const withMeta = {
    ...params,
    _meta: {
      ...(params._meta ?? {}),
      "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
  const res = await admittedFetch({
    origin,
    site,
    privateJwk,
    signatureAgent,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: withMeta }),
    headers: transportHeaders(method, withMeta),
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
