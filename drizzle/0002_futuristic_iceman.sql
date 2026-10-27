CREATE TABLE "tts_audio" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tts_audio_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"engine" text NOT NULL,
	"voice" text NOT NULL,
	"text_hash" char(64) NOT NULL,
	"telegram_file_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tts_audio_engine_voice_text_hash_unique" UNIQUE("engine","voice","text_hash")
);
