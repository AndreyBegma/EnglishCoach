import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { createEmptyCard } from "ts-fsrs";
import type { Database } from "../../src/db/client";
import { fsrsCardToColumns } from "../../src/db/fsrs";
import { markCardKnown } from "../../src/db/repositories/cards";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { type CefrLevel, cards, excludedLemmas, words } from "../../src/db/schema";
import { importOwnerList } from "../../src/words/owner-import";
import { parseOwnerWorkbook } from "../../src/words/owner-list";
import { WordPicker } from "../../src/words/picker";
import { seedWords, type WordRow } from "../../src/words/seed";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { ownerWorkbook } from "./owner-workbook";

const seed = (lemma: string, pos: string, cefrLevel: CefrLevel, rank: number): WordRow => ({
  lemma,
  pos,
  cefrLevel,
  frequencyRank: rank,
});

// The seed knows most owner words at other levels, plus words the owner list does not have.
const seedRows: WordRow[] = [
  seed("dog", "noun", "A1", 3),
  seed("british", "adjective", "A1", 5),
  seed("run", "verb", "A1", 10),
  seed("run", "noun", "A1", 200),
  seed("apple", "noun", "A1", 50),
  seed("cat", "noun", "A1", 60),
  seed("decide", "verb", "A2", 30),
  seed("journey", "noun", "A2", 400),
  seed("tree", "noun", "B1", 1),
];

describe.skipIf(!testServerUrl)("owner word list import and the picker", () => {
  let database: Database;
  let picker: WordPicker;
  const list = parseOwnerWorkbook(ownerWorkbook());

  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    picker = new WordPicker(database.db);
    await seedWords(database.db, seedRows);
    await importOwnerList(database.db, list);
  });
  afterAll(() => database.close());

  const allWords = () => database.db.select().from(words).orderBy(asc(words.id));
  const word = async (lemma: string, pos?: string) => {
    const [row] = await database.db
      .select()
      .from(words)
      .where(pos ? and(eq(words.lemma, lemma), eq(words.pos, pos)) : eq(words.lemma, lemma));
    if (!row) throw new Error(`no word ${lemma}`);
    return row;
  };
  const lemmas = (list: { lemma: string }[]) => list.map((row) => row.lemma);

  let nextTelegramId = 930_001;
  const newUser = () => getOrCreateUser(database.db, { telegramId: nextTelegramId++ });

  test("owner fields override the seed; the frequency rank stays", async () => {
    expect(await word("decide")).toMatchObject({
      pos: "verb",
      cefrLevel: "B1",
      frequencyRank: 30,
      source: "owner_list",
      ipa: "/decide/",
      translationRu: "decide-ru",
      example: "We decided to stay.",
      topic: "Тема",
      curriculumStage: 1,
      curriculumIndex: 1,
    });
  });

  test("a word with several parts of speech lands on the seed row of its first one", async () => {
    expect(await word("run", "verb, noun")).toMatchObject({
      cefrLevel: "A2",
      frequencyRank: 10,
      source: "owner_list",
    });
    // The other seed row of the lemma stays, untouched.
    expect(await word("run", "noun")).toMatchObject({ source: "cefr-j-1.5", cefrLevel: "A1" });
  });

  test("a word the seed does not know is inserted without a rank", async () => {
    expect(await word("zephyr")).toMatchObject({
      pos: "",
      cefrLevel: "C2",
      frequencyRank: null,
      curriculumStage: 4,
    });
  });

  test("the removed list is stored", async () => {
    expect(await database.db.select().from(excludedLemmas)).toEqual([
      { lemma: "british", reason: "национальность", source: "owner_list" },
    ]);
  });

  test("a second import changes nothing; re-seeding leaves owner rows alone", async () => {
    const before = await allWords();
    expect(await importOwnerList(database.db, list)).toMatchObject({ inserted: 0, dropped: 0 });
    expect(await allWords()).toEqual(before);
    await seedWords(database.db, seedRows);
    expect(await allWords()).toEqual(before);
    expect(await database.db.select().from(excludedLemmas)).toHaveLength(1);
  });

  test("the picker follows the curriculum, then the seed by frequency", async () => {
    const user = await newUser();
    // A1: owner words in list order (apple, cat), then the seed (dog). `british` is removed and
    // `run`'s noun row duplicates an owner lemma.
    expect(lemmas(await picker.upcoming(user.id, "A1", 3))).toEqual(["apple", "cat", "dog"]);
    expect(lemmas(await picker.upcoming(user.id, "B1", 10))).toEqual([
      "decide",
      "journey",
      "borrow",
      "tree",
      "advocate",
    ]);
  });

  test("level gating: a level's words, then the level above once it runs dry", async () => {
    const user = await newUser();
    expect(lemmas(await picker.upcoming(user.id, "A1", 10))).toEqual([
      "apple",
      "cat",
      "dog",
      "run",
    ]);
    expect(lemmas(await picker.pickNew(user.id, "A1", 1))).toEqual(["apple"]);
    expect(lemmas(await picker.upcoming(user.id, "C1", 10))).toEqual(["zephyr"]);
  });

  test("words with a card — learned or marked known — are skipped", async () => {
    const user = await newUser();
    const insertCard = async (lemma: string) => {
      const target = await word(lemma);
      const [card] = await database.db
        .insert(cards)
        .values({
          userId: user.id,
          itemType: "word",
          wordId: target.id,
          front: lemma,
          ...fsrsCardToColumns(createEmptyCard(new Date("2026-10-01T00:00:00Z"))),
        })
        .returning();
      return card;
    };
    await insertCard("decide");
    const known = await insertCard("journey");
    if (known) await markCardKnown(database.db, user.id, known.id, new Date());
    expect(lemmas(await picker.upcoming(user.id, "B1", 2))).toEqual(["borrow", "tree"]);
  });

  test("a word dropped from the list leaves the curriculum", async () => {
    await importOwnerList(database.db, {
      words: list.words.filter((entry) => entry.lemma !== "borrow"),
      removed: list.removed,
    });
    expect(await word("borrow")).toMatchObject({
      source: "owner_list_dropped",
      curriculumStage: null,
    });
    const user = await newUser();
    expect(lemmas(await picker.upcoming(user.id, "B1", 3))).toEqual(["decide", "journey", "tree"]);
    await importOwnerList(database.db, list);
    expect(await word("borrow")).toMatchObject({ source: "owner_list", curriculumStage: 1 });
  });
});
