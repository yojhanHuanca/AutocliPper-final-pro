#!/usr/bin/env bash
set -euo pipefail
for service in identity workspace project; do
  upper="${service^^}"
  owner_var="${upper}_OWNER_PASSWORD"
  runtime_var="${upper}_RUNTIME_PASSWORD"
  psql --username "$POSTGRES_USER" --dbname postgres -v ON_ERROR_STOP=1 \
    --set=owner="autoclipper_${service}_owner" --set=runtime="autoclipper_${service}_runtime" --set=database="autoclipper_${service}" \
    --set=owner_password="${!owner_var}" --set=runtime_password="${!runtime_var}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'owner', :'owner_password') WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'runtime', :'runtime_password') WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'runtime') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'owner') WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=:'database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I,%I', :'database', :'owner', :'runtime') \gexec
SQL
  psql --username "$POSTGRES_USER" --dbname "autoclipper_${service}" -v ON_ERROR_STOP=1 \
    --set=owner="autoclipper_${service}_owner" --set=runtime="autoclipper_${service}_runtime" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO %I', :'owner', :'runtime') \gexec
SQL
done
