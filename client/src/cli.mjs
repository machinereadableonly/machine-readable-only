#!/usr/bin/env node
// mro-agent: join, beat, status, whoami.
//
// Every command prints what it is about to do and what came back. Nothing here
// runs on a schedule by itself and nothing installs anything without being
// asked -- `join --cron` prints the crontab line for you to install rather
// than editing your crontab, because a package that edits your scheduler
// because you ran it once is not a package that deserved to be run.
import { ensureIdentity, loadIdentity, defaultKeyPath } from "./keys.mjs";
import { registerKey } from "./door.mjs";
import { listTools, callTool, structured } from "./mcp.mjs";
import { payFor, readDemand } from "./pay.mjs";
import { DEFAULT_SITE, cronLine, unpayableMessage } from "./messages.mjs";

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
  --expect-amount <n>  the amount in base units you were told to expect
  --wallet-key <0x>    a wallet private key, for paying. Prefer MRO_WALLET_KEY.
  --cron               print a crontab line instead of installing one
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const name = a.slice(2);
    if (name === "cron") { args.cron = true; continue; }
    args[name] = argv[++i];
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
  if (!command || command === "help") { console.log(USAGE); return; }
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
    const walletKey = process.env.MRO_WALLET_KEY ?? args["wallet-key"];
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
          expected: { payTo: args["expect-payto"], amount: args["expect-amount"] },
        })
      : null;

    if (meta) {
      out("paying", meta["x402/payment"].accepted);
      result = await callTool({ ...call, name: "mint", arguments: { to: args.to }, _meta: meta });
    }
    const minted = structured(result);
    out("mint", minted ?? result);

    if (args.cron) printCron(site, minted?.ok ? minted.tokenId : undefined);
    return;
  }

  if (command === "beat") {
    if (!args.token) throw new Error("--token <id> is required");
    const result = await callTool({ ...call, name: "checkin", arguments: { tokenId: Number(args.token) } });
    out("checkin", structured(result) ?? result);
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
    out(command, structured(result) ?? result);
    return;
  }

  // status
  const result = await callTool({ ...call, name: "status", arguments: args.token ? { tokenId: Number(args.token) } : {} });
  out("status", structured(result) ?? result);
}

main().catch((err) => {
  console.error(`mro-agent: ${err.message}`);
  process.exit(1);
});
