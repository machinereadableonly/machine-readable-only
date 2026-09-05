-- The Warden's mirror. This is the source of truth for the MCP tools, so a
-- token exists to an agent from the moment it is queued, not from the moment
-- it is mined. The Clock (Plan 3) reconciles it against chain events.

CREATE TABLE IF NOT EXISTS keys (
  keyId        TEXT PRIMARY KEY,   -- RFC 7638 thumbprint of the JWK
  jwk          TEXT NOT NULL,      -- the public JWK, as JSON
  directory    TEXT,               -- the agent's own directory URL, or NULL for the easy path
  registeredAt INTEGER NOT NULL,   -- unix ms
  -- The SAME key id in the form the CONTRACT stores: keyIdToBytes32(keyId),
  -- which is a SHA-256 and therefore one way. A `Rebound` event names the new
  -- key only in that form, so without this column the Warden could see that a
  -- token had been rebound and never work out to whom -- which is exactly why
  -- the mirror's binding never converged with the chain's. Stored going
  -- FORWARDS at registration, so the lookup a Rebound needs is an index hit
  -- rather than an impossible inversion.
  keyIdHash    TEXT,
  -- When this key was last used to get through the door, unix ms, or NULL if
  -- it never has been. Registration alone does NOT count as use: registering
  -- is free and unauthenticated, so a key that registers and never signs
  -- anything is the shape a flood takes. See the prune in migrate()'s caller
  -- and UNUSED_KEY_TTL_MS.
  lastUsedAt   INTEGER
);
-- The index on keyIdHash is created by migrate(), NOT here. This file is
-- exec'd WHOLE against an existing database before any migration runs, and
-- `CREATE TABLE IF NOT EXISTS keys` is a no-op on a database that predates the
-- column -- so an index naming it here throws "no such column: keyIdHash" and
-- takes the whole process down before migrate can add it. Measured in
-- production on 2026-09-05, where it crash-looped the live Warden: every test
-- opened a fresh in-memory database, in which CREATE TABLE had already made
-- the column, so the ordering never came up.
--
-- THE RULE THIS IS AN INSTANCE OF: nothing in this file may reference a column
-- that migrate() adds. Columns go in both places; indexes and anything else
-- that depends on a migrated column go in migrate() alone.

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
  -- queued | written | failed.
  --
  -- 'failed' is the terminal state, added 2026-09-05, and its absence was a
  -- defect rather than a simplification: a credit the chain condemned -- a
  -- token that does not exist, or one its owner has sealed -- was re-offered
  -- every single night, refused every night, and logged every night as
  -- "stays queued". `mints` and `mark_orders` both had a terminal state for
  -- exactly this and `credits` did not.
  --
  -- Note what is NOT terminal: a day the chain already holds. That is the
  -- mirror being behind, and it is marked 'written' by the Clock's heal path,
  -- not failed. See healDayNotAdvanced in src/clock/batch.mjs.
  status  TEXT NOT NULL DEFAULT 'queued'
);
CREATE UNIQUE INDEX IF NOT EXISTS credits_token_day ON credits (tokenId, day);

CREATE TABLE IF NOT EXISTS mark_orders (
  tokenId   INTEGER NOT NULL,
  upgradeId INTEGER NOT NULL,
  variant   INTEGER NOT NULL DEFAULT 0,   -- the Iris shape or the Tint ink; 0 for every other Mark
  paymentTx TEXT,
  -- The EIP-3009 nonce of the authorisation that is paying for this row, and
  -- when the row was reserved. NULL on both for the four EARNED Marks, which
  -- take no payment at all and are therefore queued outright. See `status`.
  payNonce   TEXT,
  reservedAt INTEGER,
  -- awaiting-payment | queued | written | failed.
  --
  -- 'awaiting-payment' is where a BOUGHT Mark starts. The `authorization` flow
  -- settles only after the tool handler returns, so at the moment this row is
  -- written the money has NOT moved and may never move -- the authorisation can
  -- be cancelled or expire mid-handler. Only the settlement hook promotes it to
  -- 'queued', which is the only status the Clock writes on chain. An
  -- 'awaiting-payment' row older than the reservation window is dead and is
  -- cleared by the next reservation that needs its slot.
  --
  -- 'failed' is the terminal state for an order the chain refused on
  -- simulation: the same call against the same state will be refused every
  -- night, so retrying it is noise and the row waits for a human instead. It is
  -- deliberately NOT deleted -- the unique index below is what stops a second
  -- reservation of the same Mark, and a Mark the chain refused should stay
  -- refused until somebody has looked at it.
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
  -- The settlement receipt. NULL until the payment has actually landed, which
  -- is what separates a reservation from a sale.
  paymentTx TEXT,
  -- The EIP-3009 nonce of the authorisation paying for this mint, and when the
  -- row was reserved. Every mint is paid for, so unlike mark_orders these are
  -- never NULL on a row this service wrote.
  payNonce   TEXT,
  reservedAt INTEGER,
  qr        TEXT,                            -- the solved bitmap, hex; NULL until solved
  solveState TEXT NOT NULL DEFAULT 'pending', -- pending | solving | done | failed
  solveTries INTEGER NOT NULL DEFAULT 0,
  -- awaiting-payment | queued | written. Same meaning as in mark_orders above:
  -- a mint is reserved before settlement is attempted and only promoted to
  -- 'queued' when the money has actually moved.
  status    TEXT NOT NULL DEFAULT 'queued'
);

-- One mint per key. Same reasoning as mark_orders above: two settlements from
-- the same key can both pass the pre-payment hasMinted check, so the index is
-- what actually stops a second token from being recorded.
CREATE UNIQUE INDEX IF NOT EXISTS mints_key ON mints (keyId);
