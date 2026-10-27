import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import {
  excludedLemmas,
  grammarExerciseItems,
  grammarExercises,
  grammarTopics,
  OWNER_LIST_SOURCE,
  phrasalVerbs,
  studyPlanDays,
  words,
} from "../../src/db/schema";
import { importOwnerList } from "../../src/words/owner-import";
import { parseOwnerWorkbook } from "../../src/words/owner-list";
import { buildOwnerSeed, loadOwnerSeed } from "../../src/words/owner-seed";
import { seedWords } from "../../src/words/seed";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { ownerWorkbook } from "../words/owner-workbook";

describe.skipIf(!testServerUrl)("db:seed of the owner's content", () => {
  let database: Database;
  const { seed } = buildOwnerSeed(ownerWorkbook());

  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await seedWords(database.db, [
      { lemma: "apple", pos: "noun", cefrLevel: "A1", frequencyRank: 50 },
      { lemma: "tree", pos: "noun", cefrLevel: "B1", frequencyRank: 1 },
    ]);
  });
  afterAll(() => database.close());

  const ownerWords = () =>
    database.db
      .select()
      .from(words)
      .where(eq(words.source, OWNER_LIST_SOURCE))
      .orderBy(asc(words.curriculumStage), asc(words.curriculumIndex));
  const snapshot = async () => ({
    words: await ownerWords(),
    excluded: await database.db.select().from(excludedLemmas),
    topics: await database.db.select().from(grammarTopics).orderBy(asc(grammarTopics.position)),
    exercises: await database.db.select().from(grammarExercises).orderBy(asc(grammarExercises.id)),
    items: await database.db
      .select()
      .from(grammarExerciseItems)
      .orderBy(asc(grammarExerciseItems.id)),
    phrasalVerbs: await database.db.select().from(phrasalVerbs).orderBy(asc(phrasalVerbs.number)),
    plan: await database.db.select().from(studyPlanDays).orderBy(asc(studyPlanDays.day)),
  });

  test("loads counts matching the sheets, without examples", async () => {
    const result = await loadOwnerSeed(database.db, seed);
    expect(result).toMatchObject({
      inserted: 7,
      updated: 1,
      removed: 1,
      topics: 2,
      exercises: 3,
      items: 5,
      phrasalVerbs: 2,
      planDays: 2,
    });
    const loaded = await snapshot();
    expect(loaded.words.map((word) => word.lemma)).toEqual(seed.words.map((word) => word.lemma));
    expect(loaded.words.every((word) => word.example === null)).toBe(true);
    // The dictionary row is reused: its frequency rank stays.
    expect(loaded.words[0]).toMatchObject({ lemma: "apple", frequencyRank: 50, ipa: "/ˈæpl/" });
    expect(loaded.excluded.map((row) => row.lemma)).toEqual(["british"]);
    expect([loaded.topics.length, loaded.exercises.length, loaded.items.length]).toEqual([2, 3, 5]);
    expect(loaded.topics[0]).toMatchObject({
      id: "g001",
      cefrLevel: "A2",
      plannedFrom: "2026-10-19",
      formation: "• I am\n• he is",
    });
    expect(loaded.items.map((item) => item.answer)).toContain("I went home.");
    expect(loaded.phrasalVerbs[0]?.example).toBe("Never give up on a good idea.");
    expect(loaded.plan.map((day) => day.date)).toEqual(["2026-10-19", "2026-10-20"]);
  });

  test("loading it again changes nothing, ids included", async () => {
    const before = await snapshot();
    const result = await loadOwnerSeed(database.db, seed);
    expect([result.inserted, result.dropped]).toEqual([0, 0]);
    expect(await snapshot()).toEqual(before);
  });

  test("an example set by the private import survives a reload of the seed", async () => {
    await importOwnerList(database.db, parseOwnerWorkbook(ownerWorkbook()));
    await loadOwnerSeed(database.db, seed);
    const apple = (await ownerWords()).find((word) => word.lemma === "apple");
    expect(apple?.example).toBe("An apple a day.");
  });

  test("a topic, exercise or verb the seed no longer has is removed", async () => {
    const [first] = seed.grammar;
    if (!first) throw new Error("fixture has no topics");
    await loadOwnerSeed(database.db, {
      ...seed,
      grammar: [{ ...first, exercises: first.exercises.slice(0, 1) }],
      phrasalVerbs: seed.phrasalVerbs.slice(0, 1),
    });
    const loaded = await snapshot();
    expect([loaded.topics.length, loaded.exercises.length, loaded.items.length]).toEqual([1, 1, 2]);
    expect(loaded.phrasalVerbs).toHaveLength(1);
  });
});
