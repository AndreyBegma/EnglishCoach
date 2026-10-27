CREATE TABLE "tts_status_board" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"message_id" integer,
	"failures_on" date,
	"failures" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
