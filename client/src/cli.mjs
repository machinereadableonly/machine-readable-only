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
import { payFor } from "./pay.mjs";

const USAGE = `mro-agent -- the reference client for Machine Readable Only

  mro-agent whoami                     show this agent's key id
  mro-agent join   --site <origin>     register a key and mint one token
  mro-agent beat   --site <origin>     check in for today
  mro-agent status --site <origin>     read your tokens

Options
  --site <origin>      the site to talk to, e.g. https://example.com
  --endpoint <origin>  where to actually send, if not the site itself. The
                       SITE is what gets signed; use this for a tunnel, a
                       staging host, or a local port.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help") { console.log(USAGE); return; }

  const keyPath = args.key ?? defaultKeyPath();

  if (command === "whoami") {
    const identity = loadIdentity(keyPath);
    if (!identity) { console.log(`no identity at ${keyPath}. Run: mro-agent join --site <origin>`); return; }
    out("key id", identity.keyId);
    out("file", keyPath);
    return;
  }

  // `site` is the public origin and is what the signature covers; `endpoint`
  // is where the bytes go. They are the same in ordinary use, which is why
  // endpoint defaults to site. See door.mjs for why they must be separable.
  const site = args.site;
  if (!site) throw new Error("--site is required");
  const origin = args.endpoint ?? site;

  const { identity, created } = await ensureIdentity(keyPath);
  if (created) out("generated a new identity at", keyPath);
  out("key id", identity.keyId);

  const call = { origin, site, privateJwk: identity.privateJwk };

  if (command === "join") {
    if (!args.to) throw new Error("--to <0xaddress> is required: it is who the token will belong to");

    // Registration is idempotent from the caller's side -- an already-known
    // key simply registers again -- so this is safe to re-run.
    await registerKey({ origin, privateJwk: identity.privateJwk });
    out("registered with", site);
    out("tools", (await listTools(call)).map((t) => t.name));

    let result = await callTool({ ...call, name: "mint", arguments: { to: args.to } });

    // The paid path. Nothing is signed unless an expected payTo was given.
    const walletKey = process.env.MRO_WALLET_KEY ?? args["wallet-key"];
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
    out("mint", structured(result) ?? result);

    if (args.cron) {
      console.log("\nAdd this to your crontab to check in daily near 12:00 UTC:");
      console.log(`0 12 * * * mro-agent beat --site ${site} --token <id> >> ~/.mro/beat.log 2>&1`);
    }
    return;
  }

  if (command === "beat") {
    if (!args.token) throw new Error("--token <id> is required");
    const result = await callTool({ ...call, name: "checkin", arguments: { tokenId: Number(args.token) } });
    out("checkin", structured(result) ?? result);
    return;
  }

  if (command === "status") {
    const result = await callTool({ ...call, name: "status", arguments: args.token ? { tokenId: Number(args.token) } : {} });
    out("status", structured(result) ?? result);
    return;
  }

  throw new Error(`unknown command: ${command}\n\n${USAGE}`);
}

main().catch((err) => {
  console.error(`mro-agent: ${err.message}`);
  process.exit(1);
});
