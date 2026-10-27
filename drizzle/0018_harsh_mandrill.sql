CREATE TYPE "public"."transfer_kind" AS ENUM('correct', 'error');--> statement-breakpoint
CREATE TYPE "public"."transfer_source" AS ENUM('talk', 'writing', 'speaking');--> statement-breakpoint
CREATE TABLE "transfer_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"topic_id" text NOT NULL,
	"kind" "transfer_kind" NOT NULL,
	"source" "transfer_source" NOT NULL,
	"session_id" integer,
	"message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_progress" ADD COLUMN "session_results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_progress" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_events_user_id_topic_id_idx" ON "transfer_events" USING btree ("user_id","topic_id");--> statement-breakpoint
ALTER TABLE "topic_progress" DROP COLUMN "criteria_met_at";--> statement-breakpoint
ALTER TABLE "topic_progress" DROP COLUMN "confirmed_at";