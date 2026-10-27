ALTER TABLE "user_settings" ADD COLUMN "goals" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "profession" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_goals_check" CHECK ("user_settings"."goals" <@ array['it', 'travel', 'work_business', 'exam', 'everyday', 'relocation']::text[]);