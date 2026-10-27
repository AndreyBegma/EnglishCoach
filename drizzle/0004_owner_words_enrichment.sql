CREATE TABLE "excluded_lemmas" (
	"lemma" text PRIMARY KEY NOT NULL,
	"reason" text,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_enrichments" (
	"word_id" integer NOT NULL,
	"lang" "language" NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_enrichments_word_id_lang_pk" PRIMARY KEY("word_id","lang")
);
--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "ipa" text;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "example" text;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "translation_ru" text;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "curriculum_stage" smallint;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "curriculum_index" integer;--> statement-breakpoint
ALTER TABLE "word_enrichments" ADD CONSTRAINT "word_enrichments_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "words_lemma_idx" ON "words" USING btree ("lemma");--> statement-breakpoint
CREATE INDEX "words_curriculum_idx" ON "words" USING btree ("curriculum_stage","curriculum_index");