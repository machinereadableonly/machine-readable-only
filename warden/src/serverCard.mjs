// The MCP Server Card (the Server Card extension, SEP-2127, final): what a
// crawler reads at `<mcp-url>/server-card` before it connects. Built from the
// registry's server.json so the two cannot disagree on identity or endpoint.
import { createHash } from "node:crypto";

export const SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
export const SERVER_CARD_TYPE = "application/mcp-server-card+json";
export const AI_CATALOG_TYPE = "application/ai-catalog+json";
/// The only transport revision this server speaks (`legacy: "reject"`).
export const SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28"];

/// Null when the registry document lacks what a card requires.
export function serverCardFrom(registryJson) {
  const r = JSON.parse(registryJson);
  if (!r.name || !r.version || !r.description || !r.repository?.url || !Array.isArray(r.remotes)) return null;
  const card = {
    $schema: SERVER_CARD_SCHEMA,
    name: r.name,
    version: r.version,
    description: r.description,
    title: "Machine Readable Only",
    websiteUrl: r.websiteUrl,
    repository: { url: r.repository.url, source: r.repository.source },
    remotes: r.remotes.map((remote) => ({ type: remote.type, url: remote.url, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS })),
    ...(r._meta ? { _meta: r._meta } : {}),
  };
  const body = JSON.stringify(card);
  return { card, body, etag: `"${createHash("sha256").update(body).digest("base64url")}"` };
}

/// The domain's AI Catalog, pointing at the one card.
export function aiCatalogFor(domain) {
  const body = JSON.stringify({
    specVersion: "1.0",
    entries: [{
      identifier: `urn:air:${domain}:mcp:machine-readable-only`,
      type: SERVER_CARD_TYPE,
      url: `https://${domain}/mcp/server-card`,
    }],
  });
  return { body, etag: `"${createHash("sha256").update(body).digest("base64url")}"` };
}

/// The extension's CORS and caching headers for a public card or catalog.
export const CARD_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET",
  "access-control-allow-headers": "Content-Type, If-None-Match",
  "access-control-expose-headers": "ETag",
  "cache-control": "public, max-age=3600",
};
