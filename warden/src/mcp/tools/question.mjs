// The daily question. Seeing it spends the token's look for the day.
import * as z from "zod";
import { utcDay } from "../../day.mjs";
import { FINISH_LEVEL } from "../ladder.mjs";
import { questionFor, publicShape, ANSWER_WINDOW_MS } from "../question.mjs";

export function makeQuestionTool({ q, bank, challengeSecret, today = utcDay, now = Date.now }) {
  // Both at construction, like requireChain: a tool built without them would
  // refuse every caller, or key the day's choice on nothing.
  if (!Array.isArray(bank)) throw new Error("question tool needs the question bank");
  if (!challengeSecret) throw new Error("question tool needs the challenge secret");
  return {
    name: "question",
    config: {
      title: "Today's question",
      description:
        "Today's question for a token bound to your key. Free. Answer it with `checkin { tokenId, answer }` before `answerBy`. One look per token per UTC day: asking again returns the same question and the same deadline. A late or missing answer still credits the day.",
      inputSchema: z.object({ tokenId: z.number().int().positive().describe("A token bound to your key.") }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },

    async handler({ tokenId }, ctx) {
      const token = q.getToken(tokenId);
      if (!token) return { ok: false, reason: "unknown-token" };
      // Mirror only: a stale binding costs a look, never a credit; checkin
      // re-checks the chain.
      if (token.keyId !== ctx.keyId) return { ok: false, reason: "not-bound-to-caller" };
      if (token.level >= FINISH_LEVEL) return { ok: false, reason: "year-complete" };
      const day = today();
      if (day <= token.lastDay) return { ok: false, reason: "already-credited-today" };

      const chosen = questionFor(day, challengeSecret, bank);
      // The FIRST issue wins, so a second look cannot shop for a question the
      // artwork would rather record.
      const issued = q.issueQuestion(tokenId, day, chosen.id, now());
      const asked = bank.find((b) => b.id === issued.questionId) ?? chosen;
      return {
        ok: true,
        day,
        ...publicShape(asked),
        answerBy: new Date(issued.issuedAt + ANSWER_WINDOW_MS).toISOString(),
      };
    },
  };
}
