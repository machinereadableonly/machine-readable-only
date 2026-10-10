// The daily question. Seeing it spends the token's look for the day.
import * as z from "zod";
import { DAY_MS, utcDay } from "../../day.mjs";
import { FINISH_LEVEL } from "../ladder.mjs";
import { questionFor, publicShape, answerSetSize, answerDeadline } from "../question.mjs";

export function makeQuestionTool({ q, bank, challengeSecret, today = utcDay, now = Date.now }) {
  // Both at construction, like requireChain: a tool built without them would
  // refuse every caller, or key the day's choice on nothing. The SHAPE only --
  // makeMcpHandler and boot run the full assertBankSane, and this factory runs
  // on every MCP call. An empty bank is checked because questionFor would
  // divide by its length.
  if (!Array.isArray(bank) || bank.length === 0) throw new Error("question tool needs a non-empty question bank");
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
      // A sealed token can never be credited again, so issuing it a question
      // would spend its one look on a day it cannot answer for. The mirror's
      // flag is one-way (set by reconcile and by the gates, never cleared), so
      // reading it here costs no eth_call on a free tool; a rest the mirror has
      // not learned yet is caught by checkin, which reads the chain.
      if (token.resting) return { ok: false, reason: "resting" };
      if (token.level >= FINISH_LEVEL) return { ok: false, reason: "year-complete" };
      const day = today();
      if (day <= token.lastDay) {
        return {
          ok: false,
          reason: "already-credited-today",
          nextWindowOpensAt: new Date((token.lastDay + 1) * DAY_MS).toISOString(),
        };
      }

      const chosen = questionFor(day, challengeSecret, bank);
      // The FIRST issue wins, so a second look cannot shop for a question the
      // artwork would rather record.
      const issued = q.issueQuestion(tokenId, day, chosen.id, now(), answerSetSize(chosen));
      const asked = bank.find((b) => b.id === issued.questionId);
      // Showing any other question would let checkin grade an answer against
      // one the agent never saw, so refuse rather than substitute.
      if (!asked) throw new Error("issued question is missing from the bank");
      return {
        ok: true,
        day,
        ...publicShape(asked),
        answerBy: new Date(answerDeadline(issued.issuedAt, day)).toISOString(),
      };
    },
  };
}
