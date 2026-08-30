// A fresh challenge, on demand. Same shape as the 401 body, so a client has one
// way to get one whether it was refused or simply asked.
import * as z from "zod";
import { issueChallenge } from "../../door/challenge.mjs";

export function makeChallengeTool({ challengeSecret, domain }) {
  return {
    name: "challenge",
    config: {
      title: "Get a fresh entry challenge",
      description: "Returns a challenge valid for five seconds. Answer it with SHA-256 of the challenge concatenated with your key id, in hex.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async handler() {
      const { challenge, expires } = issueChallenge(challengeSecret);
      return { challenge, expires, mcp: `https://${domain}/mcp`, docs: `https://${domain}/llms.txt` };
    },
  };
}
