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
import { toNodeHandler } from "@modelcontextprotocol/node";
import { makeCheckinTool } from "./tools/checkin.mjs";
import { makeStatusTool } from "./tools/status.mjs";
import { makeRebindTool } from "./tools/rebind.mjs";
import { makeRestTool } from "./tools/rest.mjs";
import { makeSeedTool } from "./tools/seed.mjs";
import { makeChallengeTool } from "./tools/challenge.mjs";
import { registerResources } from "./resources.mjs";

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

      for (const make of [makeChallengeTool, makeStatusTool, makeCheckinTool, makeRebindTool, makeRestTool, makeSeedTool]) {
        const tool = make(deps);
        server.registerTool(tool.name, tool.config, async (args, mcpCtx) => {
          deps.onToolCall?.(tool.name, keyId);
          const result = await tool.handler(args, { keyId, mcpCtx });
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
    /// The door has already verified the caller, so the key id is attached to
    /// the Node request as `auth`, which is the channel toNodeHandler forwards.
    nodeHandler(req, res, keyId) {
      req.auth = { token: "web-bot-auth", clientId: keyId, scopes: [], extra: { keyId } };
      return node(req, res);
    },
  };
}
