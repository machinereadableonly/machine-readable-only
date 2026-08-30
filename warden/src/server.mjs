// The Warden. One process, four kinds of request.
//
// This service holds NO private key. It reads the chain and writes a local
// SQLite file; the chain writes belong to the Clock (Plan 3).
import { createServer as createHttpServer } from "node:http";
import { writeFileSync } from "node:fs";
import { openDb } from "./mirror/db.mjs";
import { queries } from "./mirror/queries.mjs";
import { admit, sweepSeen } from "./door/middleware.mjs";
import { issueChallenge, verifyNonceMinted } from "./door/challenge.mjs";
import { makeLookup, guardedFetchDirectory, renderDirectory, registerRoute } from "./door/directory.mjs";

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

/**
 * Read a request body, refusing anything over `cap`.
 *
 * Checked WHILE reading, not after: buffering an unbounded body and measuring
 * it afterward means the oversized body is already sitting in memory by the
 * time it gets refused. Same shape as the cap in guardedFetchDirectory.
 */
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > cap) {
        req.destroy();
        return reject(new Error("body too large"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Build the Warden's HTTP server.
 *
 * `config.tokenView(q, tokenId)` and `config.mcp.nodeHandler(req, res, keyId)`
 * are supplied by the caller rather than imported here: neither module exists
 * yet in this repo (Task 6 builds the token view, Task 7 builds the MCP
 * handler), and importing a path that does not exist would make this module
 * fail to load at all. `config.allowRegistration` is an optional rate-limit
 * decision for POST /keys; it defaults to always-allow when the caller does
 * not supply one. `config.directoryPath`, if given, is where the served JWKS
 * is rewritten after a successful key registration.
 */
export function createServer(config) {
  const db = openDb(config.stateDbPath);
  const q = queries(db);
  const seen = new Set();
  const lookupKey = makeLookup(q, guardedFetchDirectory, config.domain);
  const allowRegistration = config.allowRegistration ?? (() => true);

  setInterval(() => sweepSeen(seen), 10_000).unref();

  return createHttpServer(async (req, res) => {
    try {
      const path = new URL(req.url, `https://${config.domain}`).pathname;

      // Case 1: the QR's destination. Public, unsigned, JSON only. Gating this
      // would mean a scanned token leads nowhere, which is the one distribution
      // surface the artwork has.
      if (req.method === "GET" && path.startsWith("/t/")) {
        const view = config.tokenView(q, Number(path.slice(3)));
        return view ? json(res, 200, view) : json(res, 404, { ok: false, reason: "unknown-token" });
      }

      // The served key directory. Also public: a directory nobody can read is
      // not a directory.
      if (req.method === "GET" && path === "/.well-known/http-message-signatures-directory") {
        res.writeHead(200, { "content-type": "application/http-message-signatures-directory+json" });
        return res.end(renderDirectory(q));
      }

      // The nonce a POST /keys proof signs. Public by necessity: it is issued
      // BEFORE a caller has any key registered here to sign with.
      if (req.method === "GET" && path === "/keys/nonce") {
        const { challenge, expires } = issueChallenge(config.challengeSecret);
        return json(res, 200, { nonce: challenge, expires });
      }

      // Case 2: POST /keys, the easy path in for agents with no domain of
      // their own. Unsigned by necessity -- registering is how a caller
      // becomes able to sign at all -- but never unproved: the body carries a
      // signature over a nonce this server issued, checked inside
      // registerRoute.
      if (req.method === "POST" && path === "/keys") {
        let body;
        try {
          body = JSON.parse(await readBody(req, 64 * 1024));
        } catch {
          return json(res, 400, { ok: false, reason: "body" });
        }
        const result = await registerRoute(
          q,
          body,
          allowRegistration,
          // Same minting-and-spending machinery as the entry challenge, so
          // there is one nonce mechanism in this service rather than two.
          (nonce) => {
            if (!verifyNonceMinted(config.challengeSecret, nonce).ok) return false;
            if (seen.has(nonce)) return false;
            seen.add(nonce);
            return true;
          }
        );
        if (result.ok && config.directoryPath) {
          writeFileSync(config.directoryPath, renderDirectory(q));
        }
        // Only "rate-limited" is a 429. A bad or replayed nonce and an
        // invalid proof are the caller's own mistake, not a rate limit, so
        // they get 400.
        const status = result.ok ? 201 : result.reason === "rate-limited" ? 429 : 400;
        return json(res, status, result);
      }

      // Cases 3 and 4: everything else needs a signature and a challenge answer.
      const decision = await admit(req, { secret: config.challengeSecret, lookupKey, seen, domain: config.domain });
      if (!decision.ok) return json(res, decision.status, decision.body);

      if (path === "/mcp") return config.mcp.nodeHandler(req, res, decision.keyId);

      return json(res, 404, { ok: false, reason: "unknown-route" });
    } catch (err) {
      // Log server-side; never leak internals to a caller.
      console.error("warden request failed:", err.message);
      return json(res, 500, { ok: false, reason: "internal" });
    }
  });
}
