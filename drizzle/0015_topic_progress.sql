CREATE TYPE "public"."topic_status" AS ENUM('not_started', 'learning', 'shaky', 'mastered');--> statement-breakpoint
CREATE TABLE "topic_progress" (
	"user_id" integer NOT NULL,
	"topic_id" text NOT NULL,
	"status" "topic_status" DEFAULT 'not_started' NOT NULL,
	"recent_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accuracy_by_type" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transfer_evidence" integer DEFAULT 0 NOT NULL,
	"criteria_met_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"mastered_at" timestamp with time zone,
	"first_mastered_at" timestamp with time zone,
	"fsrs" jsonb,
	"review_due" timestamp with time zone,
	"check_scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_progress_user_id_topic_id_pk" PRIMARY KEY("user_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_progress_user_id_review_due_idx" ON "topic_progress" USING btree ("user_id","review_due");