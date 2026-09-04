#!/usr/bin/env bash
# Weekly cold backup for BuildManager.
#
# Cold means the services are stopped while the files are copied, so the
# database is not mid-write and the uploads directory matches what the database
# says about it. That costs about a minute of downtime; run it when nobody is
# on site. A hot mongodump would avoid the downtime but cannot guarantee that a
# quote row and the PDF it points at are captured at the same instant.
#
# Restores by extracting over the data directory — no tooling required.
set -euo pipefail

DATA_DIR=${DATA_DIR:-/home/docker/buildmanager-data}
BACKUP_DIR=${BACKUP_DIR:-/home/docker/buildmanager-backups}
COMPOSE_DIR=${COMPOSE_DIR:-/home/docker/Build-manager}
KEEP_WEEKS=${KEEP_WEEKS:-8}

STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/buildmanager-$STAMP.tar.gz"
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"
say() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG"; }

started=$(date +%s)
say "=== backup starting -> $ARCHIVE"

cd "$COMPOSE_DIR"

# Always bring the stack back, even if the copy fails part way through.
restore_services() {
  say "restarting services"
  docker compose up -d >/dev/null 2>&1 || say "WARNING: could not restart services — check manually"
}
trap restore_services EXIT

say "stopping services for a consistent copy"
docker compose stop backend frontend mongo >/dev/null 2>&1

# The database files belong to the mongo container's user, so the host account
# cannot read them. Archive from inside a container instead of reaching for
# sudo — and never silence tar, because a backup that quietly skips the
# database is worse than no backup at all.
#
# Config travels with the data: without .env a restore has no database name,
# no Gmail credentials and no signature.
say "archiving database, uploads and config"
cp "$COMPOSE_DIR/docker-compose.yml" "$DATA_DIR/docker-compose.yml"
cp "$COMPOSE_DIR/backend/.env" "$DATA_DIR/backend.env"
docker run --rm \
  -v "$DATA_DIR":/data:ro \
  -v "$BACKUP_DIR":/out \
  alpine tar -czf "/out/$(basename "$ARCHIVE")" -C /data mongo uploads docker-compose.yml backend.env
rm -f "$DATA_DIR/docker-compose.yml" "$DATA_DIR/backend.env"

say "verifying the archive is readable and complete"
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
  say "FAILED: archive is corrupt, removing it"
  rm -f "$ARCHIVE"
  exit 1
fi
# List once into a file. Piping tar into `grep -q` makes grep exit on the first
# match, which SIGPIPEs tar — and under `set -o pipefail` that reads as a
# failure even though the entry was found.
LISTING=$(mktemp)
tar -tzf "$ARCHIVE" > "$LISTING"
entries=$(wc -l < "$LISTING")
for expected in "mongo/WiredTiger" "uploads/" "backend.env" "docker-compose.yml"; do
  if ! grep -q "$expected" "$LISTING"; then
    say "FAILED: $expected missing from archive"
    rm -f "$ARCHIVE" "$LISTING"; exit 1
  fi
done
rm -f "$LISTING"
# A backup smaller than the database it claims to contain has skipped something.
db_bytes=$(docker run --rm -v "$DATA_DIR":/d:ro alpine du -sb /d/mongo | cut -f1)
arc_bytes=$(stat -c%s "$ARCHIVE")
say "database on disk $(numfmt --to=iec $db_bytes), archive $(numfmt --to=iec $arc_bytes)"
if [ "$arc_bytes" -lt $((db_bytes / 20)) ]; then
  say "FAILED: archive is implausibly small for the data it should hold"
  rm -f "$ARCHIVE"; exit 1
fi

size=$(du -h "$ARCHIVE" | cut -f1)
say "archive ok — $entries entries, $size"

# Retention. Only ever deletes files this script created.
removed=$(find "$BACKUP_DIR" -maxdepth 1 -name 'buildmanager-*.tar.gz' -type f \
  | sort -r | tail -n +$((KEEP_WEEKS + 1)) | tee >(xargs -r rm -f) | wc -l)
[ "$removed" -gt 0 ] && say "pruned $removed backup(s) older than the last $KEEP_WEEKS"

say "kept: $(find "$BACKUP_DIR" -maxdepth 1 -name 'buildmanager-*.tar.gz' | wc -l) backup(s), $(du -sh "$BACKUP_DIR" | cut -f1) total"
say "=== done in $(( $(date +%s) - started ))s"
