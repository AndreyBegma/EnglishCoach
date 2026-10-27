import type { Db } from "../../src/db/client";
import type { CompletionRequest, LlmProvider } from "../../src/llm/types";
import {
  ExampleCheckOutput,
  learnerContextFromDb,
  loadSkillRegistry,
  SkillRunner,
  VocabCheckOutput,
  VocabEnrichBatchOutput,
  VocabEnrichOutput,
  VocabExerciseOutput,
} from "../../src/skills";

type Task = {
  lemma: string;
  mode?: VocabMode;
  particle?: string | null;
  partner?: string | null;
  target_form?: { pos: string; form: string } | null;
};
type VocabMode =
  | "recognition"
  | "production"
  | "cloze"
  | "particle"
  | "partner"
  | "transform"
  | "own_sentence";

/** A `vocab-exercise` answer for the lexical-unit modes, built from the server's facts. */
function unitExercise(mode: VocabMode, task: Task) {
  const typed = { options: null, correct_index: null };
  switch (mode) {
    case "particle": {
      const particle = task.particle ?? "up";
      const options = [particle, ...["off", "away", "over", "in"].filter((p) => p !== particle)];
      return {
        mode,
        instruction: "Pick the particle.",
        prompt: `She ___ (${task.lemma}).`,
        options: options.slice(0, 4),
        correct_index: 0,
        accepted_answers: [particle],
      };
    }
    case "partner":
      return {
        mode,
        instruction: "Fill in the missing word.",
        prompt: `We need to ___ … (${task.lemma})`,
        ...typed,
        accepted_answers: [task.partner ?? task.lemma],
      };
    case "transform":
      return {
        mode,
        instruction: "Change the word.",
        prompt: `It was a hard ___. (${task.lemma.toUpperCase()})`,
        ...typed,
        accepted_answers: [task.target_form?.form ?? task.lemma],
      };
    case "own_sentence":
      return {
        mode,
        instruction: "Write your own sentence.",
        prompt: `Use "${task.lemma}" in a sentence about your job.`,
        ...typed,
        accepted_answers: [task.lemma],
      };
    default:
      return undefined;
  }
}

/** The `<task>` JSON of the skill call's last user message. */
function taskOf(req: CompletionRequest<unknown>): Task {
  const content = req.messages.at(-1)?.content ?? "";
  const json = content.split("<task>\n")[1]?.split("\n</task>")[0] ?? "{}";
  return JSON.parse(json) as Task;
}

/** The words of a `vocab-enrich-batch` call. */
function batchTask(req: CompletionRequest<unknown>): { id: number; lemma: string }[] {
  return (taskOf(req) as unknown as { words: { id: number; lemma: string }[] }).words;
}

export const meaningOf = (lemma: string) => `meaning of ${lemma}`;

/**
 * A provider for the vocabulary skills that answers from the task: enrichment and exercises are
 * derived from the lemma, so the tests know what the bot will show. `checks` is the queue of
 * `vocab-check` verdicts. `calls` counts each skill.
 */
export function vocabSkills(db: Db) {
  const calls = { enrich: 0, exercise: 0, check: 0 };
  /** `vocab-enrich-batch` calls and the words they carried (the prefetch job's skill). */
  const batch = { calls: 0, words: 0 };
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
            image_query: `${task.lemma} scene`,
            emoji: null,
          }),
        };
      }
      if (skill === VocabExerciseOutput) {
        calls.exercise++;
        const mode = task.mode ?? "recognition";
        const options = [meaningOf(task.lemma), "wrong one", "wrong two", "wrong three"];
        const unit = unitExercise(mode, task);
        if (unit) return { data: req.schema.parse(unit) };
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
      if (skill === VocabEnrichBatchOutput) {
        batch.calls++;
        batch.words += batchTask(req as CompletionRequest<unknown>).length;
        return {
          data: req.schema.parse({
            cards: batchTask(req as CompletionRequest<unknown>).map((word) => ({
              id: word.id,
              translation: `${word.lemma}-cached`,
              ipa: `/${word.lemma}-model/`,
              pos: "verb",
              examples: [
                { en: `Model sentence one with ${word.lemma}.`, translation: "first translated" },
                { en: `Model sentence two with ${word.lemma}.`, translation: "second translated" },
              ],
              collocations: [`${word.lemma} a`, `${word.lemma} b`, `${word.lemma} c`],
              mnemonic: `Cached hook for ${word.lemma}.`,
              image_query: `${word.lemma} picture`,
              emoji: null,
            })),
          }),
        };
      }
      if (skill === ExampleCheckOutput) {
        // The validation pass after enrichment: every model example passes here.
        const items = (taskOf(req as CompletionRequest<unknown>) as unknown as { items: unknown[] })
          .items;
        return {
          data: req.schema.parse({
            results: items.map((_, index) => ({ index, ok: true, problem: null })),
          }),
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
  return { skills, provider, calls, batch, checks, failure };
}
