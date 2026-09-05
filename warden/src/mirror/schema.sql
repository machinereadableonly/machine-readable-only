-- The Warden's mirror. This is the source of truth for the MCP tools, so a
-- token exists to an agent from the moment it is queued, not from the moment
-- it is mined. The Clock (Plan 3) reconciles it against chain events.

CREATE TABLE IF NOT EXISTS keys (
  keyId        TEXT PRIMARY KEY,   -- RFC 7638 thumbprint of the JWK
  jwk          TEXT NOT NULL,      -- the public JWK, as JSON
  directory    TEXT,               -- the agent's own directory URL, or NULL for the easy path
  registeredAt INTEGER NOT NULL    -- unix ms
);

CREATE TABLE IF NOT EXISTS tokens (
  tokenId    INTEGER PRIMARY KEY,
  keyId      TEXT NOT NULL,
  owner      TEXT NOT NULL,        -- the receiving address
  level      INTEGER NOT NULL DEFAULT 1,
  streak     INTEGER NOT NULL DEFAULT 1,
  -- The longest run this token has ever completed, which is what the earned
  -- Marks are gated on -- NOT `streak`, which resets to 1 the moment a day is
  -- missed. Mirrors Token.bestRun on chain; see ladder.mjs effectiveRun().
  bestRun    INTEGER NOT NULL DEFAULT 1,
  lastDay    INTEGER NOT NULL,
  mintDay    INTEGER NOT NULL,
  marks      INTEGER NOT NULL DEFAULT 0,   -- the bitmask, one bit per mark id
  generation INTEGER NOT NULL DEFAULT 0,
  parentId   INTEGER,
  status     TEXT NOT NULL DEFAULT 'queued',  -- queued | written (the WRITE pipeline)
  -- Set by the token OWNER calling rest(id) straight on chain, so this service
  -- is never told. It is learned lazily: every gated tool call reads the
  -- token's lifecycle from the chain anyway, and records a true here when it
  -- sees one. Plan 3's Clock will maintain it properly from Rested events.
  -- NOTE this used to be read off `status`, which holds only queued|written,
  -- so `resting` was ALWAYS FALSE -- dead code that looked like a live gate.
  resting    INTEGER NOT NULL DEFAULT 0
);

-- The unique index is the concurrency control for check-ins. Two simultaneous
-- calls for one token produce one credit and one already-credited-today; there
-- is deliberately no lock.
CREATE TABLE IF NOT EXISTS credits (
  tokenId INTEGER NOT NULL,
  day     INTEGER NOT NULL,
  sigHash TEXT NOT NULL,
  status  TEXT NOT NULL DEFAULT 'queued'
);
CREATE UNIQUE INDEX IF NOT EXISTS credits_token_day ON credits (tokenId, day);

CREATE TABLE IF NOT EXISTS mark_orders (
  tokenId   INTEGER NOT NULL,
  upgradeId INTEGER NOT NULL,
  variant   INTEGER NOT NULL DEFAULT 0,   -- the Iris shape or the Tint ink; 0 for every other Mark
  paymentTx TEXT,
  -- queued | written | failed. 'failed' is the terminal state for an order the
  -- chain refused on simulation: the same call against the same state will be
  -- refused every night, so retrying it is noise and the row waits for a human
  -- instead. It is deliberately NOT deleted -- the unique index below is what
  -- stops a second reservation of the same Mark, and a Mark the chain refused
  -- should stay refused until somebody has looked at it.
  status    TEXT NOT NULL DEFAULT 'queued'
);

-- One token can hold one reservation per mark. This is the final authority
-- against two settlements racing to apply the same mark to the same token --
-- a read-then-write check alone can be overtaken between the read and the
-- write.
--
-- The variant is deliberately NOT part of this index. A token holds one
-- reservation per Mark whatever shape it chose; including the variant would let
-- the same Mark be bought twice by asking for a different shape the second time.
CREATE UNIQUE INDEX IF NOT EXISTS mark_orders_token_upgrade ON mark_orders (tokenId, upgradeId);

CREATE TABLE IF NOT EXISTS mints (
  tokenId   INTEGER PRIMARY KEY,
  toAddress TEXT NOT NULL,
  keyId     TEXT NOT NULL,
  paymentTx TEXT,
  qr        TEXT,                            -- the solved bitmap, hex; NULL until solved
  solveState TEXT NOT NULL DEFAULT 'pending', -- pending | solving | done | failed
  solveTries INTEGER NOT NULL DEFAULT 0,
  status    TEXT NOT NULL DEFAULT 'queued'
);

-- One mint per key. Same reasoning as mark_orders above: two settlements from
-- the same key can both pass the pre-payment hasMinted check, so the index is
-- what actually stops a second token from being recorded.
CREATE UNIQUE INDEX IF NOT EXISTS mints_key ON mints (keyId);
