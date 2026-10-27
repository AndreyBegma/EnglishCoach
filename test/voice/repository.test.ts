import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { findTtsFileId, saveTtsFileId } from "../../src/db/repositories/voice";
import { speechTextHash } from "../../src/voice/tts";
import { createTestDatabase, testServerUrl } from "../db/test-database";

describe.skipIf(!testServerUrl)("tts_audio repository", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(async () => {
    await database.close();
  });

  const key = { engine: "kokoro", voice: "af_heart", textHash: speechTextHash("borrow") };

  test("stores a file_id and finds it by engine, voice and text", async () => {
    expect(await findTtsFileId(database.db, key)).toBeUndefined();
    await saveTtsFileId(database.db, key, "file-1");
    expect(await findTtsFileId(database.db, key)).toBe("file-1");
    expect(await findTtsFileId(database.db, { ...key, voice: "bf_emma" })).toBeUndefined();
    expect(await findTtsFileId(database.db, { ...key, engine: "openai" })).toBeUndefined();
  });

  test("saving the same key again keeps the newer file_id", async () => {
    await saveTtsFileId(database.db, key, "file-2");
    expect(await findTtsFileId(database.db, key)).toBe("file-2");
  });
});
