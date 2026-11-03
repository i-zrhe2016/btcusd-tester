#!/usr/bin/env bash
set -euo pipefail

revision=${1:?Expected release commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { printf 'Invalid commit SHA\n' >&2; exit 1; }
cd /opt/btcusd-tester
exec 9>/var/lock/btcusd-tester-deploy.lock
flock -n 9 || { printf 'Another deployment is running\n' >&2; exit 1; }
archive="/tmp/btcusd-release-$revision.tar.gz"
test -s "$archive"
backup="/opt/btcusd-tester-backups/$revision"
mkdir -p "$backup"
chmod 700 "$backup"
docker compose exec -T --interactive=false postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup/database.sql"
chmod 600 "$backup/database.sql"
services=(web market-data backtest)
for service in "${services[@]}"; do
  container=$(docker compose ps -q "$service")
  image=$(docker inspect --format '{{.Image}}' "$container")
  docker image tag "$image" "btcusd-rollback-$service:$revision"
done
tar -czf "$backup/source.tar.gz" frontend services deployment Cargo.toml Cargo.lock docker-compose.yml .dockerignore
rollback() {
  trap - ERR
  printf 'Deployment failed; restoring previous images and source\n' >&2
  tar -xzf "$backup/source.tar.gz"
  for service in "${services[@]}"; do
    docker image tag "btcusd-rollback-$service:$revision" "btcusd-tester-$service:latest"
  done
  docker compose up -d --no-build --wait --wait-timeout 180
}
trap rollback ERR
# git archive excludes production .env, Compose overrides, data and certificates.
tar -xzf "$archive"
docker compose build web market-data backtest
docker compose up -d --no-build --wait --wait-timeout 180
curl --fail --silent --show-error --max-time 15 http://localhost:8083/healthz
curl --fail --silent --show-error --max-time 30 http://localhost:8083/api/market/meta > /dev/null
printf '%s\n' "$revision" > .deployed-revision
trap - ERR
printf 'Deployed %s\n' "$revision"
