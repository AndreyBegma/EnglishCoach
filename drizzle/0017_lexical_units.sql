CREATE TYPE "public"."lexical_unit_type" AS ENUM('word', 'collocation', 'phrasal_verb', 'idiom', 'word_family');--> statement-breakpoint
ALTER TYPE "public"."card_item_type" ADD VALUE 'collocation';--> statement-breakpoint
ALTER TYPE "public"."card_item_type" ADD VALUE 'phrasal_verb';--> statement-breakpoint
ALTER TYPE "public"."card_item_type" ADD VALUE 'idiom';--> statement-breakpoint
ALTER TYPE "public"."card_item_type" ADD VALUE 'word_family';--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "unit_type" "lexical_unit_type" DEFAULT 'word' NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "details" jsonb;--> statement-breakpoint
CREATE INDEX "words_unit_type_level_idx" ON "words" USING btree ("unit_type","cefr_level");