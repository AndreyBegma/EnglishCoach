CREATE TYPE "public"."skill" AS ENUM('grammar', 'vocabulary', 'reading', 'listening', 'writing', 'speaking');--> statement-breakpoint
CREATE TABLE "skill_levels" (
	"user_id" integer NOT NULL,
	"skill" "skill" NOT NULL,
	"rating" double precision NOT NULL,
	"uncertainty" double precision NOT NULL,
	"evidence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_levels_user_id_skill_pk" PRIMARY KEY("user_id","skill")
);
--> statement-breakpoint
ALTER TABLE "skill_levels" ADD CONSTRAINT "skill_levels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing learners: every skill starts at the centre of their chosen band (A1 = 0.5 … C2 = 5.5)
-- with the "chosen level" uncertainty of `src/levels/model.ts` (SEEDED_UNCERTAINTY.chosen = 0.8).
INSERT INTO "skill_levels" ("user_id", "skill", "rating", "uncertainty")
SELECT s."user_id", k."skill", array_position(enum_range(NULL::"cefr_level"), s."cefr_level") - 0.5, 0.8
FROM "user_settings" s
CROSS JOIN unnest(enum_range(NULL::"skill")) AS k("skill")
WHERE s."cefr_level" IS NOT NULL;