ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{"locale":"es","timezone":"America/Lima","emailNotifications":true,"theme":"system"}';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN profile_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE user_mfa(user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret_cipher text,pending_cipher text,pending_expires_at timestamptz,enabled boolean NOT NULL DEFAULT false,last_step bigint NOT NULL DEFAULT -1);
--> statement-breakpoint
CREATE TABLE recovery_codes(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash text NOT NULL,consumed_at timestamptz,PRIMARY KEY(user_id,code_hash));
--> statement-breakpoint
CREATE TABLE privacy_requests(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('export','deletion')),state text NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','processing','completed','rejected')),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
--> statement-breakpoint
CREATE UNIQUE INDEX pending_privacy_request_idx ON privacy_requests(user_id,kind) WHERE state='requested';
