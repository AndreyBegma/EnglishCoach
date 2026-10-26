import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  type LearningSession,
  learningSessions,
  type SessionMessage,
  sessionMessages,
} from "../schema";

export type SessionKind = LearningSession["kind"];
export type SessionStatus = LearningSession["status"];
export type EndedStatus = Exclude<SessionStatus, "active">;

/** What a finished session leaves behind; `line` is the one-line summary folded into the hub. */
export type SessionSummary = { line: string } & Record<string, unknown>;

export type StartResult =
  | { created: true; session: LearningSession }
  | { created: false; active: LearningSession };

/**
 * Creates an active session unless the user already has one. Serialised per user with a
 * transaction-scoped advisory lock, so two concurrent starts cannot both succeed.
 */
export async function createSession(
  db: Db,
  userId: number,
  kind: SessionKind,
): Promise<StartResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId})`);
    const [active] = await tx
      .select()
      .from(learningSessions)
      .where(and(eq(learningSessions.userId, userId), eq(learningSessions.status, "active")));
    if (active) return { created: false, active };

    const [session] = await tx.insert(learningSessions).values({ userId, kind }).returning();
    if (!session) throw new Error("insert into learning_sessions returned no row");
    return { created: true, session };
  });
}

export async function findActiveSession(
  db: Db,
  userId: number,
): Promise<LearningSession | undefined> {
  const [session] = await db
    .select()
    .from(learningSessions)
    .where(and(eq(learningSessions.userId, userId), eq(learningSessions.status, "active")));
  return session;
}

export async function getSession(db: Db, id: number): Promise<LearningSession | undefined> {
  const [session] = await db.select().from(learningSessions).where(eq(learningSessions.id, id));
  return session;
}

export async function trackMessage(
  db: Db,
  sessionId: number,
  chatId: number,
  messageId: number,
): Promise<void> {
  await db.insert(sessionMessages).values({ sessionId, chatId, messageId });
}

export async function listSessionMessages(db: Db, sessionId: number): Promise<SessionMessage[]> {
  return db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.id));
}

export async function deleteSessionMessages(db: Db, sessionId: number): Promise<void> {
  await db.delete(sessionMessages).where(eq(sessionMessages.sessionId, sessionId));
}

/**
 * Moves an active session to a final status. Returns undefined when it was not active any more,
 * so of two racing enders (the user and the inactivity timeout) exactly one wins.
 */
export async function endSession(
  db: Db,
  sessionId: number,
  status: EndedStatus,
  summary: SessionSummary | null,
): Promise<LearningSession | undefined> {
  const [session] = await db
    .update(learningSessions)
    .set({ status, endedAt: new Date(), summaryJson: summary })
    .where(and(eq(learningSessions.id, sessionId), eq(learningSessions.status, "active")))
    .returning();
  return session;
}

/** The one-line summary of the user's most recently ended session, if it left one. */
export async function lastSummaryLine(db: Db, userId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ summary: learningSessions.summaryJson })
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.userId, userId),
        ne(learningSessions.status, "active"),
        isNotNull(learningSessions.endedAt),
      ),
    )
    .orderBy(desc(learningSessions.endedAt), desc(learningSessions.id))
    .limit(1);
  const line = row?.summary?.line;
  return typeof line === "string" && line.trim() ? line : undefined;
}
