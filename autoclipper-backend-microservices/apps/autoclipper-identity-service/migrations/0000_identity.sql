CREATE TABLE users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,password_hash text NOT NULL,verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz);
--> statement-breakpoint
CREATE INDEX sessions_user_idx ON sessions(user_id);
--> statement-breakpoint
CREATE TABLE access_tokens(token_hash text PRIMARY KEY,session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL);
--> statement-breakpoint
CREATE INDEX access_session_idx ON access_tokens(session_id);
--> statement-breakpoint
CREATE TABLE refresh_tokens(token_hash text PRIMARY KEY,session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,consumed_at timestamptz);
--> statement-breakpoint
CREATE INDEX refresh_session_idx ON refresh_tokens(session_id);
--> statement-breakpoint
CREATE TABLE verification_tokens(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,purpose text NOT NULL CHECK(purpose IN ('verify','reset')),expires_at timestamptz NOT NULL,consumed_at timestamptz);
--> statement-breakpoint
CREATE TABLE mail_outbox(id uuid PRIMARY KEY,payload text NOT NULL,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz);
--> statement-breakpoint
CREATE INDEX mail_pending_idx ON mail_outbox(next_attempt_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
