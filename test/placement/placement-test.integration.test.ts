import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { getSettings } from "../../src/db/repositories/users";
import type { CefrLevel } from "../../src/db/schema";
import { userSettings, users } from "../../src/db/schema";
import type { SyllabusTopic } from "../../src/grammar/syllabus";
import { getLevels, seedLevels } from "../../src/levels";
import { seedPlacementLevels } from "../../src/levels/seed-placement";
import type { LlmProvider } from "../../src/llm";
import { createLogger } from "../../src/log";
import { PlacementTest, startTest, type TestState } from "../../src/placement/test";
import type { TopicFlag } from "../../src/placement/topics";
import { type LearnerContext, loadSkillRegistry, SkillRunner } from "../../src/skills";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const topic = (id: string, band: CefrLevel): SyllabusTopic => ({
  id,
  band,
  step: 1,
  level: `${band}.1`,
  title: { en: `topic ${id}`, ru: id, uk: id },
  prerequisites: [],
  contrastWith: [],
  examples: [`An example of ${id}.`],
  interference: [],
  exerciseTypes: [],
});
const TOPICS = LEVELS.flatMap((band) => [1, 2, 3, 4].map((n) => topic(`${band}-${n}`, band)));

const learner: LearnerContext = {
  level: null,
  explainLang: "en",
  uiLang: "en",
  nativeLang: "ru",
  interests: [],
  weakSpots: [],
};

/** Items with option B right, at the level asked; rubrics grade B1. */
const provider: LlmProvider = {
  kind: "anthropic",
  complete: async (request) => {
    const content = String(request.messages.at(-1)?.content ?? "");
    const task = JSON.parse(content.split("<task>\n")[1]?.split("\n</task>")[0] ?? "{}");
    if ("learner_answer" in task) {
      return {
        data: request.schema.parse({
          on_task: task.learner_answer !== "off topic",
          criteria: { task: 2, coherence: 2, range: 2, accuracy: 2 },
          level: "B1",
          feedback: "Clear, with a few slips.",
        }),
      };
    }
    const passage = task.section === "reading" || task.section === "listening";
    const free = task.section === "writing" || task.section === "speaking";
    const question = { question: "Which?", options: ["a", "b", "c", "d"], correct_index: 1 };
    return {
      data: request.schema.parse({
        section: task.section,
        subject: `subject ${task.level}`,
        passage: passage ? "A text." : null,
        questions: free ? [] : passage ? [question, question] : [question],
        task: free ? "A task." : null,
      }),
    };
  },
};

describe.skipIf(!testServerUrl)("the placement test, stored", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let telegramId = 940_000;
  let userId = 0;
  beforeEach(async () => {
    const [user] = await database.db
      .insert(users)
      .values({ telegramId: ++telegramId, isAllowed: true })
      .returning();
    userId = user?.id ?? 0;
    await database.db.insert(userSettings).values({ userId });
  });

  const skills = new SkillRunner({
    registry: loadSkillRegistry(),
    provider: async () => provider,
    learner: async () => learner,
  });
  const logs: string[] = [];
  const log = createLogger({ level: "debug", write: (line) => logs.push(line) });

  /** Runs the whole test as a learner of `level`, skipping listening (no voice). */
  async function run(placement: PlacementTest, level: CefrLevel): Promise<TestState> {
    const state = startTest();
    const voice = { enabled: false, canSpeak: async () => false };
    for (let guard = 0; guard < 40; guard++) {
      await placement.prepare(userId, state, voice);
      if (placement.outcome(state)) return state;
      if (state.needsVoice) {
        placement.skip(state);
        continue;
      }
      const item = state.item;
      if (!item) throw new Error("nothing to show");
      if (item.task) {
        await placement.submit(userId, state, "My answer in a few sentences.");
        continue;
      }
      const right = LEVELS.indexOf(item.level) <= LEVELS.indexOf(level);
      placement.answer(state, right ? 1 : 0);
    }
    throw new Error("the test did not end");
  }

  test("a finished test stores every skill, the cache and the early topics' flags", async () => {
    const written: { userId: number; flags: readonly TopicFlag[] }[] = [];
    const placement = new PlacementTest({
      db: database.db,
      skills,
      log,
      topics: TOPICS,
      pick: () => 0,
      topicFlags: {
        write: async (id, flags) => {
          written.push({ userId: id, flags });
        },
      },
    });
    const state = await run(placement, "B1");
    expect(await getLevels(database.db, userId)).toBeUndefined();

    const { band, results } = await placement.finish(userId, state);
    expect(band).toBe("B1");
    expect((await getSettings(database.db, userId))?.cefrLevel).toBe("B1");
    const levels = await getLevels(database.db, userId);
    expect(levels?.skills.grammar?.evidence).toBe(7);
    expect(levels?.skills.listening).toMatchObject({ evidence: 0 });
    expect(results.listening.skipped).toBe(true);
    expect(levels?.skills.writing).toMatchObject({ label: "B1.5", evidence: 1 });

    expect(written).toHaveLength(1);
    expect(written[0]?.userId).toBe(userId);
    const flags = new Map(written[0]?.flags.map((flag) => [flag.topicId, flag.status]));
    // Bands below the grammar result are mastered; nothing above the band is flagged.
    expect(flags.get("A1-4")).toBe("mastered");
    expect(flags.get("A2-4")).toBe("mastered");
    expect(flags.has("C2-1")).toBe(false);
    // Tested topics follow their answers: B2 items were failed by a B1 learner.
    const tested = state.progress.topics;
    expect(tested.length).toBe(7);
    for (const answer of tested) {
      expect(flags.get(answer.topicId)).toBe(answer.correct ? "mastered" : "unknown");
    }
  });

  test("a failing topic-flag writer is logged and never loses the levels", async () => {
    const placement = new PlacementTest({
      db: database.db,
      skills,
      log,
      topics: TOPICS,
      topicFlags: {
        write: async () => {
          throw new Error("topic progress is down");
        },
      },
    });
    const state = await run(placement, "C1");
    await placement.finish(userId, state);
    expect((await getSettings(database.db, userId))?.cefrLevel).toBe("C1");
    expect(logs.some((line) => line.includes("placement topic flags failed"))).toBe(true);
  });

  test("an off-task answer reads as A1", async () => {
    const placement = new PlacementTest({ db: database.db, skills, log, topics: TOPICS });
    const state = await run(placement, "B2");
    expect(state.progress.results.writing?.rating).toBe(2.5);
    const fresh = startTest();
    fresh.progress = { ...state.progress, section: 4, results: {} };
    await placement.prepare(userId, fresh, { enabled: true, canSpeak: async () => true });
    await placement.submit(userId, fresh, "off topic");
    expect(fresh.progress.results.writing?.rating).toBe(0.5);
  });

  test("seeding replaces earlier levels and evidence", async () => {
    await seedLevels(database.db, userId, "C2", "chosen");
    const level = { rating: 1.2, uncertainty: 0.1, evidence: 3 };
    const band = await seedPlacementLevels(database.db, userId, {
      grammar: level,
      vocabulary: level,
      reading: level,
      listening: level,
      writing: level,
      speaking: { ...level, rating: 9 },
    });
    const levels = await getLevels(database.db, userId);
    expect(levels?.skills.grammar).toMatchObject({ label: "A2.2", evidence: 3 });
    // The uncertainty keeps the model's floor, the rating its scale.
    expect(levels?.skills.grammar?.uncertainty).toBe(0.2);
    expect(levels?.skills.speaking?.label).toBe("C2.9");
    expect(band).toBe("A2");
    expect((await getSettings(database.db, userId))?.cefrLevel).toBe("A2");
  });
});
