// The Warden. One process, four kinds of request.
//
// This service holds NO private key. It reads the chain and writes a local
// SQLite file; the chain writes belong to the Clock (Plan 3).
import { createServer as createHttpServer } from "node:http";
import { writeFileSync } from "node:fs";
import { openDb } from "./mirror/db.mjs";
import { queries } from "./mirror/queries.mjs";
import { admit, sweepSeen, sweepSpent, pinnedUrl } from "./door/middleware.mjs";
import { issueChallenge, verifyNonceMinted } from "./door/challenge.mjs";
import { UNUSED_KEY_TTL_MS } from "./bootstrap.mjs";
import { makeLookup, guardedFetchDirectory, makeDirectoryCache, registerRoute } from "./door/directory.mjs";
// tokenLinks, but NOT tokenView. The view stays injected -- see the note below
// -- while the links are a pure function of configuration this module already
// holds, and one definition of them is what keeps /t/<id> and `status` saying
// the same thing.
import { tokenLinks } from "./mcp/tokenView.mjs";
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
 *
 * `config.contract` and `config.chainId` are REQUIRED, and they are here for
 * one reason: /t/<id> is the QR's destination and it must carry the handles a
 * scanner needs to verify the token against the chain instead of against us.
 * Building the links HERE rather than at the call site is deliberate -- the
 * first version wrapped tokenView in main.mjs, which main.mjs alone could get
 * right, and main.mjs is the one module the tests cannot import. A required
 * argument cannot be silently forgotten.
 */
export function createServer(config) {
  if (typeof config.allowRegistration !== "function") {
    throw new Error("config.allowRegistration is required");
  }
  if (!config.contract || !config.chainId) {
    throw new Error("config.contract and config.chainId are required: /t/<id> publishes them");
  }
  const links = tokenLinks(config);

  const db = openDb(config.stateDbPath);
  const q = queries(db);
  const seen = new Set();
  // Spent SIGNATURES, kept apart from spent challenges: a challenge is dead in
  // five seconds, a signature can live five minutes, and one set swept on the
  // shorter schedule would forget signatures while they were still replayable.
  // sigHash -> the signature's own expiry, in ms.
  const spent = new Map();
  const lookupKey = makeLookup(q, guardedFetchDirectory, config.domain);
  const allowRegistration = config.allowRegistration;
  // Rendered once per CHANGE, not once per read. The route below is public,
  // unsigned and unmetered, and re-rendering every key on every GET was the
  // cheapest way to load this process from the outside.
  const directory = makeDirectoryCache(q);

  setInterval(() => sweepSeen(seen), 10_000).unref();
  setInterval(() => sweepSpent(spent), 30_000).unref();

  // Forget keys that registered and never came through the door. Without this
  // the 10,000-key ceiling is reached once and the only entrance for an agent
  // with no domain of its own is shut permanently -- no eviction, no expiry, no
  // operator route in the code. Hourly is far more often than a 30-day window
  // needs; it costs one indexed DELETE and means a flood clears on its own
  // rather than waiting for a restart.
  const prunedDirectory = () => {
    const gone = q.pruneUnusedKeys(Date.now() - UNUSED_KEY_TTL_MS);
    if (gone > 0) {
      // The served directory listed them, so it is now wrong.
      directory.invalidate();
      console.log(`warden: forgot ${gone} key(s) registered but never used`);
    }
  };
  setInterval(prunedDirectory, 60 * 60 * 1000).unref();

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
        const view = config.tokenView(q, Number(raw), links);
        return view ? json(res, 200, view) : json(res, 404, { ok: false, reason: "unknown-token" });
      }

      // Case 1b: the two public documents -- the door page and the
      // instructions. Served from this process rather than by nginx from
      // disk, because nginx runs as www-data and the repository sits under a
      // 0750 home directory it cannot traverse; the alternative was a copy
      // under /srv that drifts from the repository. Public and unsigned for
      // the same reason /t/ is: an agent that has not been admitted yet is
      // exactly who needs to read them.
      if (req.method === "GET" && (path === "/" || path === "/llms.txt")) {
        const isDoor = path === "/";
        const body = isDoor ? config.doorHtml : config.llmsTxt;
        // A Warden wired without the documents 404s them rather than throwing
        // on every request to "/", which would take the whole door down.
        if (typeof body !== "string") return json(res, 404, { ok: false, reason: "not-found" });
        res.writeHead(200, {
          "content-type": isDoor ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        });
        return res.end(body);
      }

      // Case 1c: the two documents llms.txt names and tells agents are not
      // built yet. It says both "404", so they must actually 404 -- while
      // nginx served the static routes with try_files that was true for free,
      // and it stopped being true the moment this process took the routes
      // over. 401 would also be the wrong answer on its own terms: it invites
      // a caller to sign and retry, and no signature produces a file that does
      // not exist. Only these two named paths are answered this way; anything
      // else unknown stays gated, so the door is not a map of what exists.
      if (req.method === "GET" && (path === "/client.mjs" || path === "/skill.md")) {
        return json(res, 404, { ok: false, reason: "not-built-yet" });
      }

      // The served key directory. Also public: a directory nobody can read is
      // not a directory.
      if (req.method === "GET" && path === "/.well-known/http-message-signatures-directory") {
        const doc = directory.current();
        // A conditional GET costs no body. The directory changes only when a
        // key registers, so a caller that polls it is asking the same question
        // over and over and can be told "still the same" for free.
        if (req.headers["if-none-match"] === doc.etag) {
          res.writeHead(304, { etag: doc.etag });
          return res.end();
        }
        res.writeHead(200, {
          "content-type": "application/http-message-signatures-directory+json",
          "content-length": Buffer.byteLength(doc.body),
          etag: doc.etag,
        });
        return res.end(doc.body);
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
        if (result.ok) {
          // The table changed, so the remembered copy is stale. Invalidate
          // FIRST, then reuse the one re-render for the file on disk -- the
          // old code rendered the whole directory again for that write.
          directory.invalidate();
          if (config.directoryPath) writeFileSync(config.directoryPath, directory.current().body);
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
        secret: config.challengeSecret, lookupKey, seen, spent, domain: config.domain, body: raw,
      });
      if (!decision.ok) return json(res, decision.status, decision.body);

      // This key is in use, so it is never a candidate for the prune above.
      // Throttled to one write a day inside the query itself.
      q.markKeyUsed(decision.keyId);

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
