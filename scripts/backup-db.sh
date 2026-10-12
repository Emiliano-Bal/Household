#!/usr/bin/env bash
# Full logical backup of the database to a timestamped local file.
#
#   npm run db:backup                 # uses DATABASE_URL from the environment or .env
#   npm run db:backup -- --out ~/bk   # write somewhere other than ./backups
#
# Restore with:
#   pg_restore --clean --if-exists --no-owner --no-privileges -d "<target url>" <file>
#
# This is the backup that does not depend on anyone's hosting plan.
set -euo pipefail

OUT_DIR="backups"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Fall back to .env so this works the same way the app does, without
# making the caller export anything by hand.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set, and no .env to read it from." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  cat >&2 <<'MSG'
ERROR: pg_dump is not installed.

  macOS:  brew install libpq && brew link --force libpq
  Debian: sudo apt-get install postgresql-client-17

It must be version 17 or newer — this database runs PostgreSQL 17, and an
older pg_dump refuses to dump a newer server rather than producing a
partial file.
MSG
  exit 1
fi

# A major version older than the server is a hard stop, not a warning:
# pg_dump will not dump a server newer than itself.
CLIENT_MAJOR="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if [ "$CLIENT_MAJOR" -lt 17 ]; then
  echo "ERROR: pg_dump is version $CLIENT_MAJOR but the server is 17. Install a 17+ client (see above)." >&2
  exit 1
fi

# pg_dump needs a real session. Supabase's transaction pooler (port 6543)
# cannot serve one, so swap it for the session pooler automatically rather
# than letting the dump fail with a confusing protocol error.
if printf '%s' "$DATABASE_URL" | grep -q ':6543/'; then
  echo "note: rewriting port 6543 (transaction pooler) to 5432 (session pooler) — pg_dump needs a session connection"
  DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed 's/:6543\//:5432\//')"
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/gastos-$STAMP.dump"

echo "Dumping to $FILE ..."
# Custom format (-Fc): compressed, and restorable selectively with
# pg_restore. --no-owner/--no-privileges so it restores cleanly into a
# database owned by a different role, which is the usual case when
# restoring into a fresh project.
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="$FILE" \
  "$DATABASE_URL"

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
if [ "$SIZE" -lt 1000 ]; then
  echo "ERROR: $FILE is only ${SIZE} bytes — that is too small to be a real dump." >&2
  exit 1
fi

echo "Wrote $FILE (${SIZE} bytes)"
echo
echo "Verify it lists your tables:"
echo "  pg_restore --list \"$FILE\" | grep TABLE"
