# Restoring BuildManager from a backup

Backups are at `/home/docker/buildmanager-backups/`, newest last.
Each is a plain `.tar.gz` — no special tooling needed to read it.

## What's inside

    mongo/              the database files
    uploads/            drawings, quotes, photos, documents
    backend.env         config: database name, Gmail credentials, signature
    docker-compose.yml  the stack as it was at backup time

## Restore

    cd /home/docker/Build-manager
    docker compose down

    # Move the current data aside rather than deleting it — if the restore is
    # wrong you still have the present state to go back to.
    mv /home/docker/buildmanager-data /home/docker/buildmanager-data.before-restore
    mkdir -p /home/docker/buildmanager-data

    ARCHIVE=/home/docker/buildmanager-backups/buildmanager-YYYYMMDD-HHMMSS.tar.gz
    docker run --rm -v $ARCHIVE:/a.tar.gz:ro \
      -v /home/docker/buildmanager-data:/out alpine tar -xzf /a.tar.gz -C /out

    cp /home/docker/buildmanager-data/backend.env backend/.env
    docker compose up -d

Check the Jobs list loads and a document downloads, then remove
`buildmanager-data.before-restore`.

## Check a backup without restoring

    ARCHIVE=/home/docker/buildmanager-backups/buildmanager-YYYYMMDD-HHMMSS.tar.gz
    R=/tmp/restore-test && mkdir -p $R
    docker run --rm -v $ARCHIVE:/a.tar.gz:ro -v $R:/out alpine tar -xzf /a.tar.gz -C /out
    docker run -d --name restore-check -v $R/mongo:/data/db mongo:7
    docker exec restore-check mongosh buildmanager --quiet \
      --eval 'db.projects.find({},{_id:0,name:1}).forEach(p=>print(p.name))'
    docker rm -f restore-check

## Schedule

Sundays at 03:00, keeping the last 8. Log: `buildmanager-backups/backup.log`.
Services stop for about 10 seconds so the database and the uploads directory
are captured at the same instant.

Run one now:

    /home/docker/Build-manager/ops/backup.sh
