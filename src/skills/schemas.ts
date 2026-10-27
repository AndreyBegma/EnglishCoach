import { z } from "zod";
import { cefrLevelEnum, mistakeCategoryEnum } from "../db/schema/enums";

// Every skill names one input and one output schema from this file in its frontmatter.
// Outputs are root objects with flat, required (nullable) fields: structured-output modes want an
// object at the root (Anthropic's forced-tool fallback needs one as a tool's `input_schema`), and
// flat shapes survive every backend better than unions. Cross-field rules live in `superRefine`,
// and bounds such as `.min()` are only hinted to Anthropic models; neither is enforced by the
// backend, but zod checks both and a violation earns the repair turn.

const cefr = z.enum(cefrLevelEnum.enumValues);
const category = z.enum(mistakeCategoryEnum.enumValues);
const severity = z.enum(["critical", "moderate", "minor"]);
const text = z.string().trim().min(1);
const answers = z.array(text).min(1);
/** Share of correct answers over the learner's recent items; null when there is no history yet. */
const recentAccuracy = z.number().min(0).max(1).nullable();

type Issues = z.core.$RefinementCtx;

function issue(ctx: Issues, path: string, message: string) {
  ctx.addIssue({ code: "custom", path: [path], message });
}

/** Four distinct options, a valid `correct_index`, and that option among the accepted answers. */
function checkChoice(
  value: { options: string[] | null; correct_index: number | null; accepted_answers: string[] },
  ctx: Issues,
) {
  const { options, correct_index: index } = value;
  if (options?.length !== 4) return issue(ctx, "options", "needs exactly 4 options");
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) {
    issue(ctx, "options", "options must be distinct");
  }
  if (index === null || index < 0 || index > 3) {
    return issue(ctx, "correct_index", "must be 0-3");
  }
  if (!value.accepted_answers.includes(options[index] ?? "")) {
    issue(ctx, "accepted_answers", "must contain options[correct_index]");
  }
}

function checkNoChoice(
  value: { options: string[] | null; correct_index: number | null },
  ctx: Issues,
) {
  if (value.options !== null) issue(ctx, "options", "must be null for this type");
  if (value.correct_index !== null) issue(ctx, "correct_index", "must be null for this type");
}

const GAP = "___";

// ---------------------------------------------------------------- grammar-quiz

/** Syllabus topics a model may name, as `{id, title}`; the server picks which. */
const syllabusTopicList = z.array(z.object({ id: text, title: text })).default([]);

/**
 * The syllabus topic id a model names. Only a hint: the server keeps it only when it is a real
 * syllabus id, so a missing or invented one never fails the call.
 */
const syllabusTopicId = z
  .string()
  .nullable()
  .default(null)
  .describe("Id from task.syllabus_topics this is about, e.g. 'g015'; null if none fits");

export const grammarItemType = z.enum([
  "multiple_choice",
  "gap_fill",
  "error_correction",
  "transformation",
]);

export const GrammarQuizInput = z.object({
  recent_accuracy: recentAccuracy,
  /** A topic the server wants practised (a weak spot or the next syllabus point); null = model picks. */
  topic: text.nullable().default(null),
  /** The syllabus entry behind `topic` when the learner picked one; null otherwise. */
  syllabus_topic: z
    .object({
      id: text,
      level: text,
      examples: z.array(text),
      interference: z.array(z.object({ wrong: text, right: text, cause: text })),
    })
    .nullable()
    .default(null),
  /** The item type the server rotated to; null = model picks. */
  item_type: grammarItemType.nullable().default(null),
  /** Topics asked in this session already, to avoid repeating them. */
  recent_topics: z.array(text).default([]),
  /** Syllabus topics around the learner's level, to name the one the item tests. */
  syllabus_topics: syllabusTopicList,
});

export const GrammarQuizOutput = z
  .object({
    type: grammarItemType,
    topic: text.describe("Short English tag, e.g. 'present perfect vs past simple'"),
    topic_id: syllabusTopicId,
    difficulty: cefr,
    instruction: text.describe("What the learner must do, in explain_lang"),
    question: text.describe("The English item; gap_fill marks the gap with ___"),
    options: z.array(text).nullable().describe("Exactly 4 for multiple_choice, else null"),
    correct_index: z.number().int().nullable().describe("0-3 for multiple_choice, else null"),
    accepted_answers: answers.describe("Every answer that must be accepted"),
    explanation: text.describe("Why the answer is right, in explain_lang"),
  })
  .superRefine((value, ctx) => {
    if (value.type === "multiple_choice") checkChoice(value, ctx);
    else checkNoChoice(value, ctx);
    if (value.type === "gap_fill" && !value.question.includes(GAP)) {
      issue(ctx, "question", `gap_fill must mark the gap with ${GAP}`);
    }
  });

// ---------------------------------------------------------------- grammar-check

export const GrammarCheckInput = z.object({
  type: grammarItemType.exclude(["multiple_choice"]),
  question: text,
  instruction: text.nullable().default(null),
  accepted_answers: answers,
  /** What the learner typed. The server has already ruled out an exact match. */
  learner_answer: z.string(),
  /** The syllabus topic the item tests, when known. */
  topic_id: z.string().nullable().default(null),
  /** Syllabus topics around the learner's level, to name the one the error belongs to. */
  syllabus_topics: syllabusTopicList,
});

export const GrammarCheckOutput = z
  .object({
    verdict: z.enum(["correct", "partial", "wrong"]),
    normalized_answer: text.describe("The accepted answer closest to what the learner meant"),
    severity: severity.nullable().describe("null when correct"),
    category: category.nullable().describe("null when correct"),
    pattern: text
      .nullable()
      .describe("Short reusable English label of the error; null when correct"),
    topic_id: syllabusTopicId,
    explanation: text.describe("In explain_lang"),
  })
  .superRefine((value, ctx) => {
    const correct = value.verdict === "correct";
    for (const key of ["severity", "category", "pattern"] as const) {
      if (correct !== (value[key] === null)) {
        issue(ctx, key, correct ? "must be null when correct" : "is required unless correct");
      }
    }
  });

// ---------------------------------------------------------------- vocab-enrich

export const VocabEnrichInput = z.object({
  lemma: text,
  pos: text.nullable().default(null),
  /** The word's CEFR level from the dictionary; null for a learner's own word. */
  word_level: cefr.nullable().default(null),
});

export const VocabEnrichOutput = z.object({
  lemma: text,
  translation: text.describe("In explain_lang; a short English definition when that is English"),
  ipa: z
    .string()
    .regex(/^\/[^/]+\/$/, "IPA between slashes, e.g. /ˈwɔːtə/")
    .describe("General British or American IPA between slashes"),
  pos: text,
  examples: z
    .array(z.object({ en: text, translation: text }))
    .length(2)
    .describe("Two level-appropriate sentences and their translations"),
  collocations: z.array(text).length(3),
  mnemonic: text.describe("In explain_lang"),
  image_query: text
    .max(80)
    .nullable()
    .describe("A short English stock-photo query for the first example's sense; null if abstract"),
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .nullable()
    .describe("One emoji for an abstract word (image_query null), else null"),
});

// ---------------------------------------------------------------- vocab-exercise

/**
 * `recognition` and `particle` are answered with buttons; the rest are typed. `particle` (phrasal
 * verbs), `partner` (collocations), `transform` (word families) and `own_sentence` (phrasal verbs)
 * belong to lexical units; `production` and `cloze` to words and idioms.
 */
export const vocabMode = z.enum([
  "recognition",
  "production",
  "cloze",
  "particle",
  "partner",
  "transform",
  "own_sentence",
]);

/** The modes whose item is a choice of four options. */
export const CHOICE_MODES = ["recognition", "particle"] as const;
/** The typed modes whose prompt is a sentence with a `___` gap. */
const GAP_MODES = ["cloze", "partner", "transform"] as const;

/** What the card is: a word (a learner's own included) or a lexical unit. */
export const vocabItemType = z.enum([
  "word",
  "collocation",
  "phrasal_verb",
  "idiom",
  "word_family",
]);

const familyForm = z.object({ pos: text, form: text });

export const VocabExerciseInput = z.object({
  mode: vocabMode,
  recent_accuracy: recentAccuracy,
  lemma: text,
  pos: text.nullable().default(null),
  translation: text.nullable().default(null),
  examples: z.array(text).default([]),
  /** Same-level words (or units of the same type) the server offers as distractor material. */
  distractors: z.array(text).default([]),
  item_type: vocabItemType.default("word"),
  /** A phrasal verb's verb and particle (`particle` mode tests the particle). */
  verb: text.nullable().default(null),
  particle: text.nullable().default(null),
  /** The collocation word the learner supplies (`partner` mode). */
  partner: text.nullable().default(null),
  /** A word family's forms, and the one `transform` asks for (chosen by the server). */
  forms: z.array(familyForm).default([]),
  target_form: familyForm.nullable().default(null),
});

export const VocabExerciseOutput = z
  .object({
    mode: vocabMode,
    instruction: text.describe("What to do, in explain_lang"),
    prompt: text.describe(
      "What the learner sees; cloze, partner and transform mark the gap with ___",
    ),
    options: z.array(text).nullable().describe("Exactly 4 for recognition and particle, else null"),
    correct_index: z
      .number()
      .int()
      .nullable()
      .describe("0-3 for recognition and particle, else null"),
    accepted_answers: answers,
  })
  .superRefine((value, ctx) => {
    if ((CHOICE_MODES as readonly string[]).includes(value.mode)) checkChoice(value, ctx);
    else checkNoChoice(value, ctx);
    if ((GAP_MODES as readonly string[]).includes(value.mode) && !value.prompt.includes(GAP)) {
      issue(ctx, "prompt", `${value.mode} must mark the gap with ${GAP}`);
    }
    if (value.mode === "own_sentence" && value.prompt.includes(GAP)) {
      issue(ctx, "prompt", "own_sentence asks for a whole sentence, not a gap");
    }
  });

// ---------------------------------------------------------------- vocab-check

export const fsrsRating = z.enum(["again", "hard", "good", "easy"]);

export const VocabCheckInput = z.object({
  mode: vocabMode.exclude(CHOICE_MODES),
  item_type: vocabItemType.default("word"),
  lemma: text,
  prompt: text,
  accepted_answers: answers,
  learner_answer: z.string(),
  /** Seconds from question to answer, measured by the server; null when unknown. */
  response_seconds: z.number().nonnegative().nullable().default(null),
});

export const VocabCheckOutput = z
  .object({
    verdict: z.enum(["correct", "close", "wrong"]),
    accepted_as: z
      .enum(["exact", "synonym", "typo", "inflection"])
      .nullable()
      .describe("How the answer matched; null when wrong"),
    suggested_rating: fsrsRating.describe("A suggestion; the server decides the rating"),
    feedback: text.describe("In explain_lang"),
  })
  .superRefine((value, ctx) => {
    if (value.verdict === "wrong") {
      if (value.accepted_as !== null) issue(ctx, "accepted_as", "must be null when wrong");
      if (value.suggested_rating !== "again") {
        issue(ctx, "suggested_rating", "must be again when wrong");
      }
    } else if (value.accepted_as === null) {
      issue(ctx, "accepted_as", "is required unless wrong");
    }
  });

// ---------------------------------------------------------------- placement-test

export const PLACEMENT_MAX_ITEMS = 15;

export const PlacementTestInput = z.object({
  /** Items answered so far, graded by the server (placement items are multiple choice only). */
  answers: z
    .array(
      z.object({
        level: cefr,
        skill: z.enum(["grammar", "vocabulary", "reading"]),
        topic: text,
        correct: z.boolean(),
      }),
    )
    .max(PLACEMENT_MAX_ITEMS),
  max_items: z.number().int().min(1).max(PLACEMENT_MAX_ITEMS).default(PLACEMENT_MAX_ITEMS),
});

export const PlacementTestOutput = z
  .object({
    status: z.enum(["continue", "final"]),
    estimate: z.object({ level: cefr, confidence: z.number().min(0).max(1) }),
    item: z
      .object({
        level: cefr,
        skill: z.enum(["grammar", "vocabulary", "reading"]),
        topic: text,
        question: text,
        options: z.array(text).length(4),
        correct_index: z.number().int().min(0).max(3),
      })
      .nullable()
      .describe("The next item when status is continue, else null"),
    summary: text.nullable().describe("When final: strengths and gaps in explain_lang, else null"),
  })
  .superRefine((value, ctx) => {
    const final = value.status === "final";
    if (final === (value.item !== null)) {
      issue(ctx, "item", final ? "must be null when final" : "is required when continuing");
    }
    if (final === (value.summary === null)) {
      issue(ctx, "summary", final ? "is required when final" : "must be null when continuing");
    }
    const options = value.item?.options;
    if (options && new Set(options.map((o) => o.toLowerCase())).size !== 4) {
      issue(ctx, "item", "options must be distinct");
    }
  });

// ---------------------------------------------------------------- conversation

export const tipKind = z.enum(["phrase", "grammar", "level_up", "native_pitfall"]);

export const MAX_CORRECTIONS = 5;

export const ConversationInput = z.object({
  topic: text.nullable().default(null),
  learner_message: text,
  /** The tip kind the server rotated to for this turn. */
  tip_kind: tipKind,
  /** Syllabus topics around the learner's level the model may tag as used correctly. */
  syllabus_topics: syllabusTopicList,
});

/** Topics one turn may tag as used correctly; more would be guessing. */
export const MAX_TOPIC_USES = 3;

export const ConversationOutput = z.object({
  reply: text.describe("Natural English reply that keeps the conversation going"),
  corrections: z
    .array(
      z.object({
        original: text.describe("The learner's exact words"),
        corrected: text,
        category,
        severity,
        why: text.describe("One line, in explain_lang"),
      }),
    )
    .max(MAX_CORRECTIONS),
  tip: z.object({ kind: tipKind, text: text.describe("In explain_lang, English examples inline") }),
  /** Only a hint: the server keeps the ids that are in the syllabus and drops the rest. */
  topic_uses: z
    .array(z.string())
    .max(MAX_TOPIC_USES)
    .default([])
    .describe("Ids from task.syllabus_topics the learner's message used correctly"),
});

// ---------------------------------------------------------------- routine-plan

export const RoutinePlanInput = z.object({
  slot: z.enum(["morning", "evening"]),
  due_reviews: z.number().int().nonnegative(),
  new_words: z.number().int().nonnegative(),
  grammar_items: z.number().int().nonnegative(),
  mistakes_to_review: z.number().int().nonnegative(),
  streak_days: z.number().int().nonnegative(),
});

export const RoutinePlanOutput = z.object({
  text: text.max(800).describe("The plan message in ui_lang"),
});

// ---------------------------------------------------------------- vocab-enrich-batch

/** Words per batch call: enough to amortise the prompt, few enough to keep answers reliable. */
export const ENRICH_BATCH_MAX = 20;

export const VocabEnrichBatchInput = z.object({
  words: z
    .array(
      z.object({
        id: z.number().int().positive(),
        lemma: text,
        pos: text.nullable().default(null),
        word_level: cefr.nullable().default(null),
        /** Fields the curated list already has, in explain_lang; the model keeps them. */
        translation: text.nullable().default(null),
        ipa: text.nullable().default(null),
        /** An English sentence that must be the first example. */
        example: text.nullable().default(null),
        /** Human-written examples with translations that follow it, kept unchanged. */
        given_examples: z
          .array(z.object({ en: text, translation: text }))
          .max(2)
          .default([]),
      }),
    )
    .min(1)
    .max(ENRICH_BATCH_MAX),
});

export const VocabEnrichBatchOutput = z.object({
  cards: z
    .array(
      z.object({
        id: z.number().int().describe("The `id` of the word in task.words"),
        translation: VocabEnrichOutput.shape.translation,
        ipa: VocabEnrichOutput.shape.ipa,
        pos: text,
        examples: VocabEnrichOutput.shape.examples,
        collocations: VocabEnrichOutput.shape.collocations,
        mnemonic: VocabEnrichOutput.shape.mnemonic,
        image_query: VocabEnrichOutput.shape.image_query,
        emoji: VocabEnrichOutput.shape.emoji,
      }),
    )
    .describe("One card per word of task.words, same ids"),
});

// ---------------------------------------------------------------- example-check

/** Examples per check call: two per word of a full enrichment batch. */
export const EXAMPLE_CHECK_MAX = 2 * ENRICH_BATCH_MAX;

export const ExampleCheckInput = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        lemma: text,
        pos: text.nullable().default(null),
        /** The card's translation of the word, in explain_lang: the sense the example must show. */
        sense: text,
        en: text,
        translation: text,
      }),
    )
    .min(1)
    .max(EXAMPLE_CHECK_MAX),
});

export const ExampleCheckOutput = z.object({
  results: z
    .array(
      z.object({
        index: z.number().int().describe("The `index` of the item in task.items"),
        ok: z
          .boolean()
          .describe("Grammatical, natural, uses the word in the given sense, translation faithful"),
        problem: text.nullable().describe("What is wrong, in English, when ok is false; else null"),
      }),
    )
    .describe("One verdict per item of task.items, same indexes"),
});

// ---------------------------------------------------------------- registries

export const inputSchemas = {
  GrammarQuizInput,
  GrammarCheckInput,
  VocabEnrichInput,
  VocabExerciseInput,
  VocabCheckInput,
  PlacementTestInput,
  ConversationInput,
  RoutinePlanInput,
  VocabEnrichBatchInput,
  ExampleCheckInput,
} satisfies Record<string, z.ZodObject>;

// `satisfies ZodObject` is what guarantees a root object for every output (see top of file).
export const outputSchemas = {
  GrammarQuizOutput,
  GrammarCheckOutput,
  VocabEnrichOutput,
  VocabExerciseOutput,
  VocabCheckOutput,
  PlacementTestOutput,
  ConversationOutput,
  RoutinePlanOutput,
  VocabEnrichBatchOutput,
  ExampleCheckOutput,
} satisfies Record<string, z.ZodObject>;

export type InputSchemaName = keyof typeof inputSchemas;
export type OutputSchemaName = keyof typeof outputSchemas;

/** The skills the code calls by id. A file with one of these ids must name exactly these schemas. */
export const BASE_SKILLS = {
  "grammar-quiz": { input: "GrammarQuizInput", output: "GrammarQuizOutput" },
  "grammar-check": { input: "GrammarCheckInput", output: "GrammarCheckOutput" },
  "vocab-enrich": { input: "VocabEnrichInput", output: "VocabEnrichOutput" },
  "vocab-exercise": { input: "VocabExerciseInput", output: "VocabExerciseOutput" },
  "vocab-check": { input: "VocabCheckInput", output: "VocabCheckOutput" },
  "placement-test": { input: "PlacementTestInput", output: "PlacementTestOutput" },
  conversation: { input: "ConversationInput", output: "ConversationOutput" },
  "routine-plan": { input: "RoutinePlanInput", output: "RoutinePlanOutput" },
  "vocab-enrich-batch": { input: "VocabEnrichBatchInput", output: "VocabEnrichBatchOutput" },
  "example-check": { input: "ExampleCheckInput", output: "ExampleCheckOutput" },
} as const satisfies Record<string, { input: InputSchemaName; output: OutputSchemaName }>;

export type BaseSkillId = keyof typeof BASE_SKILLS;
export type SkillVars<Id extends BaseSkillId> = z.input<
  (typeof inputSchemas)[(typeof BASE_SKILLS)[Id]["input"]]
>;
export type SkillOutput<Id extends BaseSkillId> = z.output<
  (typeof outputSchemas)[(typeof BASE_SKILLS)[Id]["output"]]
>;
