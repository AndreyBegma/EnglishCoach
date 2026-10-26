import { and, count, eq, lte } from "drizzle-orm";
import type { Db } from "../client";
import { cards, type HubMessage, hubMessages } from "../schema";
import { isReviewableCard } from "./cards";

export async function getHub(db: Db, userId: number): Promise<HubMessage | undefined> {
  const [hub] = await db.select().from(hubMessages).where(eq(hubMessages.userId, userId));
  return hub;
}

export async function saveHub(db: Db, hub: HubMessage): Promise<void> {
  const { userId: _, ...rest } = hub;
  await db.insert(hubMessages).values(hub).onConflictDoUpdate({
    target: hubMessages.userId,
    set: rest,
  });
}

export async function deleteHub(db: Db, userId: number): Promise<void> {
  await db.delete(hubMessages).where(eq(hubMessages.userId, userId));
}

/** Cards whose review is due at `now` or earlier; pending Learn-words cards are not due. */
export async function countDueCards(db: Db, userId: number, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(cards)
    .where(and(eq(cards.userId, userId), lte(cards.due, now), isReviewableCard));
  return row?.value ?? 0;
}
