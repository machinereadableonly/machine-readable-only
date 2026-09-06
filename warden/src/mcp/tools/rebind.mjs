// warden/src/mcp/tools/rebind.mjs
import * as z from "zod";
import { keyIdToBytes32 } from "../keyId.mjs";

// 5.L4. THE INJECTION NOTE LIVED HERE AND BELONGS NOWHERE YET.
//
// The spec asks for the warning on "any field that echoes agent-supplied text
// -- names, key ids". This tool echoes a positive integer and a 32-byte hex
// string derived from a VERIFIED key id, both schema-bounded, so it was the one
// tool that could not carry prose -- and the annotation pointing at the safest
// surface reads to the next person as if it were the risky one. No tool on this
// service accepts free-form text today: every input is a positive integer or a
// 20-byte address pattern. The requirement is met by the schemas, and this is
// the note that says so.
//
// THE DAY A TOOL TAKES A STRING, the warning goes on THAT tool, in its
// description, beside the field. Do not put it back here.
export function makeRebindTool({ q, contract }) {
  return {
    name: "rebind",
    config: {
      title: "Rebind a token to your key",
      description:
        "Returns the call the token OWNER's wallet must sign. The Warden never submits it.",
      inputSchema: z.object({ tokenId: z.number().int().positive().describe("A token id. The call returned is for its OWNER wallet to send; this service never sends it.") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async handler({ tokenId }, ctx) {
      if (!q.getToken(tokenId)) return { ok: false, reason: "unknown-token" };
      return { ok: true, contract, function: "rebind", args: [tokenId, keyIdToBytes32(ctx.keyId)] };
    },
  };
}
