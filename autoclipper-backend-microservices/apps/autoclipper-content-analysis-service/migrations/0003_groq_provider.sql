-- Transcripción en la nube con Groq (Whisper large-v3).
ALTER TABLE transcripts DROP CONSTRAINT IF EXISTS transcripts_provider_check;
--> statement-breakpoint
ALTER TABLE transcripts ADD CONSTRAINT transcripts_provider_check CHECK(provider IN ('whisper_cpp','deepgram','groq'));
