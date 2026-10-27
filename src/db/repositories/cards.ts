import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../client";
import type { FsrsCardColumns, FsrsReviewLogColumns } from "../fsrs";
import { type CardBack, type CardRow, cards, type Mistake, mistakes, reviewLogs } from "../schema";

export type CardItemType = CardRow["itemType"];

/** Item types learned like words — in Learn words, with a first check: everything but grammar patterns. */
export const WORD_ITEM_TYPES = [
  "word",
  "user_word",
  "collocation",
  "phrasal_verb",
  "idiom",
  "word_family",
] as const satisfies readonly CardItemType[];

/**
 * A word card that was created (and enriched) but never rated: the learner saw it in Learn words
 * and has not passed its first check yet. It belongs to Learn words, not to Review, so it never
 * counts as due. Grammar-pattern cards are reviewed from their first appearance. A word the
 * learner marked known is neither pending nor reviewable.
 */
export const isPendingCard = and(
  inArray(cards.itemType, [...WORD_ITEM_TYPES]),
  eq(cards.reps, 0),
  isNull(cards.knownAt),
);

/** Cards Review may show: rated (or grammar) and not marked known. */
export const isReviewableCard = and(
  isNull(cards.knownAt),
  or(eq(cards.itemType, "grammar_pattern"), gt(cards.reps, 0)),
);

/** Cards the learner marked "I know this word 100%". */
export const isKnownCard = isNotNull(cards.knownAt);

export interface NewCard {
  userId: number;
  itemType: CardItemType;
  wordId?: number | null;
  front: string;
  back: CardBack;
  fsrs: FsrsCardColumns;
}

/**
 * Inserts a card. A dictionary word the user already has a card for is not inserted twice: the
 * existing card comes back instead.
 */
export async function createCard(db: Db, card: NewCard): Promise<CardRow> {
  const [inserted] = await db
    .insert(cards)
    .values({
      userId: card.userId,
      itemType: card.itemType,
      wordId: card.wordId ?? null,
      front: card.front,
      backJson: card.back,
      ...card.fsrs,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  if (card.wordId == null) throw new Error("insert into cards returned no row");
  const [existing] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, card.userId), eq(cards.wordId, card.wordId)));
  if (!existing) throw new Error("card conflict without an existing card");
  return existing;
}

/** One of the user's cards; undefined for another user's card. */
export async function getCard(
  db: Db,
  userId: number,
  cardId: number,
): Promise<CardRow | undefined> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
  return card;
}

/**
 * Marks a word card known at `now`: it leaves Learn and Review for good. Idempotent; false when
 * the card is not the user's, is not a word card or was already known.
 */
export async function markCardKnown(
  db: Db,
  userId: number,
  cardId: number,
  now: Date,
): Promise<boolean> {
  const updated = await db
    .update(cards)
    .set({ knownAt: now })
    .where(
      and(
        eq(cards.id, cardId),
        eq(cards.userId, userId),
        inArray(cards.itemType, [...WORD_ITEM_TYPES]),
        isNull(cards.knownAt),
      ),
    )
    .returning({ id: cards.id });
  return updated.length > 0;
}

/**
 * How many of the user's latest `window` word-like cards (known ones included) are of each item
 * type: the picker's recent mix.
 */
export async function countWordCardsByType(
  db: Db,
  userId: number,
  window: number,
): Promise<Partial<Record<(typeof WORD_ITEM_TYPES)[number], number>>> {
  const latest = db
    .select({ itemType: cards.itemType })
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.itemType, [...WORD_ITEM_TYPES])))
    .orderBy(desc(cards.createdAt), desc(cards.id))
    .limit(window)
    .as("latest");
  const rows = await db
    .select({ itemType: latest.itemType, n: count() })
    .from(latest)
    .groupBy(latest.itemType);
  return Object.fromEntries(rows.map((row) => [row.itemType, row.n]));
}

/**
 * Returns a known word to learning. Its FSRS state was never touched, so a never-rated card is
 * pending again and a rated one resumes its old schedule. False when the card was not known.
 */
export async function unmarkCardKnown(db: Db, userId: number, cardId: number): Promise<boolean> {
  const updated = await db
    .update(cards)
    .set({ knownAt: null })
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isKnownCard))
    .returning({ id: cards.id });
  return updated.length > 0;
}

/** How many words the user marked known. */
export async function countKnownWords(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(cards)
    .where(and(eq(cards.userId, userId), isKnownCard));
  return row?.value ?? 0;
}

/** The oldest pending card: shown before any new word is picked, with its cached enrichment. */
export async function findPendingCard(db: Db, userId: number): Promise<CardRow | undefined> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), isPendingCard))
    .orderBy(asc(cards.createdAt), asc(cards.id))
    .limit(1);
  return card;
}

/** A word or user-word card whose front is `front`, ignoring case. */
export async function findWordCardByFront(
  db: Db,
  userId: number,
  front: string,
): Promise<CardRow | undefined> {
  const [card] = await db
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        ne(cards.itemType, "grammar_pattern"),
        sql`lower(${cards.front}) = lower(${front})`,
      ),
    )
    .limit(1);
  return card;
}

const notReviewedSince = (db: Db, since: Date) =>
  notExists(
    db
      .select({ one: sql`1` })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.cardId, cards.id), gte(reviewLogs.reviewedAt, since))),
  );

const dueAndUnreviewed = (db: Db, userId: number, now: Date, since: Date) =>
  and(eq(cards.userId, userId), lte(cards.due, now), isReviewableCard, notReviewedSince(db, since));

/**
 * The next card to review: due at `now`, reviewable, and not reviewed since `since` (the start of
 * the session, so a card rated Again is not asked twice in one sitting). Earliest due first.
 */
export async function findNextDueCard(
  db: Db,
  userId: number,
  now: Date,
  since: Date,
): Promise<CardRow | undefined> {
  const [card] = await db
    .select()
    .from(cards)
    .where(dueAndUnreviewed(db, userId, now, since))
    .orderBy(asc(cards.due), asc(cards.id))
    .limit(1);
  return card;
}

/** How many cards are due at `now` and not yet reviewed since `since`. */
export async function countDueSince(
  db: Db,
  userId: number,
  now: Date,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(cards)
    .where(dueAndUnreviewed(db, userId, now, since));
  return row?.value ?? 0;
}

/**
 * Writes one review: the card's new FSRS state and its `review_logs` row, in one transaction.
 * The update only applies while the card still has `expectedReps` reviews, so a second tap on the
 * same rating button (or two racing updates) cannot rate a card twice. Returns false then.
 */
export async function applyReview(
  db: Db,
  cardId: number,
  expectedReps: number,
  next: FsrsCardColumns,
  log: FsrsReviewLogColumns,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(cards)
      .set(next)
      .where(and(eq(cards.id, cardId), eq(cards.reps, expectedReps)))
      .returning({ id: cards.id });
    if (!updated) return false;
    await tx.insert(reviewLogs).values({ cardId, ...log });
    return true;
  });
}

export interface ReviewStats {
  /** Word cards rated for the first time. */
  learned: number;
  /** Every other rating. */
  reviewed: number;
  /** Ratings of Hard or better: the learner recalled the item. */
  passed: number;
}

/** What the user rated since `since` — the summary of a session, straight from `review_logs`. */
export async function reviewStatsSince(db: Db, userId: number, since: Date): Promise<ReviewStats> {
  const [row] = await db
    .select({
      learned:
        sql<number>`count(*) filter (where ${reviewLogs.state} = 0 and ${cards.itemType} <> 'grammar_pattern')`.mapWith(
          Number,
        ),
      total: count(),
      passed: sql<number>`count(*) filter (where ${reviewLogs.rating} >= 2)`.mapWith(Number),
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .where(and(eq(cards.userId, userId), gte(reviewLogs.reviewedAt, since)));
  const learned = row?.learned ?? 0;
  return { learned, reviewed: (row?.total ?? 0) - learned, passed: row?.passed ?? 0 };
}

/** The mistake pattern a grammar-pattern card was promoted from. */
export async function findMistakeForCard(db: Db, cardId: number): Promise<Mistake | undefined> {
  const [mistake] = await db.select().from(mistakes).where(eq(mistakes.cardId, cardId)).limit(1);
  return mistake;
}
