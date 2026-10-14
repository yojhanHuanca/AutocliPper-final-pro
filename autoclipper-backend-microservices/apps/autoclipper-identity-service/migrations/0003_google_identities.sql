CREATE TABLE external_identities(provider text NOT NULL CHECK(provider='google'),subject text NOT NULL,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider_email text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(provider,subject),UNIQUE(user_id,provider));
--> statement-breakpoint
