import { eq } from "drizzle-orm";
import { createEmptyCard } from "ts-fsrs";
import type { Db } from "../db/client";
import { fsrsCardToColumns } from "../db/fsrs";
import { cards, type Mistake, mistakes } from "../db/schema";

/** A pattern seen this many times (in total, across sessions) becomes a Review card. */
export const GRAMMAR_CARD_THRESHOLD = 2;

/**
 * Turns a recurring mistake into a `grammar_pattern` FSRS card, once: the new card's ID is stored in
 * `mistakes.card_id`, and a mistake that already has one (or is below the threshold) is left alone.
 * Returns the new card's ID, or null when nothing was promoted.
 */
export async function promoteMistakeToCard(db: Db, mistake: Mistake): Promise<number | null> {
  if (mistake.count < GRAMMAR_CARD_THRESHOLD || mistake.cardId !== null) return null;

  return db.transaction(async (tx) => {
    // Lock the row so two concurrent wrong answers cannot both create a card.
    const [fresh] = await tx
      .select()
      .from(mistakes)
      .where(eq(mistakes.id, mistake.id))
      .for("update");
    if (!fresh || fresh.cardId !== null) return null;

    const [card] = await tx
      .insert(cards)
      .values({
        userId: fresh.userId,
        itemType: "grammar_pattern",
        front: fresh.pattern,
        backJson: { translation: fresh.explanation, examples: [fresh.exampleRight] },
        ...fsrsCardToColumns(createEmptyCard(new Date())),
      })
      .returning({ id: cards.id });
    if (!card) throw new Error("insert into cards returned no row");

    await tx.update(mistakes).set({ cardId: card.id }).where(eq(mistakes.id, fresh.id));
    return card.id;
  });
}
