ALTER TABLE "cards" ADD COLUMN "evidence" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "learned_at" timestamp with time zone;