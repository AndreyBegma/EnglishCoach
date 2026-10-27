CREATE TABLE "example_sentence_words" (
	"word_id" integer NOT NULL,
	"sentence_id" integer NOT NULL,
	CONSTRAINT "example_sentence_words_word_id_sentence_id_pk" PRIMARY KEY("word_id","sentence_id")
);
--> statement-breakpoint
CREATE TABLE "example_sentences" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "example_sentences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"source_id" integer NOT NULL,
	"text" text NOT NULL,
	"cefr_level" "cefr_level" NOT NULL,
	"word_count" smallint NOT NULL,
	"author" text,
	"translations" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "example_sentences_source_unique" UNIQUE("source","source_id")
);
--> statement-breakpoint
ALTER TABLE "example_sentence_words" ADD CONSTRAINT "example_sentence_words_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "example_sentence_words" ADD CONSTRAINT "example_sentence_words_sentence_id_example_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."example_sentences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "example_sentence_words_sentence_idx" ON "example_sentence_words" USING btree ("sentence_id");