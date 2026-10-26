import { prettifyError } from "zod";
import type { ChatMessage, LlmProvider, Usage } from "../llm/types";
import type { LearnerContext } from "./context";
import type { SkillRegistry } from "./registry";
import { renderSystem, renderTask } from "./render";
import type { BaseSkillId, SkillOutput, SkillVars } from "./schemas";

export type SkillRunnerDeps = {
  registry: SkillRegistry;
  /** The user's provider; production passes `(id) => resolveProvider(deps, id)`. */
  provider: (userId: number) => Promise<LlmProvider>;
  /** The learner's context; production passes `learnerContextFromDb(db)`. */
  learner: (userId: number) => Promise<LearnerContext>;
};

export type SkillRun<T> = { data: T; usage?: Usage };

/** The caller passed vars that do not match the skill's input schema. A bug, not a model error. */
export class SkillInputError extends Error {
  override name = "SkillInputError";
  constructor(
    readonly skillId: string,
    readonly issues: string,
  ) {
    super(`invalid vars for skill "${skillId}": ${issues}`);
  }
}

/**
 * Earlier turns must alternate user/assistant, start with the user and end with the assistant:
 * the skill's own user message comes next, and providers reject two user turns in a row.
 */
function checkHistory(skillId: string, history: ChatMessage[]) {
  history.forEach((message, index) => {
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (message.role !== expected) {
      throw new SkillInputError(skillId, `history[${index}] must be a ${expected} turn`);
    }
  });
  if (history.length % 2 !== 0) {
    throw new SkillInputError(skillId, "history must end with an assistant turn");
  }
}

export class SkillRunner {
  constructor(private readonly deps: SkillRunnerDeps) {}

  /**
   * Runs one skill for one user: validates `vars`, builds the learner context, renders the system
   * prompt (server-owned values only) and the task message (learner data as JSON), and asks the
   * user's provider for output that passes the skill's schema. Learner text never reaches the
   * system prompt. Provider errors (`LlmOutputError`, `LlmProviderError`, …) propagate unchanged.
   */
  async runSkill<Id extends BaseSkillId>(
    userId: number,
    skillId: Id,
    vars: SkillVars<Id>,
    history?: ChatMessage[],
  ): Promise<SkillRun<SkillOutput<Id>>>;
  async runSkill(
    userId: number,
    skillId: string,
    vars: Record<string, unknown>,
    history?: ChatMessage[],
  ): Promise<SkillRun<Record<string, unknown>>>;
  async runSkill(
    userId: number,
    skillId: string,
    vars: Record<string, unknown>,
    history: ChatMessage[] = [],
  ): Promise<SkillRun<Record<string, unknown>>> {
    const skill = this.deps.registry.get(skillId);
    const parsed = skill.input.safeParse(vars);
    if (!parsed.success) throw new SkillInputError(skillId, prettifyError(parsed.error));
    checkHistory(skillId, history);

    const [learner, provider] = await Promise.all([
      this.deps.learner(userId),
      this.deps.provider(userId),
    ]);

    return provider.complete({
      system: renderSystem(skill.body, learner),
      messages: [...history, { role: "user", content: renderTask(learner, parsed.data) }],
      schema: skill.output,
      tier: skill.tier,
      temperature: skill.temperature,
      maxTokens: skill.maxTokens,
    });
  }
}
