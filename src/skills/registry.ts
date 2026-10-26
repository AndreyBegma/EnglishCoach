import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { prettifyError, type ZodObject, z } from "zod";
import type { ModelTier } from "../llm/types";
import { unknownPlaceholders } from "./render";
import {
  BASE_SKILLS,
  type InputSchemaName,
  inputSchemas,
  type OutputSchemaName,
  outputSchemas,
} from "./schemas";

export const DEFAULT_SKILLS_DIR = join(import.meta.dir, "../../skills");

export const skillKinds = [
  "quiz",
  "check",
  "enrich",
  "exercise",
  "placement",
  "conversation",
  "plan",
] as const;

const frontmatterSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case"),
  title: z.string().trim().min(1),
  kind: z.enum(skillKinds),
  input: z.string(),
  output: z.string(),
  model_hint: z.enum(["fast", "smart"]),
  temperature: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
});

export type SkillDefinition = {
  id: string;
  title: string;
  kind: (typeof skillKinds)[number];
  inputName: InputSchemaName;
  outputName: OutputSchemaName;
  input: ZodObject;
  output: ZodObject;
  tier: ModelTier;
  temperature?: number;
  maxTokens?: number;
  /** The system prompt template, placeholders unfilled. */
  body: string;
  /** Where it was loaded from, for error messages. */
  file: string;
};

/** A skill file that cannot be used. The message starts with the file. */
export class SkillDefinitionError extends Error {
  override name = "SkillDefinitionError";
}

export class UnknownSkillError extends Error {
  override name = "UnknownSkillError";
  constructor(readonly skillId: string) {
    super(`unknown skill "${skillId}"`);
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function hasKey<T extends object>(map: T, key: string): key is Extract<keyof T, string> {
  return Object.hasOwn(map, key);
}

/**
 * Parses and validates one SKILL.md. `file` is used in messages; `dirName`, when given, must equal
 * the frontmatter id. Throws a `SkillDefinitionError` listing every problem found.
 */
export function parseSkill(source: string, file: string, dirName?: string): SkillDefinition {
  const fail = (problems: string[]) => new SkillDefinitionError(`${file}: ${problems.join("; ")}`);

  const match = source.match(FRONTMATTER);
  if (!match) throw fail(["missing YAML frontmatter between --- lines"]);
  const [, yaml = "", rawBody = ""] = match;

  let raw: unknown;
  try {
    raw = Bun.YAML.parse(yaml);
  } catch (error) {
    throw fail([`frontmatter is not valid YAML (${(error as Error).message})`]);
  }
  const parsed = frontmatterSchema.safeParse(raw);
  if (!parsed.success) throw fail([`bad frontmatter: ${prettifyError(parsed.error)}`]);
  const meta = parsed.data;

  const problems: string[] = [];
  const body = rawBody.trim();
  if (!body) problems.push("empty prompt body");
  if (dirName !== undefined && dirName !== meta.id) {
    problems.push(`id "${meta.id}" does not match its directory "${dirName}"`);
  }
  const inputName = hasKey(inputSchemas, meta.input) ? meta.input : undefined;
  const outputName = hasKey(outputSchemas, meta.output) ? meta.output : undefined;
  if (!inputName) problems.push(`unknown input schema "${meta.input}"`);
  if (!outputName) problems.push(`unknown output schema "${meta.output}"`);
  if (hasKey(BASE_SKILLS, meta.id)) {
    const expected = BASE_SKILLS[meta.id];
    if (meta.input !== expected.input || meta.output !== expected.output) {
      problems.push(
        `base skill "${meta.id}" must use ${expected.input} -> ${expected.output}, not ${meta.input} -> ${meta.output}`,
      );
    }
  }
  const unknown = unknownPlaceholders(body);
  if (unknown.length > 0) {
    problems.push(`unknown placeholder(s) ${unknown.map((name) => `{{${name}}}`).join(", ")}`);
  }
  if (problems.length > 0 || !inputName || !outputName) throw fail(problems);

  return {
    id: meta.id,
    title: meta.title,
    kind: meta.kind,
    inputName,
    outputName,
    input: inputSchemas[inputName],
    output: outputSchemas[outputName],
    tier: meta.model_hint,
    temperature: meta.temperature,
    maxTokens: meta.max_tokens,
    body,
    file,
  };
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  constructor(skills: Iterable<SkillDefinition>) {
    for (const skill of skills) {
      const existing = this.skills.get(skill.id);
      if (existing) {
        throw new SkillDefinitionError(
          `${skill.file}: duplicate id "${skill.id}" (also ${existing.file})`,
        );
      }
      this.skills.set(skill.id, skill);
    }
  }

  get(id: string): SkillDefinition {
    const skill = this.skills.get(id);
    if (!skill) throw new UnknownSkillError(id);
    return skill;
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  ids(): string[] {
    return [...this.skills.keys()].sort();
  }
}

export type LoadOptions = {
  /** Skill ids that must exist. Defaults to every base skill the code calls. */
  required?: readonly string[];
};

/**
 * Loads `<dir>/<id>/SKILL.md` for every subdirectory. Meant to run once at boot: any invalid file,
 * or a missing required skill, throws one `SkillDefinitionError` naming every bad file.
 */
export function loadSkillRegistry(
  dir: string = DEFAULT_SKILLS_DIR,
  options: LoadOptions = {},
): SkillRegistry {
  const required = options.required ?? Object.keys(BASE_SKILLS);
  const skills: SkillDefinition[] = [];
  const errors: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, "SKILL.md");
    const file = relative(process.cwd(), path) || path;
    if (!existsSync(path)) {
      errors.push(`${file}: missing`);
      continue;
    }
    try {
      skills.push(parseSkill(readFileSync(path, "utf8"), file, entry.name));
    } catch (error) {
      if (!(error instanceof SkillDefinitionError)) throw error;
      errors.push(error.message);
    }
  }

  const loaded = new Set(skills.map((skill) => skill.id));
  for (const id of required) {
    if (!loaded.has(id)) {
      errors.push(`${join(dir, id, "SKILL.md")}: required skill "${id}" is missing`);
    }
  }
  if (errors.length > 0) throw new SkillDefinitionError(errors.join("\n"));

  return new SkillRegistry(skills);
}
