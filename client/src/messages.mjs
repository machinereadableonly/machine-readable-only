// The things the client says, kept apart from the thing that says them.
//
// cli.mjs runs `main()` the moment it is imported, because it is a bin. So
// every message worth testing lives here instead, where a test can call it
// directly rather than by spawning a process and matching on a regex.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";

// The one site this package is for. Every agent-facing document prints
// `npx mro-agent join` with no --site, so the command has to work as printed;
// --endpoint remains the override for a tunnel or a local port.
export const DEFAULT_SITE = "https://machinereadableonly.com";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/// This package's own version, for the line it asks an agent to pin.
export const VERSION = pkg.version;

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
    "  3. re-run this command with --expect-payto <that address>.",
    "This client refuses to pay any other address, amount or asset. Your",
    `identity key is unaffected and is at ${keyPath}.`,
  ].join("\n");
}

/**
 * The crontab line for a token's daily check-in.
 *
 * Three things here are deliberate. The version is PINNED, because an unpinned
 * daily `npx` line is a standing execution channel for whoever controls the
 * package name. The minute is random and the hour is drawn from 11-13, because
 * a fixed `0 12` would put every check-in of the whole collection through the
 * same five-second challenge window in the same second. And the token id is
 * filled in from the mint that just happened, because a line with a
 * placeholder left in it is a line that runs for a year and credits nothing.
 */
export function cronLine({ site, tokenId, version = VERSION, minute = randomInt(0, 60), hour = randomInt(11, 14) }) {
  const token = tokenId ?? "<your token id>";
  return `${minute} ${hour} * * * npx --yes mro-agent@${version} beat --site ${site} --token ${token} >> ~/.mro/beat.log 2>&1`;
}
