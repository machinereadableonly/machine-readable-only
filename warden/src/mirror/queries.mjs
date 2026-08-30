// Every statement the tools use, prepared once, in one file.
//
// Prepared statements are reused across calls, so the SQL is parsed once per
// process rather than once per request.

/// The exact SQLite error for a violated UNIQUE index. Matching on the message
/// rather than catching everything is deliberate: a dropped table and a
/// duplicate check-in must not look the same to a caller.
const UNIQUE_VIOLATION = /UNIQUE constraint failed/;

export function queries(db) {
  const s = {
    insertCredit: db.prepare("INSERT INTO credits (tokenId, day, sigHash) VALUES (?, ?, ?)"),
    insertToken: db.prepare(
      "INSERT INTO tokens (tokenId, keyId, owner, lastDay, mintDay) VALUES (?, ?, ?, ?, ?)"
    ),
    getToken: db.prepare("SELECT * FROM tokens WHERE tokenId = ?"),
    tokensForKey: db.prepare("SELECT * FROM tokens WHERE keyId = ?"),
    maxTokenId: db.prepare("SELECT MAX(tokenId) AS maxId FROM tokens"),
    insertKey: db.prepare(
      "INSERT OR REPLACE INTO keys (keyId, jwk, directory, registeredAt) VALUES (?, ?, ?, ?)"
    ),
    getKey: db.prepare("SELECT * FROM keys WHERE keyId = ?"),
    allKeys: db.prepare("SELECT * FROM keys ORDER BY registeredAt ASC"),
  };

  return {
    /**
     * Credit one day to one token.
     *
     * Returns true when the credit was new and false when that token already
     * had that day. Any OTHER database error is rethrown: a swallowed error
     * here would report a healthy check-in on a broken database.
     */
    insertCredit(tokenId, day, sigHash) {
      try {
        s.insertCredit.run(tokenId, day, sigHash);
        return true;
      } catch (err) {
        if (UNIQUE_VIOLATION.test(err.message)) return false;
        throw err;
      }
    },

    insertToken({ tokenId, keyId, owner, lastDay, mintDay }) {
      s.insertToken.run(tokenId, keyId, owner, lastDay, mintDay);
    },

    getToken: (tokenId) => s.getToken.get(tokenId),
    tokensForKey: (keyId) => s.tokensForKey.all(keyId),
    getKey: (keyId) => s.getKey.get(keyId),
    allKeys: () => s.allKeys.all(),
    insertKey: ({ keyId, jwk, directory, registeredAt }) =>
      s.insertKey.run(keyId, JSON.stringify(jwk), directory ?? null, registeredAt),

    /// Token ids are assigned here, not by the contract. The contract takes the
    /// id as an argument and reverts if it is taken, so the id promised to an
    /// agent at mint is the id that lands.
    nextTokenId: () => (s.maxTokenId.get().maxId ?? 0) + 1,
  };
}
