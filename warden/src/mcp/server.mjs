// The MCP surface.
//
// Spec revision 2026-07-28. A FRESH SERVER PER REQUEST: there are no sessions
// and no initialize handshake in this revision, and a per-request factory is
// also how the caller's identity reaches the tools.
//
// Roots, Sampling and Logging are deliberately absent, along with ping,
// logging/setLevel, notifications/roots/list_changed, SSE resumability and
// resources/subscribe. All are deprecated or removed in this revision and new
// implementations are told not to adopt them.
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Readable } from "node:stream";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { makeCheckinTool } from "./tools/checkin.mjs";
import { makeStatusTool } from "./tools/status.mjs";
import { makeLadderTool } from "./tools/ladder.mjs";
import { makeRebindTool } from "./tools/rebind.mjs";
import { makeRestTool } from "./tools/rest.mjs";
import { makeSeedTool } from "./tools/seed.mjs";
import { makeChallengeTool } from "./tools/challenge.mjs";
import { makeMintTool } from "./tools/mint.mjs";
import { makeUpgradeTool } from "./tools/upgrade.mjs";
import { registerResources } from "./resources.mjs";

/**
 * Is this already an MCP tool result, rather than a plain value to wrap?
 *
 * The marker is `content`: an array of content blocks is the one field the
 * MCP tool-result shape requires and no tool of ours returns. `isError` alone
 * would be too weak -- our own structured refusals carry `ok: false` and could
 * gain one -- and a tool-name allowlist would go stale the moment another
 * wrapped tool is added.
 */
function isToolResult(value) {
  return typeof value === "object" && value !== null && Array.isArray(value.content);
}

export function makeMcpHandler(deps) {
  const handler = createMcpHandler(
    (ctx) => {
      const server = new McpServer({ name: "machine-readable-only", version: "1.0.0" });

      // THE CALLER'S IDENTITY. `authInfo` is documented as strictly
      // pass-through: the handler never populates it from request headers, so
      // the only thing that can put a key id here is our own door, after
      // verification. A tool that took a key id as an argument instead would
      // let one agent act as another.
      const keyId = ctx.authInfo?.extra?.keyId ?? null;

      // The SAME channel, for the same reason: the SHA-256 of the RFC 9421
      // Signature header the door verified for this request. `checkin` writes
      // it into credits.sigHash, which is the only record of which signed
      // request bought a day. Nothing outside our own door can put it here.
      const sigHash = ctx.authInfo?.extra?.sigHash ?? null;

      // EVERY tool this service has, the paid two included. They were built
      // after this list and were never added to it, so `mint` and `upgrade`
      // existed, were tested, and were unreachable: tools/list named six, and
      // a call to either got JSON-RPC -32602 "Tool mint not found". Since
      // minting is the only way in, that made the whole piece unenterable.
      // Caught by the end-to-end test, which is the only one that reads the
      // live tool surface rather than calling a tool factory directly.
      // Both paid tools need `deps.paid` from makePaid(); without it they are
      // registered but every call refuses.
      for (const make of [
        makeChallengeTool, makeStatusTool, makeLadderTool, makeCheckinTool,
        makeRebindTool, makeRestTool, makeSeedTool, makeMintTool, makeUpgradeTool,
      ]) {
        const tool = make(deps);
        server.registerTool(tool.name, tool.config, async (args, mcpCtx) => {
          deps.onToolCall?.(tool.name, keyId);
          let result;
          try {
            result = await tool.handler(args, { keyId, sigHash, mcpCtx });
          } catch (err) {
            // THE SDK FORWARDS A THROWN MESSAGE VERBATIM. Measured on
            // 2026-07-28's server 2.0.0: createToolError puts Error.message
            // straight into the tool result, so a SQLite or RPC failure would
            // hand the caller its file path or connection string. The tools
            // return structured refusals for everything they expect, so a throw
            // here is by definition unexpected: log it, and say nothing.
            console.error(`tool ${tool.name} failed:`, err.message);
            const failure = { ok: false, reason: "internal" };
            return {
              content: [{ type: "text", text: JSON.stringify(failure) }],
              structuredContent: failure,
              isError: true,
            };
          }
          // A RESULT THAT IS ALREADY AN MCP TOOL RESULT IS PASSED THROUGH.
          //
          // The paid tools' handlers are wrapped by @x402/mcp, which returns a
          // COMPLETE result -- { structuredContent, content, isError } -- and
          // wrapping that again buried `isError` one level down, leaving the
          // outer result without one. x402MCPClient's extractor opens with
          // `if (!result.isError) return null`, so a paying agent using the
          // official client was told the call SUCCEEDED and never saw the
          // demand. Minting is the only way in, so that made the piece
          // unenterable through its own documented path.
          //
          // Detected by SHAPE, not by tool name: any handler that already
          // speaks MCP is passed through, so this cannot come apart the next
          // time a wrapped tool is added.
          if (isToolResult(result)) return result;
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        });
      }

      registerResources(server, deps);
      return server;
    },
    { onerror: (err) => console.error("mcp handler error:", err.message) }
  );

  const node = toNodeHandler(handler, { onerror: (err) => console.error("mcp adapter error:", err.message) });

  return {
    handler,
    /// The door has already verified the caller, so the key id AND the hash of
    /// the signature that proved it are attached to the Node request as
    /// `auth`, which is the channel toNodeHandler forwards.
    /// `raw` is the body the door already consumed to check content-digest.
    /// The adapter reads the request as a stream, so it is replayed here rather
    /// than re-read -- the stream is at its end by the time this is called.
    nodeHandler(req, res, keyId, sigHash = null, raw = null) {
      const auth = { token: "web-bot-auth", clientId: keyId, scopes: [], extra: { keyId, sigHash } };
      if (raw === null) {
        req.auth = auth;
        return node(req, res);
      }
      const replay = Readable.from([Buffer.from(raw, "utf8")]);
      // The IncomingMessage surface the adapter reads, and nothing more.
      Object.assign(replay, {
        headers: req.headers, rawHeaders: req.rawHeaders, method: req.method,
        url: req.url, httpVersion: req.httpVersion, httpVersionMajor: req.httpVersionMajor,
        httpVersionMinor: req.httpVersionMinor, socket: req.socket, complete: true, auth,
      });
      return node(replay, res);
    },
  };
}
