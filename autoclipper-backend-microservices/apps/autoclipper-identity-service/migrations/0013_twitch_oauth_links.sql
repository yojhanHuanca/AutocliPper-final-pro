CREATE TABLE twitch_links (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  twitch_user_id text NOT NULL UNIQUE,
  login text NOT NULL CHECK(length(login) BETWEEN 1 AND 25),
  token_cipher text NOT NULL,
  scope text[] NOT NULL CHECK(scope && ARRAY['editor:manage:clips','channel:manage:clips']::text[]),
  token_validated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
