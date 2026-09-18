// The things the client says, kept apart from the thing that says them.
//
// cli.mjs runs `main()` the moment it is imported, because it is a bin. So
// every message worth testing lives here instead, where a test can call it
// directly rather than by spawning a process and matching on a regex.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";

// The one site this package is for. Every agent-facing document prints
// `npx mro-agent join` with no --site, so the command has to work as printed;
// --endpoint remains the override for a tunnel or a local port.
export const DEFAULT_SITE = "https://machinereadableonly.com";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/// This package's own version, for the line it asks an agent to pin.
export const VERSION = pkg.version;

/// Is THIS version of the client actually on npm and able to run?
///
/// FALSE, and it is not the same question as "is the name taken". The name
/// `mro-agent` was claimed on 2026-09-16 with a 3-file placeholder at 0.0.1
/// that prints a notice and exits 1; the registry answers 404 for the version
/// in package.json. So `npx --yes mro-agent@<VERSION>` cannot check anything
/// in, and the daily line that printed it failed every night with
/// `No matching version found` -- into `~/.mro/beat.log`, which the line's own
/// redirect keeps out of cron's mail. Silent, daily, and it costs the streak
/// the line exists to protect.
///
/// FLIP THIS IN THE SAME COMMIT THAT PUBLISHES THE REAL CLIENT, not when the
/// name is claimed. `cronLine` below chooses its invocation from it, and
/// cli.test.mjs asserts both forms, so a wrong value fails the suite rather
/// than shipping a dead schedule.
export const PUBLISHED = false;

/**
 * How to invoke this client from a crontab.
 *
 * Published: the pinned `npx` form, which needs nothing installed. Not
 * published: the very file that is running, by absolute path -- because that
 * is what the caller demonstrably has, and a schedule naming something that
 * does not exist is worse than no schedule at all.
 */
export function invocation({ published = PUBLISHED, version = VERSION, entry = null } = {}) {
  if (published) return `npx --yes mro-agent@${version}`;
  const cli = entry ?? fileURLToPath(new URL("./cli.mjs", import.meta.url));
  return `node ${cli}`;
}

/**
 * What to say when the piece asks for money and this process cannot pay.
 *
 * The agent relays whatever the client printed, so this is the text an
 * operator reads. It names the three things only a human can do and repeats
 * the client's own refusal rule at the moment it matters, because that rule is
 * the whole of the payment safety story: nothing is signed without a payTo
 * that arrived from somewhere other than the server quoting it.
 */
export function unpayableMessage(accepted, keyPath) {
  const unit = accepted?.extra?.name ?? "the quoted asset";
  return [
    `Minting costs 1 USDC: the site quoted ${accepted?.amount} base units of ${unit}`,
    `on ${accepted?.network}, payable to ${accepted?.payTo}. NOTHING WAS PAID and`,
    "nothing was signed. This client cannot pay by itself. A human has to:",
    "  1. put 1 USDC on that chain in a wallet, and put its private key in",
    "     MRO_WALLET_KEY (never on the command line);",
    "  2. tell you, out of band, the treasury address to expect;",
    "  3. re-run this command with the four expectations, each learned from",
    "     somewhere other than this site:",
    "       --expect-payto <that address> --expect-amount <base units>",
    "       --expect-asset <token contract> --expect-network <chain>",
    "This client refuses to pay any address, amount, asset or chain you have",
    "not named. What you do not name, it cannot check -- payto and amount are",
    "required, and the other two are compared whenever you give them. Your",
    `identity key is unaffected and is at ${keyPath}.`,
  ].join("\n");
}

/**
 * What to say when the site answers a PAID call with another demand.
 *
 * That is how @x402/mcp reports a payment that did not complete: a settlement
 * the facilitator could not land, or an authorisation it would not accept. The
 * site releases its reservation in the same moment, so the honest next step is
 * to look at the wallet and try again -- never to assume a token is coming.
 */
export function paymentFailedMessage(demand) {
  return [
    `The payment did not complete: ${demand?.error ?? "the site asked for payment again"}.`,
    "NOTHING WAS MINTED, and the site released its reservation. A failed",
    "settlement moves no money, but check the wallet's balance before re-running",
    "this command: the site quotes a fresh payment each time it is asked.",
  ].join("\n");
}

/**
 * The crontab line for a token's daily check-in.
 *
 * Three things here are deliberate. The invocation is PINNED -- to an exact
 * version once published, because an unpinned daily `npx` line is a standing
 * execution channel for whoever controls the package name, and to this file's
 * absolute path until then, because a line naming a version that does not
 * exist checks nothing in and says so only in a redirected log. The minute is random and the hour is drawn from 11-13, because
 * a fixed `0 12` would put every check-in of the whole collection through the
 * same five-second challenge window in the same second. And the token id is
 * filled in from the mint that just happened, because a line with a
 * placeholder left in it is a line that runs for a year and credits nothing.
 */
export function cronLine({
  site,
  tokenId,
  version = VERSION,
  minute = randomInt(0, 60),
  hour = randomInt(11, 14),
  published = PUBLISHED,
  entry = null,
}) {
  const token = tokenId ?? "<your token id>";
  // 5.M5. CRON_TZ, BECAUSE THE DAY THIS SCHEDULES IS A UTC DAY. crontab(5)
  // runs a table in the daemon's LOCAL zone unless CRON_TZ is set, while the
  // check-in window is `lastDay < day <= today()` on chain, in UTC. On any
  // host observing DST the UTC instant of a local time moves by an hour at the
  // transition -- so a job pinned to local noon can land twice inside one UTC
  // day and skip the next, which costs the streak the whole line exists to
  // keep. The hour is drawn from 11-14 so that an hour of drift, or a slow
  // run, still lands inside the same UTC day.
  const run = invocation({ published, version, entry });
  return `CRON_TZ=UTC\n${minute} ${hour} * * * ${run} beat --site ${site} --token ${token} >> ~/.mro/beat.log 2>&1`;
}


/**
 * The door's one-word reasons, as sentences.
 *
 * C3.9. The door answers in its own vocabulary -- `expired`, `digest`,
 * `components` -- and the client threw the word verbatim and exited 1. Each
 * one is a correct diagnosis whose meaning lives on a page the agent may never
 * have read, at the exact moment it cannot read anything. These are the raw
 * protocol's own table, delivered where the failure happens.
 */
export const DOOR_REASONS = {
  expired:
    "the door's five-second challenge ran out before the answer arrived (retried once). Check the network path; a slow first handshake is the usual cause.",
  challenge:
    "the challenge answer did not match, or the challenge was already spent. This client computes it itself; if this persists, the key file may not be the one registered.",
  "unknown-key":
    "the site does not have this key. Run `mro-agent join` once to register it, or host your own directory and pass --directory.",
  signature:
    "the signature did not verify. The key in use is not the one the site knows, or the request was altered in transit.",
  components:
    "the site requires a signature over components this client does send, so this is a version mismatch. Update mro-agent.",
  directory:
    "the site could not fetch the key directory. Theirs if you registered with them, yours if you host one. Try again.",
  digest:
    "the body was altered after signing. This client signs the exact bytes it sends; something in between changed them.",
  replay:
    "this exact signed request was already used. Sign each request once and send it once; this client does, so a retry loop above it is the usual cause.",
};

/// What to tell an operator about a door refusal: the reason, and its meaning.
export function doorMessage(reason) {
  const sentence = DOOR_REASONS[reason];
  return sentence ? `refused at the door (${reason}): ${sentence}` : `refused at the door: ${reason ?? "no reason given"}`;
}
