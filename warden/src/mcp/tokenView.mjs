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
    pendingOnChain: t.status === "queued",
    owner: t.owner,
  };
}
