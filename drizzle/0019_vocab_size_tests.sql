ALTER TYPE "public"."session_kind" ADD VALUE 'size_test';--> statement-breakpoint
CREATE TABLE "vocab_size_tests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vocab_size_tests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"session_id" integer,
	"items" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimate" integer NOT NULL,
	"coverage_bp" integer NOT NULL,
	"bands" jsonb NOT NULL,
	"false_alarms_bp" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vocab_size_tests" ADD CONSTRAINT "vocab_size_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_size_tests" ADD CONSTRAINT "vocab_size_tests_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vocab_size_tests_user_id_finished_at_idx" ON "vocab_size_tests" USING btree ("user_id","finished_at");