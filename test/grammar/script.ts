import type { Db } from "../../src/db/client";
import type { CompletionRequest, LlmProvider } from "../../src/llm/types";
import { learnerContextFromDb, loadSkillRegistry, SkillRunner } from "../../src/skills";

/**
 * A skill runner over a scripted provider: each model call takes the next entry of `queue`
 * (validated by the skill's output schema, or thrown when it is an Error), and `requests`
 * records what the skills sent.
 */
export function scriptedSkills(db: Db, queue: (unknown | Error)[]) {
  const requests: CompletionRequest<unknown>[] = [];
  const provider: LlmProvider = {
    kind: "server",
    async complete<T>(req: CompletionRequest<T>) {
      requests.push(req as CompletionRequest<unknown>);
      const next = queue.shift();
      if (next === undefined) throw new Error("scripted provider ran out of answers");
      if (next instanceof Error) throw next;
      return { data: req.schema.parse(next) };
    },
  };
  const skills = new SkillRunner({
    registry: loadSkillRegistry(),
    provider: async () => provider,
    learner: learnerContextFromDb(db),
  });
  return { skills, queue, requests };
}

export const choiceItem = (
  topic: string,
  question: string,
  options: string[],
  correct: number,
) => ({
  type: "multiple_choice",
  topic,
  difficulty: "B1",
  instruction: "Choose the correct option.",
  question,
  options,
  correct_index: correct,
  accepted_answers: [options[correct]],
  explanation: `Rule for ${topic}.`,
});

export const typedItem = (
  type: "gap_fill" | "error_correction" | "transformation",
  topic: string,
  question: string,
  accepted: string[],
) => ({
  type,
  topic,
  difficulty: "B1",
  instruction: "Type the answer.",
  question,
  options: null,
  correct_index: null,
  accepted_answers: accepted,
  explanation: `Rule for ${topic}.`,
});

export const wrongCheck = (pattern: string, answer: string) => ({
  verdict: "wrong",
  normalized_answer: answer,
  severity: "moderate",
  category: "grammar",
  pattern,
  explanation: `You broke: ${pattern}.`,
});
