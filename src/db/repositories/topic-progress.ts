import { and, eq } from "drizzle-orm";
import { type TopicProgressRow, topicProgress } from "../schema";
import type { Tx } from "./levels";

/** Every topic the learner has a row for. */
export async function listTopicProgress(db: Tx, userId: number): Promise<TopicProgressRow[]> {
  return db.select().from(topicProgress).where(eq(topicProgress.userId, userId));
}

/** The learner's row for `topicId`, created empty if missing, locked for the transaction. */
export async function lockTopicProgress(
  tx: Tx,
  userId: number,
  topicId: string,
): Promise<TopicProgressRow> {
  await tx.insert(topicProgress).values({ userId, topicId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(topicProgress)
    .where(and(eq(topicProgress.userId, userId), eq(topicProgress.topicId, topicId)))
    .for("update");
  if (!row) throw new Error("topic_progress row missing after insert");
  return row;
}

/** Everything the mastery rules own; `method_history` belongs to the adaptive-methods card. */
export type TopicProgressWrite = Omit<
  TopicProgressRow,
  "userId" | "topicId" | "updatedAt" | "methodHistory"
>;

export async function putTopicProgress(
  tx: Tx,
  userId: number,
  topicId: string,
  progress: TopicProgressWrite,
  now: Date,
): Promise<void> {
  await tx
    .update(topicProgress)
    .set({ ...progress, updatedAt: now })
    .where(and(eq(topicProgress.userId, userId), eq(topicProgress.topicId, topicId)));
}
