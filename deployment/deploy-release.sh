#!/usr/bin/env bash
set -euo pipefail

revision=${1:?Expected release commit SHA}
shift
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { printf 'Invalid commit SHA\n' >&2; exit 1; }

all_services=(web market-data backtest payments)
allowed=" ${all_services[*]} "
requested=("$@")
for service in "${requested[@]}"; do
  [[ "$allowed" == *" $service "* ]] || { printf 'Invalid service: %s\n' "$service" >&2; exit 1; }
done
if ((${#requested[@]})); then
  build_services=("${requested[@]}")
else
  build_services=("${all_services[@]}")
fi

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

# Record the image each running service was created from. Compose normally
# stores the project image reference, but fall back to the project/service
# convention when Docker reports a bare image ID.
image_refs=()
for service in "${all_services[@]}"; do
  container=$(docker compose ps -q "$service")
  [ -n "$container" ] || { printf 'No running container for %s\n' "$service" >&2; exit 1; }
  read -r image project < <(docker inspect --format '{{.Config.Image}} {{index .Config.Labels "com.docker.compose.project"}}' "$container")
  if [[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    image="${project:-btcusd-tester}-$service:latest"
  fi
  image_refs+=("$image")
  docker image tag "$image" "btcusd-rollback-$service:$revision"
done

tar -czf "$backup/source.tar.gz" frontend services deployment scripts Cargo.toml Cargo.lock docker-compose.yml .dockerignore
rollback() {
  trap - ERR
  printf 'Deployment failed; restoring previous images and source\n' >&2
  tar -xzf "$backup/source.tar.gz"
  for index in "${!all_services[@]}"; do
    docker image tag "btcusd-rollback-${all_services[$index]}:$revision" "${image_refs[$index]}"
  done
  docker compose up -d --no-build --wait --wait-timeout 180
}
trap rollback ERR
# git archive excludes production .env, Compose overrides, data and certificates.
tar -xzf "$archive"
docker compose build "${build_services[@]}"
docker compose up -d --no-build --wait --wait-timeout 180

# payments has no Docker healthcheck; probe its HTTP endpoint from inside the
# container so the check does not depend on a host-published port.
docker compose exec -T --interactive=false payments \
  node -e 'fetch("http://127.0.0.1:8083/health").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'

curl --fail --silent --show-error --max-time 15 http://localhost:8083/healthz
curl --fail --silent --show-error --max-time 30 http://localhost:8083/api/market/meta > /dev/null
printf '%s\n' "$revision" > .deployed-revision
trap - ERR

# Keep the last five releases available for rollback.
history=.release-history
printf '%s\n' "$revision" >> "$history"
mapfile -t history_revisions < <(awk '!seen[$0]++' "$history")
printf '%s\n' "${history_revisions[@]}" > "$history"
if ((${#history_revisions[@]} > 5)); then
  for old in "${history_revisions[@]:0:${#history_revisions[@]}-5}"; do
    for service in "${all_services[@]}"; do
      docker image rm "btcusd-rollback-$service:$old" >/dev/null 2>&1 || true
    done
    rm -rf "/opt/btcusd-tester-backups/$old"
  done
  printf '%s\n' "${history_revisions[@]: -5}" > "$history"
fi
docker image prune -f >/dev/null 2>&1 || true

printf 'Deployed %s (rebuilt: %s)\n' "$revision" "${build_services[*]}"
