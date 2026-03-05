#!/bin/sh
set -e

echo "[Entrypoint] Running Prisma Migrate Deploy..."
# Always ensure the database schema is up-to-date before starting Next.js or the Worker
npx prisma migrate deploy

echo "[Entrypoint] Starting application: $@"
exec "$@"
