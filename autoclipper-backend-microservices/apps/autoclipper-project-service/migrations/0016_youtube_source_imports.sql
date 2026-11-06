ALTER TABLE source_imports DROP CONSTRAINT source_imports_provider_check;
ALTER TABLE source_imports ADD CONSTRAINT source_imports_provider_check CHECK (provider IN ('twitch','youtube'));
