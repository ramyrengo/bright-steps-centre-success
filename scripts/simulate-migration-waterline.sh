#!/usr/bin/env bash
#
# Reproduce, and prove the repair for, the staging migration waterline failure.
#
# `main` carried migrations 001-019 and then jumped to 026-029. 020-025 were
# merged later, below a version staging had already passed. golang-migrate keeps
# a single watermark and applies only versions above it, so on staging those six
# migrations are permanently stranded and 030 runs against a schema that migration
# 024 never touched.
#
# A from-scratch database applies 001-032 in order and is therefore the one shape
# that cannot show this. This harness builds the shape that matters instead:
#
#   v29     001-019 and 026-029 applied, 020-025 never applied  (staging today)
#   fresh   001-029 applied in order                            (a new database)
#
# and asserts four things:
#
#   1. v29 + 030            fails on the capability foreign key   (the reported bug)
#   2. v29 + 031            fails on a missing 023 table          (a second blocker)
#   3. v29 + 020-025 + 030,031,032 succeeds                       (the repair)
#   4. fresh + 030,031,032  succeeds                              (no regression)
#
# Each migration is applied inside a single transaction, which is how
# golang-migrate's postgres driver executes one migration file.
#
# Usage:  scripts/simulate-migration-waterline.sh
# Requires: Docker.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_DIR="$REPO_ROOT/foundation/migrations"
IMAGE="encoredotdev/postgres:18"
CONTAINER="centre-success-migration-waterline"

failures=0

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

note() { printf '\n\033[1m%s\033[0m\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }

psql_db() {
  docker exec -i -e PGPASSWORD=postgres "$CONTAINER" psql -U postgres -d "$1" "${@:2}"
}

# Apply one migration file in a single transaction. Prints nothing on success;
# on failure prints the first server error line.
apply_migration() {
  local db="$1" file="$2" out
  out=$(psql_db "$db" --single-transaction -v ON_ERROR_STOP=1 -q -f - < "$MIG_DIR/$file" 2>&1)
  local rc=$?
  if [ $rc -ne 0 ]; then
    printf '%s' "$out" | grep -m1 'ERROR:' | sed 's/^[^E]*/          /'
  fi
  return $rc
}

# Apply a list of migrations, stopping at the first failure.
apply_all() {
  local db="$1"; shift
  local file
  for file in "$@"; do
    apply_migration "$db" "$file" || { echo "$file"; return 1; }
  done
  return 0
}

migrations_matching() { ls "$MIG_DIR" | grep -E "^($1)_" | sort; }

V29_BASE=$(migrations_matching '0(0[1-9]|1[0-9])|02[6-9]')
FRESH_BASE=$(migrations_matching '0(0[1-9]|1[0-9])|02[0-9]')
STRANDED=$(migrations_matching '02[0-5]')

build_database() {
  local db="$1"; shift
  psql_db postgres -tAqc "DROP DATABASE IF EXISTS $db;" >/dev/null 2>&1
  psql_db postgres -tAqc "CREATE DATABASE $db;" >/dev/null 2>&1
  apply_all "$db" $@ >/dev/null || { fail "baseline for $db did not apply"; return 1; }
}

note "Starting PostgreSQL ($IMAGE)"
cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null || {
  echo "could not start container -- is Docker running?" >&2; exit 1; }
for _ in $(seq 1 60); do
  docker exec -i "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
psql_db postgres -tAqc 'SELECT 1' >/dev/null 2>&1 || { echo "database never became ready" >&2; exit 1; }
echo "  ready"

note "1. A database at version 29 rejects migration 030 (the reported failure)"
build_database waterline_030 $V29_BASE
if apply_migration waterline_030 030_operational_template_bundle_reconciliation.up.sql; then
  fail "030 unexpectedly succeeded against a version 29 database"
else
  pass "030 fails, as staging does"
fi

note "2. The same database also rejects migration 031, for a different reason"
build_database waterline_031 $V29_BASE
if apply_migration waterline_031 031_operational_template_date_question.up.sql; then
  fail "031 unexpectedly succeeded against a version 29 database"
else
  pass "031 fails independently -- 030 is not the only blocker"
fi

note "3. Replaying the stranded migrations first repairs the database"
build_database waterline_repair $V29_BASE
if broke=$(apply_all waterline_repair $STRANDED \
    030_operational_template_bundle_reconciliation.up.sql \
    031_operational_template_date_question.up.sql \
    032_operational_template_capability_backfill.up.sql); then
  pass "020-025 replay cleanly, then 030, 031 and 032 all apply"
else
  fail "repair path broke at $broke"
fi

note "4. A from-scratch database is unaffected"
build_database waterline_fresh $FRESH_BASE
if broke=$(apply_all waterline_fresh \
    030_operational_template_bundle_reconciliation.up.sql \
    031_operational_template_date_question.up.sql \
    032_operational_template_capability_backfill.up.sql); then
  pass "030, 031 and 032 apply in order"
else
  fail "fresh path broke at $broke"
fi

note "Final capability state (repaired version 29 vs fresh)"
for db in waterline_repair waterline_fresh; do
  codes=$(psql_db "$db" -tAqc \
    "SELECT string_agg(capability_code, ' ' ORDER BY capability_code)
       FROM canonical_role_template_capabilities
      WHERE role_key = 'area_manager' AND role_version = 3
        AND capability_code LIKE 'template.%';")
  printf '  %-18s area_manager v3: %s\n' "${db#waterline_}" "${codes:-<none>}"
done
repaired=$(psql_db waterline_repair -tAqc \
  "SELECT string_agg(code, ' ' ORDER BY code) FROM capabilities WHERE code LIKE 'template.%';")
fresh=$(psql_db waterline_fresh -tAqc \
  "SELECT string_agg(code, ' ' ORDER BY code) FROM capabilities WHERE code LIKE 'template.%';")
if [ -n "$repaired" ] && [ "$repaired" = "$fresh" ]; then
  pass "both databases register the same four codes"
else
  fail "capability vocabulary differs -- repaired='$repaired' fresh='$fresh'"
fi

note "Result"
if [ "$failures" -eq 0 ]; then
  echo "  all checks passed"
  exit 0
fi
echo "  $failures check(s) failed"
exit 1
