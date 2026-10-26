import type { Db } from "../../src/db/client";
import type { CompletionRequest, LlmProvider } from "../../src/llm/types";
import {
  learnerContextFromDb,
  loadSkillRegistry,
  SkillRunner,
  VocabCheckOutput,
  VocabEnrichOutput,
  VocabExerciseOutput,
} from "../../src/skills";

type Task = { lemma: string; mode?: "recognition" | "production" | "cloze" };

/** The `<task>` JSON of the skill call's last user message. */
function taskOf(req: CompletionRequest<unknown>): Task {
  const content = req.messages.at(-1)?.content ?? "";
  const json = content.split("<task>\n")[1]?.split("\n</task>")[0] ?? "{}";
  return JSON.parse(json) as Task;
}

export const meaningOf = (lemma: string) => `meaning of ${lemma}`;

/**
 * A provider for the vocabulary skills that answers from the task: enrichment and exercises are
 * derived from the lemma, so the tests know what the bot will show. `checks` is the queue of
 * `vocab-check` verdicts. `calls` counts each skill.
 */
export function vocabSkills(db: Db) {
  const calls = { enrich: 0, exercise: 0, check: 0 };
  const checks: unknown[] = [];
  /** Set to make the next model call throw it. */
  const failure: { next?: Error } = {};
  const provider: LlmProvider = {
    kind: "server",
    async complete<T>(req: CompletionRequest<T>) {
      const error = failure.next;
      failure.next = undefined;
      if (error) throw error;
      const task = taskOf(req as CompletionRequest<unknown>);
      // Which skill is calling: the registry hands each skill its output schema object.
      const skill: unknown = req.schema;
      if (skill === VocabEnrichOutput) {
        calls.enrich++;
        return {
          data: req.schema.parse({
            lemma: task.lemma,
            translation: `${task.lemma}-translation`,
            ipa: `/${task.lemma}/`,
            pos: "verb",
            examples: [
              { en: `I ${task.lemma} every day.`, translation: "example one" },
              { en: `They ${task.lemma} together.`, translation: "example two" },
            ],
            collocations: [`${task.lemma} fast`, `${task.lemma} well`, `never ${task.lemma}`],
            mnemonic: `Think of ${task.lemma}.`,
          }),
        };
      }
      if (skill === VocabExerciseOutput) {
        calls.exercise++;
        const mode = task.mode ?? "recognition";
        const options = [meaningOf(task.lemma), "wrong one", "wrong two", "wrong three"];
        return {
          data: req.schema.parse(
            mode === "recognition"
              ? {
                  mode,
                  instruction: "Pick the meaning.",
                  prompt: `I **${task.lemma}** it.`,
                  options,
                  correct_index: 0,
                  accepted_answers: [options[0]],
                }
              : {
                  mode,
                  instruction: "Type the word.",
                  prompt:
                    mode === "cloze"
                      ? "I ___ it."
                      : `${meaningOf(task.lemma)} (${task.lemma.length})`,
                  options: null,
                  correct_index: null,
                  accepted_answers: [task.lemma],
                },
          ),
        };
      }
      if (skill === VocabCheckOutput) {
        calls.check++;
        const next = checks.shift();
        if (next === undefined) throw new Error("no scripted vocab-check verdict left");
        return { data: req.schema.parse(next) };
      }
      throw new Error("unexpected skill call in a vocabulary test");
    },
  };
  const skills = new SkillRunner({
    registry: loadSkillRegistry(),
    provider: async () => provider,
    learner: learnerContextFromDb(db),
  });
  return { skills, calls, checks, failure };
}
