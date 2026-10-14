ALTER TABLE uploads ADD COLUMN signed_until timestamptz NOT NULL DEFAULT now();
