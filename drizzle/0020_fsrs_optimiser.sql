CREATE TABLE "fsrs_parameters" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"weights" double precision[],
	"log_loss" double precision NOT NULL,
	"review_count" integer NOT NULL,
	"fitted_at" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "desired_retention" smallint DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "fsrs_parameters" ADD CONSTRAINT "fsrs_parameters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_desired_retention_check" CHECK ("user_settings"."desired_retention" between 85 and 95);