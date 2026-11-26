-- Role passwords are applied by init-roles.sh.
-- The official Postgres image does not expand environment variables inside .sql files.
-- gchopro_owner is POSTGRES_USER. The image makes that user a superuser in local Compose.
-- gchopro_app is the runtime role. Table grants are applied by packages/db after migrations.
CREATE EXTENSION IF NOT EXISTS citext;
