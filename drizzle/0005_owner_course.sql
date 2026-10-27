CREATE TABLE "grammar_exercise_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "grammar_exercise_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"exercise_id" integer NOT NULL,
	"number" smallint NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	CONSTRAINT "grammar_exercise_items_exercise_number_unique" UNIQUE("exercise_id","number")
);
--> statement-breakpoint
CREATE TABLE "grammar_exercises" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "grammar_exercises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"topic_id" text NOT NULL,
	"number" smallint NOT NULL,
	"instruction" text NOT NULL,
	CONSTRAINT "grammar_exercises_topic_number_unique" UNIQUE("topic_id","number")
);
--> statement-breakpoint
CREATE TABLE "grammar_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"position" smallint NOT NULL,
	"cefr_level" "cefr_level" NOT NULL,
	"title" text NOT NULL,
	"planned_from" date,
	"planned_to" date,
	"why" text NOT NULL,
	"formation" text NOT NULL,
	"usage" text NOT NULL,
	"signal_words" text NOT NULL,
	"mistakes" text NOT NULL,
	"remember" text NOT NULL,
	CONSTRAINT "grammar_topics_position_unique" UNIQUE("position")
);
--> statement-breakpoint
CREATE TABLE "phrasal_verbs" (
	"number" smallint PRIMARY KEY NOT NULL,
	"phrase" text NOT NULL,
	"translation_ru" text NOT NULL,
	"example" text,
	"plan_day" smallint
);
--> statement-breakpoint
CREATE TABLE "study_plan_days" (
	"day" smallint PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"week" smallint NOT NULL,
	"stage" text NOT NULL,
	"word_topic" text,
	"word_count" smallint,
	"review_words" text,
	"phrasal_verbs" text,
	"grammar" text
);
--> statement-breakpoint
ALTER TABLE "grammar_exercise_items" ADD CONSTRAINT "grammar_exercise_items_exercise_id_grammar_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."grammar_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grammar_exercises" ADD CONSTRAINT "grammar_exercises_topic_id_grammar_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."grammar_topics"("id") ON DELETE cascade ON UPDATE no action;