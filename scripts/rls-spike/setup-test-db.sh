#!/usr/bin/env bash
# T1B RLS spike — provisions a throwaway LOCAL Postgres database and two
# roles that mirror the Neon owner/runtime split described in
# Docs/T1B_RLS_SPIKE_FINDINGS.md:
#
#   rls_spike_owner  — creates/owns the spike table (stands in for the
#                       DIRECT_URL migration role). Bypasses RLS as owner,
#                       so it is never used at runtime.
#   rls_spike_app    — NOSUPERUSER, NOBYPASSRLS, not the table owner
#                       (stands in for the pooled DATABASE_URL runtime role).
#                       Only role the spike's runtime code connects as.
#
# This is a local, synthetic, disposable database. It is not Neon, it holds
# no real environmental or tenant data, and this script must never be
# pointed at a production connection string.
#
# Usage: scripts/rls-spike/setup-test-db.sh
# Prints two env vars to stdout (eval "$(...)" to load them):
#   RLS_SPIKE_OWNER_DATABASE_URL
#   RLS_SPIKE_APP_DATABASE_URL

set -euo pipefail

DB_NAME="${RLS_SPIKE_DB_NAME:-paragon_rls_spike_test}"
OWNER_ROLE="${RLS_SPIKE_OWNER_ROLE:-rls_spike_owner}"
OWNER_PASSWORD="${RLS_SPIKE_OWNER_PASSWORD:-rls_spike_owner_local_only}"
APP_ROLE="${RLS_SPIKE_APP_ROLE:-rls_spike_app}"
APP_PASSWORD="${RLS_SPIKE_APP_PASSWORD:-rls_spike_app_local_only}"
PSQL="${RLS_SPIKE_PSQL:-sudo -u postgres psql -v ON_ERROR_STOP=1}"

$PSQL -tc "SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}'" | grep -q 1 || \
  $PSQL -c "CREATE ROLE ${OWNER_ROLE} LOGIN PASSWORD '${OWNER_PASSWORD}';"

# Deliberately NOT superuser and NOT granted BYPASSRLS: this is the whole
# point of the spike (Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §9 "Direct
# application role cannot disable RLS").
$PSQL -tc "SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}'" | grep -q 1 || \
  $PSQL -c "CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${APP_PASSWORD}';"

$PSQL -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
  $PSQL -c "CREATE DATABASE ${DB_NAME} OWNER ${OWNER_ROLE};"

$PSQL -d "${DB_NAME}" -c "GRANT CONNECT ON DATABASE ${DB_NAME} TO ${APP_ROLE};"
$PSQL -d "${DB_NAME}" -c "GRANT USAGE ON SCHEMA public TO ${APP_ROLE};"
# No table grants here: the spike's own Prisma migration grants exactly the
# DML privileges the app role needs on RlsSpikeRecord, and only that table —
# provisioning stays out-of-band from the migration's schema/RLS work,
# matching how Neon role/grant provisioning would work in a real rollout.

echo "export RLS_SPIKE_OWNER_DATABASE_URL=\"postgresql://${OWNER_ROLE}:${OWNER_PASSWORD}@localhost:5432/${DB_NAME}?schema=public\""
echo "export RLS_SPIKE_APP_DATABASE_URL=\"postgresql://${APP_ROLE}:${APP_PASSWORD}@localhost:5432/${DB_NAME}?schema=public\""
