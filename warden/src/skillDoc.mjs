// The skill served at /skill.md is the repository's own SKILL.md, read in place
// so the served file and the published skill cannot drift.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SKILL_PATH = fileURLToPath(new URL("../../skills/machine-readable-only/SKILL.md", import.meta.url));

export const readSkill = () => readFileSync(SKILL_PATH, "utf8");
