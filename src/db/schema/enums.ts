import { pgEnum } from "drizzle-orm/pg-core";

export const languageEnum = pgEnum("language", ["ru", "en", "uk"]);

export const cefrLevelEnum = pgEnum("cefr_level", ["A1", "A2", "B1", "B2", "C1", "C2"]);

export const providerKindEnum = pgEnum("provider_kind", [
  "server",
  "anthropic",
  "openai",
  "claude-code",
  "runner",
]);

/** What a `words` row is: a single word, or one of the multi-word / derived lexical units. */
export const lexicalUnitTypeEnum = pgEnum("lexical_unit_type", [
  "word",
  "collocation",
  "phrasal_verb",
  "idiom",
  "word_family",
]);

export const cardItemTypeEnum = pgEnum("card_item_type", [
  "word",
  "grammar_pattern",
  "user_word",
  "collocation",
  "phrasal_verb",
  "idiom",
  "word_family",
]);

export const mistakeCategoryEnum = pgEnum("mistake_category", [
  "grammar",
  "vocabulary",
  "spelling",
  "word_choice",
  "punctuation",
  "expression",
]);

export const sessionKindEnum = pgEnum("session_kind", [
  "vocab_new",
  "review",
  "grammar",
  "talk",
  "placement",
  "routine_morning",
  "routine_evening",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "finished",
  "cancelled",
  "expired",
]);

export type Language = (typeof languageEnum.enumValues)[number];
export type CefrLevel = (typeof cefrLevelEnum.enumValues)[number];
export type ProviderKind = (typeof providerKindEnum.enumValues)[number];
export type LexicalUnitType = (typeof lexicalUnitTypeEnum.enumValues)[number];
