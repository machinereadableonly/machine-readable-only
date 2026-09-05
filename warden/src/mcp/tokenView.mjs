// The public shape of a token. ONE function, used by both the `status` tool and
// the unsigned /t/<id> route, so a scanner and an agent can never be told two
// different stories about the same token.

/**
 * Where a token says the rest of the piece is.
 *
 * C1.5: `/t/<id>` is the destination written into every bitmap at mint and it
 * cannot be changed afterwards, so the answer at the other end is the only
 * part of the artwork's own arrival that stays under our control. It used to
 * be a number set with an owner address: nothing naming the piece, and no
 * route to the page that would explain it.
 *
 * Built from the SAME configuration the resources use and never from a
 * literal. A hardcoded 8453 once sat beside an address read from the
 * environment, which published a mainnet chain id with a testnet address --
 * see resources.mjs for that one.
 */
export function tokenLinks({ domain, contract, chainId }) {
  return {
    docs: `https://${domain}/llms.txt`,
    mcp: `https://${domain}/mcp`,
    contract,
    chainId,
  };
}

export function tokenView(q, tokenId, links = null) {
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
    ...(links ?? {}),
  };
}
