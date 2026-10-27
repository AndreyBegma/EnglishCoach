CREATE TYPE "public"."image_source" AS ENUM('pexels', 'unsplash');--> statement-breakpoint
CREATE TABLE "word_images" (
	"word_id" integer PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"result_index" integer DEFAULT 0 NOT NULL,
	"source" "image_source",
	"photo_id" text,
	"url" text,
	"width" integer,
	"height" integer,
	"author_name" text,
	"author_url" text,
	"page_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "word_images" ADD CONSTRAINT "word_images_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;