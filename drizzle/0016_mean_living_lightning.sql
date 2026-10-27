ALTER TYPE "public"."xp_source" ADD VALUE 'achievement';--> statement-breakpoint
CREATE TABLE "achievement_progress" (
	"user_id" integer NOT NULL,
	"metric" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_progress_user_id_metric_pk" PRIMARY KEY("user_id","metric")
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" integer NOT NULL,
	"achievement_id" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_achievements_user_id_unlocked_at_idx" ON "user_achievements" USING btree ("user_id","unlocked_at");