import type { SkillOutput, SkillRunner } from "../skills";
import type { QuizItem } from "./state";

export type Severity = NonNullable<SkillOutput<"grammar-check">["severity"]>;
type MistakeCategory = NonNullable<SkillOutput<"grammar-check">["category"]>;

/** What the server decided about one answer. The model only suggested the parts it graded. */
export type Graded = {
  correct: boolean;
  verdict: "correct" | "partial" | "wrong";
  /** The answer to show as right. */
  correctForm: string;
  explanation: string;
  /** Null when correct, and for multiple choice (there is nothing to grade the slip on). */
  severity: Severity | null;
  /** What to count in `mistakes`; null when correct. */
  mistake: {
    category: MistakeCategory;
    pattern: string;
    exampleWrong: string;
    exampleRight: string;
  } | null;
};

/** Case, surrounding spaces, inner whitespace and a closing full stop do not make an answer wrong. */
export function normaliseAnswer(answer: string): string {
  return answer
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
}

export function matchesAccepted(answer: string, accepted: readonly string[]): boolean {
  const given = normaliseAnswer(answer);
  return given !== "" && accepted.some((candidate) => normaliseAnswer(candidate) === given);
}

/** Shows an option or answer in its sentence when the question has a gap. */
function inSentence(question: string, filler: string): string {
  return question.includes("___") ? question.replace("___", filler) : `${question} → ${filler}`;
}

/** Multiple choice is graded by the server alone: `correct_index` is the truth. */
export function gradeChoice(item: QuizItem, chosen: number): Graded {
  const options = item.options ?? [];
  const rightIndex = item.correct_index ?? -1;
  const right = options[rightIndex] ?? item.accepted_answers[0] ?? "";
  if (chosen === rightIndex) {
    return {
      correct: true,
      verdict: "correct",
      correctForm: right,
      explanation: item.explanation,
      severity: null,
      mistake: null,
    };
  }
  return {
    correct: false,
    verdict: "wrong",
    correctForm: right,
    explanation: item.explanation,
    severity: null,
    mistake: {
      category: "grammar",
      pattern: item.topic,
      exampleWrong: inSentence(item.question, options[chosen] ?? ""),
      exampleRight: inSentence(item.question, right),
    },
  };
}

/**
 * Grades a typed answer: an exact match with an accepted answer is correct without asking the
 * model; anything else goes to `grammar-check`. `partial` is not a pass, but it is shown as such.
 * Provider errors propagate; the caller keeps the question open.
 */
export async function gradeTyped(
  skills: SkillRunner,
  userId: number,
  item: QuizItem,
  answer: string,
): Promise<Graded> {
  if (item.type === "multiple_choice")
    throw new Error("a multiple-choice item has no typed answer");

  if (matchesAccepted(answer, item.accepted_answers)) {
    return {
      correct: true,
      verdict: "correct",
      correctForm: answer.trim(),
      explanation: item.explanation,
      severity: null,
      mistake: null,
    };
  }

  const { data } = await skills.runSkill(userId, "grammar-check", {
    type: item.type,
    question: item.question,
    instruction: item.instruction,
    accepted_answers: item.accepted_answers,
    learner_answer: answer,
  });
  if (data.verdict === "correct") {
    return {
      correct: true,
      verdict: "correct",
      correctForm: data.normalized_answer,
      explanation: data.explanation,
      severity: null,
      mistake: null,
    };
  }
  return {
    correct: false,
    verdict: data.verdict,
    correctForm: data.normalized_answer,
    explanation: data.explanation,
    severity: data.severity,
    // The schema guarantees both are set unless the verdict is correct.
    mistake:
      data.category && data.pattern
        ? {
            category: data.category,
            pattern: data.pattern,
            exampleWrong: answer.trim(),
            exampleRight: data.normalized_answer,
          }
        : null,
  };
}
