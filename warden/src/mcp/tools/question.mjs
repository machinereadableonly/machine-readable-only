// The daily question. Seeing it spends the token's look for the day.
import * as z from "zod";
import { DAY_MS, utcDay } from "../../day.mjs";
import { FINISH_LEVEL } from "../ladder.mjs";
import { questionFor, publicShape, answerSetSize, answerDeadline, ANSWER_WINDOW_MS } from "../question.mjs";
import { onChainBy, isMintDay, MINT_DAY_NEXT } from "../nextSteps.mjs";
import { keyIdToBytes32 } from "../keyId.mjs";

export function makeQuestionTool({ q, chain, bank, questionSecret, today = utcDay, now = Date.now }) {
  // Both at construction, like requireChain: a tool built without them would
  // refuse every caller, or key the day's choice on nothing. The SHAPE only --
  // makeMcpHandler and boot run the full assertBankSane, and this factory runs
  // on every MCP call. An empty bank is checked because questionFor would
  // divide by its length.
  if (!Array.isArray(bank) || bank.length === 0) throw new Error("question tool needs a non-empty question bank");
  if (!questionSecret) throw new Error("question tool needs the question secret");
  if (typeof chain?.boundKeyOf !== "function") throw new Error("question tool needs a chain reader with boundKeyOf()");
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
          onChainBy: onChainBy(token.lastDay),
          ...(isMintDay(token, day) ? { next: MINT_DAY_NEXT } : {}),
        };
      }

      // The CHAIN's binding, not the mirror's (D6): a look spent by a key the
      // token was rebound away from would be an answer the holder never gave.
      // Read last, so a refusal above costs no eth_call on a free tool.
      const bound = await chain.boundKeyOf(tokenId);
      if (!bound) return { ok: false, reason: "chain-unavailable" };
      if (bound !== keyIdToBytes32(ctx.keyId)) return { ok: false, reason: "not-bound-to-caller" };

      const chosen = questionFor(day, questionSecret, bank);
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
        windowSeconds: ANSWER_WINDOW_MS / 1000,
      };
    },
  };
}
