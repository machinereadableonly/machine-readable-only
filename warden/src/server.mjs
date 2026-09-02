// The Warden. One process, four kinds of request.
//
// This service holds NO private key. It reads the chain and writes a local
// SQLite file; the chain writes belong to the Clock (Plan 3).
import { createServer as createHttpServer } from "node:http";
import { writeFileSync } from "node:fs";
import { openDb } from "./mirror/db.mjs";
import { queries } from "./mirror/queries.mjs";
import { admit, sweepSeen, pinnedUrl } from "./door/middleware.mjs";
import { issueChallenge, verifyNonceMinted } from "./door/challenge.mjs";
import { makeLookup, guardedFetchDirectory, renderDirectory, registerRoute } from "./door/directory.mjs";
// tokenView and the MCP handler are NOT imported: they belong to Tasks 6 and 7
// and arrive through config, so this router is runnable the day it is written.

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

/// Marks a rejection from readBody as "the body was too big" rather than some
/// other stream failure, so the caller can answer with the right reason.
class BodyTooLargeError extends Error {}

/**
 * Read a request body, refusing anything over `cap`.
 *
 * Checked WHILE reading, not after: buffering an unbounded body and measuring
 * it afterward means the oversized body is already sitting in memory by the
 * time it gets refused. Same shape as the cap in guardedFetchDirectory.
 *
 * On overflow this does NOT destroy the socket itself -- it only stops
 * listening and rejects. Destroying here, before the caller has written a
 * response, sent the caller ECONNRESET instead of the 400 this code means to
 * send. The caller answers first, then ends, then may cut the connection.
 */
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > cap) {
        cleanup();
        return reject(new BodyTooLargeError("body too large"));
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/**
 * Build the Warden's HTTP server.
 *
 * `config.tokenView(q, tokenId)` and `config.mcp.nodeHandler(req, res, keyId)`
 * are supplied by the caller rather than imported here: neither module exists
 * yet in this repo (Task 6 builds the token view, Task 7 builds the MCP
 * handler), and importing a path that does not exist would make this module
 * fail to load at all. `config.allowRegistration` is REQUIRED: it is the rate
 * limit on the one unsigned write path this service has (POST /keys), and a
 * default of always-allow would leave that path unlimited.
 * `config.directoryPath`, if given, is where the served JWKS is rewritten
 * after a successful key registration.
 */
export function createServer(config) {
  if (typeof config.allowRegistration !== "function") {
    throw new Error("config.allowRegistration is required");
  }

  const db = openDb(config.stateDbPath);
  const q = queries(db);
  const seen = new Set();
  const lookupKey = makeLookup(q, guardedFetchDirectory, config.domain);
  const allowRegistration = config.allowRegistration;

  setInterval(() => sweepSeen(seen), 10_000).unref();

  return createHttpServer(async (req, res) => {
    try {
      // The SAME reduction the signature check uses, so the path the router
      // dispatches on and the authority the signature is checked against can
      // never come apart. Node passes the request target through verbatim,
      // and a target can carry its own authority ("//evil.example/mcp",
      // "http://evil.example/mcp") that a plain `new URL(req.url, base)`
      // would let win over the configured domain.
      //
      // A target that will not parse at all is the CALLER's mistake, so it is
      // a 400 here and not a 500 from the catch below. Confirmed not a bypass
      // -- "//evil.example%2fmcp" throws before anything dispatches or
      // verifies -- but the catch logged a line per request, which made a
      // malformed target a free unauthenticated way to flood the log.
      let path;
      try {
        path = pinnedUrl(req.url, config.domain).pathname;
      } catch {
        return json(res, 400, { ok: false, reason: "target" });
      }

      // Case 1: the QR's destination. Public, unsigned, JSON only. Gating this
      // would mean a scanned token leads nowhere, which is the one distribution
      // surface the artwork has.
      if (req.method === "GET" && path.startsWith("/t/")) {
        // Strict decimal only. Number() accepts "0x1" (aliasing /t/0x1 to
        // token 1) and "" (becoming token 0), so a route-shaped string that
        // is not plain decimal digits is refused before it ever reaches
        // tokenView.
        const raw = path.slice(3);
        if (!/^[0-9]+$/.test(raw)) return json(res, 404, { ok: false, reason: "unknown-token" });
        const view = config.tokenView(q, Number(raw));
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
        let raw;
        try {
          raw = await readBody(req, 64 * 1024);
        } catch (err) {
          // Answer FIRST, end, THEN cut the connection -- destroying it
          // before responding is what turned this into an ECONNRESET.
          json(res, 400, { ok: false, reason: err instanceof BodyTooLargeError ? "too-large" : "body" });
          req.destroy();
          return;
        }

        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { ok: false, reason: "malformed" });
        }
        // registerRoute destructures { jwk, nonce, proof } off this. A null
        // body throws there; a number, string or array body destructures to
        // all-undefined fields and is refused by registerRoute's own checks
        // -- but neither of those is the 400 an obviously malformed body
        // deserves, so it is refused here, before registerRoute ever sees it.
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return json(res, 400, { ok: false, reason: "malformed" });
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
      //
      // THE BODY IS READ HERE, BEFORE THE DOOR, because the signature is bound
      // to it by content-digest and the door cannot check a digest against
      // bytes it has not seen. That consumes the stream, so the raw text is
      // handed on to the MCP adapter, which reads it again from a replay.
      let raw;
      try {
        raw = await readBody(req, 64 * 1024);
      } catch (err) {
        json(res, 400, { ok: false, reason: err instanceof BodyTooLargeError ? "too-large" : "body" });
        req.destroy();
        return;
      }

      const decision = await admit(req, {
        secret: config.challengeSecret, lookupKey, seen, domain: config.domain, body: raw,
      });
      if (!decision.ok) return json(res, decision.status, decision.body);

      // `return await`, not a bare `return`. A bare return hands the promise
      // back OUTSIDE this try, so a rejecting handler becomes an unhandled
      // rejection -- which under Node's default takes the process down and
      // leaves the caller hanging rather than getting the 500 below.
      if (path === "/mcp") return await config.mcp.nodeHandler(req, res, decision.keyId, decision.sigHash, raw);

      return json(res, 404, { ok: false, reason: "unknown-route" });
    } catch (err) {
      // Log server-side; never leak internals to a caller.
      console.error("warden request failed:", err.message);
      return json(res, 500, { ok: false, reason: "internal" });
    }
  });
}
