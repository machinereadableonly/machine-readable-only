// The public shape of a token. ONE function, used by both the `status` tool and
// the unsigned /t/<id> route, so a scanner and an agent can never be told two
// different stories about the same token.
export function tokenView(q, tokenId) {
  const t = q.getToken(tokenId);
  if (!t) return null;
  return {
    tokenId: t.tokenId,
    level: t.level,
    streak: t.streak,
    heart: `${Math.min(t.level, 365)}/365`,
    whole: t.level >= 365,
    years: Math.floor(t.level / 365),
    marks: t.marks,
    lastDay: t.lastDay,
    generation: t.generation,
    parentId: t.parentId,
    // The real column, not `status`. This read `t.status === "resting"` until
    // 2026-08-31, and status holds only 'queued' | 'written', so every token
    // ever served -- to a scanner at /t/<id> and to an agent through `status`
    // -- was reported as not resting, sealed ones included.
    resting: t.resting === 1,
    // NOT WRITTEN, rather than a list of the statuses that are not written.
    // `status` gained 'awaiting-payment' when settlement stopped being assumed,
    // and an equality test against 'queued' answered `pendingOnChain: false`
    // for those rows -- telling an agent its brand new token was already on
    // chain when it was not even paid for yet. Every status except 'written'
    // means the chain does not have this token, so that is what is asked.
    pendingOnChain: t.status !== "written",
    owner: t.owner,
  };
}
