// The 2026-07-28 request envelope, in one place.
//
// The server is modern-only (`legacy: 'reject'`), because the compatibility
// leg it used to fall back to is a fallback the SDK can drop in one release --
// and every request this project made was taking it, silently, while three of
// its own documents described the modern shape. Tests build requests by hand,
// so without this helper each one would carry its own copy of the envelope and
// the first one written from memory would be serving a leg nobody meant.
//
// Two halves that MUST agree, per the transport spec: the `_meta` claim in the
// body and the mirrored headers. A server MUST reject a mismatch with
// `-32020 HeaderMismatch`, so a test that got them out of step would fail
// loudly rather than quietly testing the wrong thing.

export const PROTOCOL_VERSION = "2026-07-28";

/// The JSON-RPC body, with the protocol claim merged into `params._meta`.
/// `payload` is `{ method, params }` as a caller would write it.
export function envelopeBody({ id = 1, method, params = {} } = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        ...(params._meta ?? {}),
        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

/// The mirrored headers. `Mcp-Name` only on the methods that name a thing.
export function envelopeHeaders({ method, params = {} } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    "mcp-method": method,
  };
  const named = method === "tools/call" || method === "prompts/get" ? params.name
    : method === "resources/read" ? params.uri
    : null;
  if (named != null) headers["mcp-name"] = String(named);
  return headers;
}

/// Body and headers together, serialised once: the bytes that are signed have
/// to be the bytes that are sent, or the door's digest check refuses them.
export function envelope(payload) {
  return {
    raw: JSON.stringify(envelopeBody(payload)),
    headers: envelopeHeaders(payload),
  };
}
