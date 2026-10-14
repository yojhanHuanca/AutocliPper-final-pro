#!/usr/bin/env bash
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname postgres \
  --set=owner_password="$MEDIA_OWNER_PASSWORD" \
  --set=runtime_password="$MEDIA_RUNTIME_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE autoclipper_media_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'owner_password') \gexec
SELECT format('CREATE ROLE autoclipper_media_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'runtime_password') \gexec
CREATE DATABASE autoclipper_media OWNER autoclipper_media_owner;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE autoclipper_media FROM PUBLIC;
GRANT CONNECT ON DATABASE autoclipper_media TO autoclipper_media_owner, autoclipper_media_runtime;
\connect autoclipper_media
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO autoclipper_media_owner;
GRANT USAGE ON SCHEMA public TO autoclipper_media_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE autoclipper_media_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autoclipper_media_runtime;
SQL
