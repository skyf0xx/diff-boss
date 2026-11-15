import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Skill } from "../contract/ports";

export const SKILL_REFERENCE_FILES = ["PLAN.md", "STAGES.md", "WRITING.md"] as const;

export class SkillLoadError extends Error {
  override readonly name = "SkillLoadError";
  constructor(
    message: string,
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

async function readRequired(path: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const why = code === "ENOENT" ? "is missing" : `could not be read (${code ?? String(err)})`;
    throw new SkillLoadError(`Skill file ${path} ${why}`, path, { cause: err });
  }
  if (text.trim().length === 0) {
    throw new SkillLoadError(`Skill file ${path} is empty`, path);
  }
  return text;
}

/** Loads `<dir>/SKILL.md` and `<dir>/references/{PLAN,STAGES,WRITING}.md`. */
export async function loadSkill(dir: string): Promise<Skill> {
  const body = await readRequired(join(dir, "SKILL.md"));
  const references: Record<string, string> = {};
  for (const name of SKILL_REFERENCE_FILES) {
    references[name] = await readRequired(join(dir, "references", name));
  }
  return { body, references };
}
