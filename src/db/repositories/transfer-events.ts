import { and, count, eq, gte } from "drizzle-orm";
import { type TransferKind, type TransferSource, transferEvents } from "../schema";
import type { Tx } from "./levels";

export type TransferEventInput = {
  userId: number;
  topicId: string;
  kind: TransferKind;
  source: TransferSource;
  sessionId: number | null;
  messageId: number | null;
  createdAt: Date;
};

export async function insertTransferEvent(tx: Tx, event: TransferEventInput): Promise<void> {
  await tx.insert(transferEvents).values(event);
}

/** One topic's transfer evidence, counted per source and kind. */
export type TransferCount = { source: TransferSource; kind: TransferKind; count: number };

/** The learner's transfer events on `topicId` per source and kind; only those since `since`. */
export async function countTransferEvents(
  db: Tx,
  userId: number,
  topicId: string,
  since?: Date,
): Promise<TransferCount[]> {
  return db
    .select({ source: transferEvents.source, kind: transferEvents.kind, count: count() })
    .from(transferEvents)
    .where(
      and(
        eq(transferEvents.userId, userId),
        eq(transferEvents.topicId, topicId),
        since ? gte(transferEvents.createdAt, since) : undefined,
      ),
    )
    .groupBy(transferEvents.source, transferEvents.kind);
}
