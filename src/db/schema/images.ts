import { integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { words } from "./vocabulary";

export const imageSourceEnum = pgEnum("image_source", ["pexels", "unsplash"]);

/**
 * A word's picture, fetched once and shared by every learner. The photo is hotlinked (the stock
 * APIs' terms), so the row keeps what the caption's attribution needs. A row with no `url` means
 * the search found nothing: it is not searched again. "Another picture" moves `resultIndex` on.
 */
export const wordImages = pgTable("word_images", {
  wordId: integer()
    .primaryKey()
    .references(() => words.id, { onDelete: "cascade" }),
  query: text().notNull(),
  /** Position of the photo in the query's results, from 0. */
  resultIndex: integer().notNull().default(0),
  source: imageSourceEnum(),
  /** The photo's ID at its source. */
  photoId: text(),
  url: text(),
  width: integer(),
  height: integer(),
  authorName: text(),
  authorUrl: text(),
  /** The photo's page at its source. */
  pageUrl: text(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type ImageSource = (typeof imageSourceEnum.enumValues)[number];
export type WordImageRow = typeof wordImages.$inferSelect;
