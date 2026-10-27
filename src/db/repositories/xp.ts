import { and, count, eq, sql } from "drizzle-orm";
import { type UserXpRow, userXp, type XpSource, xpEvents } from "../schema";
import type { Tx } from "./levels";

/** Appends one award to the ledger. */
export async function insertXpEvent(
  tx: Tx,
  userId: number,
  event: { source: XpSource; amount: number; meta: Record<string, unknown> },
  now: Date,
): Promise<void> {
  await tx.insert(xpEvents).values({ userId, ...event, createdAt: now });
}

/** Adds `amount` to the learner's cached total (creating it) and returns the new total. */
export async function addToXpTotal(
  tx: Tx,
  userId: number,
  amount: number,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .insert(userXp)
    .values({ userId, total: amount, updatedAt: now })
    .onConflictDoUpdate({
      target: userXp.userId,
      set: { total: sql`${userXp.total} + ${amount}`, updatedAt: now },
    })
    .returning({ total: userXp.total });
  return row?.total ?? amount;
}

export async function setXpLevel(tx: Tx, userId: number, level: number): Promise<void> {
  await tx.update(userXp).set({ level }).where(eq(userXp.userId, userId));
}

export async function getUserXp(db: Tx, userId: number): Promise<UserXpRow | undefined> {
  const [row] = await db.select().from(userXp).where(eq(userXp.userId, userId));
  return row;
}

/** Ledger rows of one source whose `meta` contains `match` (jsonb `@>`). */
export async function countXpEvents(
  db: Tx,
  userId: number,
  source: XpSource,
  match: Record<string, string | number>,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(xpEvents)
    .where(
      and(
        eq(xpEvents.userId, userId),
        eq(xpEvents.source, source),
        sql`${xpEvents.meta} @> ${JSON.stringify(match)}::jsonb`,
      ),
    );
  return row?.n ?? 0;
}
