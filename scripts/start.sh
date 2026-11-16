#!/usr/bin/env bash
# Runs the whole Syncro stack with one command (npm start):
# PostgreSQL and Redis in Docker, dependencies, database schema, demo data
# (only when the database is empty), then the API and the web app.
set -euo pipefail

cd "$(dirname "$0")/.."

PG_CONTAINER=syncro-postgres
REDIS_CONTAINER=syncro-redis

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_for() {
  local label="$1" seconds="$2"; shift 2
  for _ in $(seq "$seconds"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "$label did not become ready within ${seconds}s."
}

# 1. Checks
command -v node >/dev/null || die "Node.js 20 or newer is required. Install it from https://nodejs.org"
command -v npm >/dev/null || die "npm is required."
command -v docker >/dev/null || die "Docker is required for PostgreSQL and Redis. Install Docker and try again."
docker info >/dev/null 2>&1 || die "Docker is not running, or your user cannot access it. Start Docker and try again."

for port in 3000 4000; do
  if port_in_use "$port"; then
    die "Port $port is already in use. Stop the program using it, then run npm start again."
  fi
done

# 2. PostgreSQL and Redis
log "Starting PostgreSQL and Redis"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
else
  # Fallback for Docker installs without the compose plugin. Keep these settings in sync with docker-compose.yml.
  start_container() {
    local name="$1"; shift
    if docker ps -q -f "name=^${name}$" | grep -q .; then
      return 0
    elif docker ps -aq -f "name=^${name}$" | grep -q .; then
      docker start "$name" >/dev/null
    else
      docker run -d --name "$name" --restart unless-stopped "$@" >/dev/null
    fi
  }
  start_container "$PG_CONTAINER" \
    -e POSTGRES_USER=syncro -e POSTGRES_PASSWORD=syncro_password -e POSTGRES_DB=syncro_db \
    -p 5433:5432 -v syncro_pgdata:/var/lib/postgresql/data postgres:16-alpine
  start_container "$REDIS_CONTAINER" \
    -p 6380:6379 -v syncro_redisdata:/data redis:7-alpine
fi

wait_for "PostgreSQL" 60 docker exec "$PG_CONTAINER" pg_isready -U syncro -d syncro_db
wait_for "Redis" 30 docker exec "$REDIS_CONTAINER" redis-cli ping

# 3. Configuration and dependencies
if [ ! -f server/.env ]; then
  log "Creating server/.env from server/.env.example"
  cp server/.env.example server/.env
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  log "Installing dependencies"
  npm install
fi

# 4. Database schema and demo data
log "Creating database tables"
npm run db:migrate

users=$(docker exec "$PG_CONTAINER" psql -U syncro -d syncro_db -tAc 'SELECT COUNT(*) FROM users')
if [ "$users" = "0" ]; then
  log "Loading the demo company (first run only)"
  npm run db:seed
fi

# 5. Start the API and the web app. Each runs in its own process group so Ctrl+C stops both.
set -m
log "Starting the API and the web app"
(cd server && exec npx tsx watch src/index.ts) &
SERVER_PID=$!
(cd client && exec npx next dev -p 3000) &
CLIENT_PID=$!

cleanup() {
  trap - INT TERM EXIT
  kill -TERM -- "-$SERVER_PID" "-$CLIENT_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

wait_for "The API" 60 curl -sf http://localhost:4000/api/health

cat <<'EOF'

  Syncro is running

  Web app:  http://localhost:3000   (the first page load takes a few seconds)
  API:      http://localhost:4000

  Sign in with any demo account. The password is: password123
    sarah.admin@syncro.io      admin
    marcus.manager@syncro.io   manager (IT)
    alex.it@syncro.io          employee (IT)

  Press Ctrl+C to stop the app. PostgreSQL and Redis keep running in Docker.

EOF

wait "$SERVER_PID" "$CLIENT_PID"
