// Which mirror a maintenance tool acts on. Never a relative default: since the
// Clock cutover the live mirror is /var/lib/mro/state.db, and a tool that fell
// back to ./state.db would act on a stale copy and report success.
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const WARDEN_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * `given` if it is an absolute path; else STATE_DB_PATH from the Warden's
 * settings file, which must itself be absolute. Only that one key is read.
 */
export function liveDbPath(given, settingsFile = join(WARDEN_DIR, ".env")) {
  if (given !== undefined) {
    if (!isAbsolute(given)) throw new Error(`name the mirror by its absolute path, not ${given}`);
    return given;
  }
  let text;
  try {
    text = readFileSync(settingsFile, "utf8");
  } catch {
    throw new Error("no mirror path given and the Warden's settings could not be read; pass the absolute path");
  }
  const lines = text.split("\n").filter((l) => /^STATE_DB_PATH=/.test(l.trim()));
  const value = lines.at(-1)?.trim().slice("STATE_DB_PATH=".length).replace(/^["']|["']$/g, "");
  if (!value || !isAbsolute(value)) {
    throw new Error("the Warden's STATE_DB_PATH is not an absolute path; pass the mirror's absolute path");
  }
  return value;
}
