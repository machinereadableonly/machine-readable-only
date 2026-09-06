/**
 * Error text that is safe to write to a log file.
 *
 * 16.10. The Clock's log is appended to by systemd and read by a human the
 * morning after a bad night, so it must carry enough to diagnose the failure
 * and nothing that is worth stealing. The one thing in it worth stealing is the
 * RPC endpoint: `BASE_RPC_URL` is free-form configuration, and every managed
 * provider puts its API key IN THE URL -- `contracts/.env.example:33` records
 * the Alchemy shape, `https://base-mainnet.g.alchemy.com/v2/<key>`, where the
 * key is a path segment.
 *
 * MEASURED on the installed viem 2.56.0, against all four ways an RPC call
 * fails -- connection refused, HTTP 401, a JSON-RPC error object, and a timeout:
 *
 *   err.shortMessage  never contains the url  ("HTTP request failed.")
 *   err.message       ALWAYS contains the url, in full
 *
 * viem composes `message` from [shortMessage, ...metaMessages, details] and the
 * url lives in `metaMessages`. So the leak is not in any one call site's
 * wording; it is in `err.message` itself, and any code that logs a viem error's
 * message leaks the endpoint whether or not it means to.
 *
 * The redaction keeps the origin, because "which host failed" is the first
 * question at 00:05 and the host is not the secret. Everything after it goes.
 */

/// A url anywhere in free text. The terminators are the characters viem and
/// Node put around a url when they interpolate one into a message.
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)\]}]+/gi;

/**
 * Every url in `text` reduced to its origin.
 *
 * A url with nothing after the host is already safe and is left exactly as it
 * is, so the common case -- `https://sepolia.base.org` -- reads normally.
 * Credentials in the AUTHORITY (`https://user:pass@host`) are dropped too:
 * `URL.host` excludes userinfo by construction.
 */
export function redactUrls(text) {
  return String(text).replace(URL_IN_TEXT, (match) => {
    let url;
    try {
      url = new URL(match);
    } catch {
      // Not parseable, so nothing can be preserved safely: drop all of it.
      return "<redacted-url>";
    }
    const bare = url.pathname === "/" && !url.search && !url.username && !url.password;
    // `match` rather than `url.href` for the bare case: href normalises
    // `http://host` to `http://host/`, and the log should read as written.
    return bare ? match : `${url.protocol}//${url.host}/<redacted>`;
  });
}

/**
 * The line to log for `err`.
 *
 * Prefers viem's `shortMessage`, which is the one-sentence cause without the
 * request dump. Falls back to `message` for a plain Error -- which is why the
 * redaction is applied to BOTH and not only to the fallback: a non-viem error
 * (an undici cause, a fetch wrapper, a future library) can carry a url too.
 *
 * The 300-character cap is what `write.mjs` has always applied, kept so a
 * multi-kilobyte provider error cannot flood an unrotated log.
 */
export function safeErrorText(err, limit = 300) {
  return redactUrls(String(err?.shortMessage ?? err?.message ?? err)).slice(0, limit);
}
