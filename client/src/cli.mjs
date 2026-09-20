#!/usr/bin/env node
// mro-agent: join, beat, status, whoami.
//
// Every command prints what it is about to do and what came back. Nothing here
// runs on a schedule by itself and nothing installs anything without being
// asked -- `join --cron` prints the crontab line for you to install rather
// than editing your crontab, because a package that edits your scheduler
// because you ran it once is not a package that deserved to be run.
import { statSync, readFileSync } from "node:fs";
import { ensureIdentity, loadIdentity, defaultKeyPath } from "./keys.mjs";
import { registerKey } from "./door.mjs";
import { listTools, callTool, structured } from "./mcp.mjs";
import { payFor, readDemand } from "./pay.mjs";
import { DEFAULT_SITE, cronLine, unpayableMessage, paymentFailedMessage, lostResponseMessage } from "./messages.mjs";

// The commands that exist. Checked BEFORE an identity key is created, because
// creating a signing key as a side effect of a typo is not something a package
// gets to do.
const COMMANDS = ["join", "beat", "status", "whoami", "ladder", "rebind", "rest"];

const USAGE = `mro-agent -- the reference client for Machine Readable Only

  mro-agent whoami                     show this agent's key id
  mro-agent join   --to <0xaddress>    register a key and mint one token
  mro-agent beat   --token <id>        check in for today
  mro-agent status                     read your tokens
  mro-agent ladder --token <id>        the five Mark pairs: held, closed, open
  mro-agent rebind --token <id>        the call to point a token at a new key
  mro-agent rest   --token <id>        the call that seals a token FOREVER

ladder, rebind and rest are free here, and none of them acts: rebind and rest
return a call for the token OWNER's wallet to send. This client never sends
one, and holds no wallet that could.

Options
  --site <origin>      the site to talk to (default ${DEFAULT_SITE})
  --endpoint <origin>  where to actually send, if not the site itself. The
                       SITE is what gets signed; use this for a tunnel, a
                       staging host, or a local port.
  --directory <origin> host your own JWKS there and skip registration. Your
                       key is then never stored by the site.
  --key <path>         identity file (default ${defaultKeyPath("~")})
  --to <0xaddress>     who the minted token belongs to (join)
  --token <id>         which token (beat)
  --expect-payto <0x>  the treasury you were told to expect. REQUIRED to pay.
  --expect-amount <n>  the amount in base units you were told to expect. REQUIRED to pay.
  --expect-asset <0x>  the token contract you were told to expect
  --expect-network <s> the chain you were told to expect, e.g. eip155:8453
  --wallet-key-file <p> a file holding the wallet private key, for paying.
                       Must not be readable by anyone else (mode 0600/0400).
                       MRO_WALLET_KEY in the environment is preferred still.
  --expect-chain <id>  the chain id you expect, e.g. 8453. Checked before anything is done
  --expect-contract <0x> the contract you expect. Checked before anything is done
  --cron               print a crontab line instead of installing one
`;

// EVERY FLAG THIS CLIENT ACCEPTS. A typo used to be swallowed: parseArgs
// stored whatever it was given and nothing checked the set, so `--expct-amount
// 1000000` silently removed the guard it was written to add. Most typos fail
// closed -- a misspelt `--expect-payto` leaves expected.payTo undefined and the
// client refuses to pay -- but the amount guard just disappeared, with no
// output saying so, and that is the one flag where silence costs money.
//
// Unknown COMMANDS have always thrown (see COMMANDS above). This is the same
// rule for flags.
const FLAGS = [
  "site", "endpoint", "directory", "key", "to", "token",
  "expect-payto", "expect-amount", "expect-asset", "expect-network",
  "expect-chain", "expect-contract", "wallet-key-file",
];
// `--help` takes no value and is the one flag that works with no command at
// all; `help` as a bare command does the same thing (see main).
const BOOLEAN_FLAGS = ["cron", "help"];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const name = a.slice(2);
    if (BOOLEAN_FLAGS.includes(name)) { args[name] = true; continue; }
    if (!FLAGS.includes(name)) {
      throw new Error(`unknown option --${name}. Run mro-agent with no arguments for the list.`);
    }
    // A flag with nothing after it would otherwise store undefined and read as
    // "not given", which is the silent failure again one step along.
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    args[name] = value;
  }
  return args;
}

const out = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);

/// Print the check-in line, filled in when there is a token and honest when
/// there is not. Printed on the unpaid path too: an operator who asked for the
/// line still needs it, and needs to know why the id is missing.
function printCron(site, tokenId) {
  console.log("\nPaste this into `crontab -e`. The version is pinned on purpose;");
  console.log("when you change it, read what changed first.");
  console.log(cronLine({ site, tokenId }));
  if (tokenId === undefined) {
    console.log("Nothing was minted on this run, so fill the id in yourself once there is one.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help" || args.help) { console.log(USAGE); return; }
  if (!COMMANDS.includes(command)) throw new Error(`unknown command: ${command}\n\n${USAGE}`);

  const keyPath = args.key ?? defaultKeyPath();

  if (command === "whoami") {
    const identity = loadIdentity(keyPath);
    if (!identity) { console.log(`no identity at ${keyPath}. Run: mro-agent join --to <0xaddress>`); return; }
    out("key id", identity.keyId);
    out("file", keyPath);
    return;
  }

  // `site` is the public origin and is what the signature covers; `endpoint`
  // is where the bytes go. They are the same in ordinary use, which is why
  // endpoint defaults to site. See door.mjs for why they must be separable.
  const site = args.site ?? DEFAULT_SITE;
  const origin = args.endpoint ?? site;

  const { identity, created } = await ensureIdentity(keyPath);
  if (created) {
    console.log(`generated a new identity at ${keyPath} (mode 600).`);
    console.log("Back this file up now. It is the only thing that can grow your token:");
    console.log("a lost key does not lose the token, but the token's OWNER wallet must");
    console.log("then call rebind(tokenId, newKeyId) on chain, and no day is credited");
    console.log("until it does.");
  }
  out("key id", identity.keyId);

  // With --directory, the site never holds this key: it fetches the public
  // half from a JWKS the agent hosts. Registration is skipped entirely, which
  // is the difference between the two paths and the reason the flag exists --
  // a registration cannot be undone.
  const signatureAgent = args.directory ?? site;
  // The door allows five seconds. Printing what it took is the smallest honest
  // way to let the piece's one theatrical rule be felt -- and on the run that
  // takes 5.2 seconds it is the difference between a mystery and a diagnosis.
  const onTiming = (ms, allowed) => console.error(`answered the door's challenge in ${ms} ms (it allows ${allowed})`);
  const call = { origin, site, signatureAgent, privateJwk: identity.privateJwk, onTiming };

  // BEFORE ANYTHING ELSE, including registration and any payment: a chain or
  // contract that is not the one the operator expected must stop the run, not
  // be adapted to. Costs one free `status` call, and only when asked for.
  await assertChain(call, { chain: args["expect-chain"], contract: args["expect-contract"] });

  if (command === "join") {
    if (!args.to) throw new Error("--to <0xaddress> is required: it is who the token will belong to");

    if (args.directory) {
      out("using your own directory at", args.directory);
      console.log("Nothing was registered. Serve your public JWK from");
      console.log(`${args.directory}/.well-known/http-message-signatures-directory`);
    } else {
      // Registration is idempotent from the caller's side -- an already-known
      // key simply registers again -- so this is safe to re-run.
      await registerKey({ origin, privateJwk: identity.privateJwk });
      out("registered with", site);
    }
    out("tools", (await listTools(call)).map((t) => t.name));

    let result = await callTool({ ...call, name: "mint", arguments: { to: args.to } });

    // The paid path. Nothing is signed unless an expected payTo was given.
    const walletKey = process.env.MRO_WALLET_KEY ?? readWalletKeyFile(args["wallet-key-file"]);
    const demand = readDemand(result);

    // The one step of the journey an agent cannot take alone. Say so in words
    // the agent can relay, rather than printing the raw 402 and exiting 0.
    if (demand && !walletKey) {
      console.log(`\n${unpayableMessage(demand.accepts?.[0], keyPath)}`);
      if (args.cron) printCron(site, undefined);
      process.exitCode = 2;
      return;
    }

    const meta = walletKey
      ? await payFor({
          result,
          walletPrivateKey: walletKey,
          // ALL FOUR FIELDS. `asset` and `network` had no flags at all, so
          // they could not be pinned through this binary at any price: the
          // signed authorisation could name any ERC-20 on any chain, as long
          // as the destination matched. An omitted flag stays undefined and is
          // simply not compared, so nothing that worked before changes.
          expected: {
            payTo: args["expect-payto"],
            amount: args["expect-amount"],
            asset: args["expect-asset"],
            network: args["expect-network"],
          },
        })
      : null;

    if (meta) {
      out("paying", meta["x402/payment"].accepted);
      // A LOST ANSWER IS NOT A REFUSAL. If this throws, the settlement may
      // already have happened on chain and the token may already exist -- the
      // response simply never arrived. Rethrowing into main().catch printed a
      // bare transport error and exited 1, which reads as "it did not happen"
      // and invites paying a second time. Say what to check instead.
      try {
        result = await callTool({ ...call, name: "mint", arguments: { to: args.to }, _meta: meta });
      } catch (err) {
        console.error(`mro-agent: ${err.message}`);
        console.log(`\n${lostResponseMessage(site)}`);
        process.exitCode = 2;
        return;
      }

      // A PAID call answered with a demand is a payment that did not complete.
      // @x402/mcp answers a failed settlement with the same payment-required
      // result, the facilitator's reason in `error` -- and with no `ok` field,
      // so report() alone let it exit 0. On 2026-09-11 that made a mint that
      // never happened look like success to anything reading the exit status.
      const failed = readDemand(result);
      if (failed) {
        out("mint", failed);
        console.log(`\n${paymentFailedMessage(failed)}`);
        process.exitCode = 2;
        return;
      }
    }
    const minted = report("mint", result);

    if (args.cron) printCron(site, minted?.ok ? minted.tokenId : undefined);
    return;
  }

  if (command === "beat") {
    if (!args.token) throw new Error("--token <id> is required");
    const result = await callTool({ ...call, name: "checkin", arguments: { tokenId: Number(args.token) } });
    report("checkin", result);
    return;
  }

  if (command === "ladder" || command === "rebind" || command === "rest") {
    if (!args.token) throw new Error(`--token <id> is required for ${command}`);
    if (command === "rest") {
      console.log("`rest` returns a call that SEALS the token permanently. Nothing is sent");
      console.log("by this client; the token OWNER's wallet has to send it, and it cannot");
      console.log("be undone.");
    }
    const result = await callTool({ ...call, name: command, arguments: { tokenId: Number(args.token) } });
    report(command, result);
    return;
  }

  // status
  const result = await callTool({ ...call, name: "status", arguments: args.token ? { tokenId: Number(args.token) } : {} });
  report("status", result);
}

/**
 * Print a tool's answer, and make a refusal visible to whatever is WATCHING.
 *
 * 5.M6. Every command printed its refusal and returned normally, so the process
 * exited 0: `beat` on an already-credited day, on a token bound to another key,
 * on a paused or sunset contract, on an unreachable RPC. This client's own
 * documented deployment is a cron job, and cron reports failure by exit status
 * -- so an agent whose streak was quietly breaking looked healthy to every
 * supervisor watching it. This is the command a participant runs 365 times.
 *
 * 2, not 1: a thrown error already exits 1, and "the site refused this" is a
 * different thing from "the client could not run".
 */
/**
 * Read a wallet private key from a file, refusing one anybody else can read.
 *
 * WHY THERE IS NO `--wallet-key <0x>` ANY MORE. Every argument a process is
 * started with is world-readable in `/proc/<pid>/cmdline` and prints in `ps`
 * for every user on the box -- and it lands in shell history besides. That is
 * a funded wallet's private key, which cannot be rotated out of somebody
 * else's screenshot. The environment variable and this file are both ordinary
 * and neither is visible to a bystander.
 */
function readWalletKeyFile(path) {
  if (!path) return undefined;
  const mode = statSync(path).mode & 0o077;
  if (mode !== 0) {
    throw new Error(
      `refusing to read ${path}: it is readable by others (mode ${(statSync(path).mode & 0o777).toString(8)}). ` +
        `Run: chmod 600 ${path}`
    );
  }
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`refusing to use ${path}: it does not hold a 32-byte hex private key`);
  }
  return key;
}

/**
 * Hard-fail on a chain or contract that is not the one you expected.
 *
 * llms.txt has always said "every tool answers with the chain id it is
 * actually running on, and the client should hard-fail on any mismatch with
 * what it expected rather than adapting to it" -- and the client had no way to
 * express an expectation at all. `status` is free and unpaid, so this costs one
 * round trip and runs BEFORE anything is minted or paid for.
 */
async function assertChain(call, { chain, contract }) {
  if (!chain && !contract) return;
  const view = structured(await callTool({ ...call, name: "status", arguments: {} }));
  const actual = { chain: String(view?.chainId ?? ""), contract: String(view?.contract ?? "") };

  if (chain && actual.chain !== String(chain)) {
    throw new Error(`refusing to continue: the site is on chain ${actual.chain || "(not stated)"}, expected ${chain}`);
  }
  if (contract && actual.contract.toLowerCase() !== String(contract).toLowerCase()) {
    throw new Error(
      `refusing to continue: the site's contract is ${actual.contract || "(not stated)"}, expected ${contract}`
    );
  }
  out("chain", actual);
}

function report(label, result) {
  const value = structured(result) ?? result;
  out(label, value);
  if (value?.ok === false) process.exitCode = 2;
  return value;
}

main().catch((err) => {
  console.error(`mro-agent: ${err.message}`);
  process.exit(1);
});
