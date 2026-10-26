CREATE TYPE "public"."card_item_type" AS ENUM('word', 'grammar_pattern', 'user_word');--> statement-breakpoint
CREATE TYPE "public"."cefr_level" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('ru', 'en', 'uk');--> statement-breakpoint
CREATE TYPE "public"."mistake_category" AS ENUM('grammar', 'vocabulary', 'spelling', 'word_choice', 'punctuation', 'expression');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('server', 'anthropic', 'openai', 'claude-code', 'runner');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('vocab_new', 'review', 'grammar', 'talk', 'placement', 'routine_morning', 'routine_evening');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'finished', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mistakes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"category" "mistake_category" NOT NULL,
	"pattern" text NOT NULL,
	"example_wrong" text NOT NULL,
	"example_right" text NOT NULL,
	"explanation" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"card_id" integer,
	CONSTRAINT "mistakes_user_id_category_pattern_unique" UNIQUE("user_id","category","pattern")
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provider_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"model" text,
	"base_url" text,
	"encrypted_api_key" "bytea",
	"key_iv" "bytea",
	"key_tag" "bytea",
	"is_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_messages" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "learning_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" "session_kind" NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"summary_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"new_words" integer DEFAULT 0 NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"grammar_answered" integer DEFAULT 0 NOT NULL,
	"grammar_correct" integer DEFAULT 0 NOT NULL,
	"goal_met" boolean DEFAULT false NOT NULL,
	CONSTRAINT "daily_stats_user_id_date_unique" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"ui_lang" "language" DEFAULT 'en' NOT NULL,
	"explain_lang" "language" DEFAULT 'en' NOT NULL,
	"cefr_level" "cefr_level",
	"words_per_day" smallint DEFAULT 5 NOT NULL,
	"timezone" text DEFAULT 'Europe/Kyiv' NOT NULL,
	"morning_time" time DEFAULT '08:30' NOT NULL,
	"evening_time" time DEFAULT '20:00' NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"voice_enabled" boolean DEFAULT false NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"is_allowed" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"item_type" "card_item_type" NOT NULL,
	"word_id" integer,
	"front" text NOT NULL,
	"back_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"learning_steps" integer NOT NULL,
	"reps" integer NOT NULL,
	"lapses" integer NOT NULL,
	"state" smallint NOT NULL,
	"last_review" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"card_id" integer NOT NULL,
	"rating" smallint NOT NULL,
	"state" smallint NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"elapsed_days" integer NOT NULL,
	"last_elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"learning_steps" integer NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "words_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lemma" text NOT NULL,
	"pos" text NOT NULL,
	"cefr_level" "cefr_level" NOT NULL,
	"frequency_rank" integer,
	"source" text NOT NULL,
	CONSTRAINT "words_lemma_pos_unique" UNIQUE("lemma","pos")
);
--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_messages" ADD CONSTRAINT "hub_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_configs_user_id_idx" ON "provider_configs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_one_active_per_user" ON "provider_configs" USING btree ("user_id") WHERE "provider_configs"."is_active";--> statement-breakpoint
CREATE INDEX "learning_sessions_user_id_status_idx" ON "learning_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "session_messages_session_id_idx" ON "session_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "cards_user_id_due_idx" ON "cards" USING btree ("user_id","due");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_user_id_word_id_unique" ON "cards" USING btree ("user_id","word_id") WHERE "cards"."word_id" is not null;--> statement-breakpoint
CREATE INDEX "review_logs_card_id_reviewed_at_idx" ON "review_logs" USING btree ("card_id","reviewed_at");