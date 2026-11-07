#!/usr/bin/env bash
# Run on the Actions runner. Remote work survives SSH disconnects.
set -euo pipefail
revision=${GITHUB_SHA:?}
run=${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$run" =~ ^[0-9]+-[0-9]+$ ]] || exit 1
allowed=" web market-data backtest payments "
requested=()
if [ -n "${BUILD_SERVICES:-}" ]; then read -r -a requested <<< "$BUILD_SERVICES"; fi
for service in "${requested[@]}"; do
  [[ "$allowed" == *" $service "* ]] || { printf 'Invalid service: %s\n' "$service" >&2; exit 1; }
done
service_args=""
if ((${#requested[@]})); then service_args=" ${requested[*]}"; fi
unit="btcusd-deploy-$run"
state="/var/log/btcusd-deploy/$run"
remote() {
  timeout 60 tailscale ssh "root@${DEPLOY_HOST:?}" "$1" </dev/null
}
# The same unit name makes a retried start idempotent, including when the
# connection was lost after systemd accepted the original request.
start="set -eu; mkdir -p '$state'; chmod 700 '$state'; if ! systemctl show '$unit.service' --property=LoadState --value | grep -qx loaded; then tar -xOf '/tmp/btcusd-release-$revision.tar.gz' deployment/deploy-release.sh > '$state/deploy.sh'; systemd-run --unit='$unit' --property=RemainAfterExit=yes /bin/bash -c 'set +e; bash \"$state/deploy.sh\" \"$revision\"$service_args > \"$state/output.log\" 2>&1; code=\$?; printf \"%s\\n\" \"\$code\" > \"$state/exit-code.tmp\"; mv \"$state/exit-code.tmp\" \"$state/exit-code\"; exit \"\$code\"'; fi"
started=false
deadline=$((SECONDS + 1800))
while ((SECONDS < deadline)); do
  if [ "$started" = false ]; then
    if remote "$start"; then started=true; else printf 'Deployment start unconfirmed; reconnecting to %s\n' "$unit" >&2; fi
  fi
  if [ "$started" = true ]; then
    if status=$(remote "if test -f '$state/exit-code'; then cat '$state/exit-code'; else printf 'pending\\n'; fi"); then
      case "$status" in
        0)
          remote "cat '$state/output.log'" || true
          if deployed_revision=$(remote 'cat /opt/btcusd-tester/.deployed-revision'); then
            if [ "$deployed_revision" = "$revision" ]; then
              printf 'Verified deployment %s\n' "$revision"
              exit 0
            fi
            printf 'Deployment revision mismatch: expected %s, got %s\n' "$revision" "$deployed_revision" >&2
            exit 1
          fi
          ;;
        pending) printf 'Deployment %s is running\n' "$unit" ;;
        *)
          printf 'Remote deployment failed (exit code %s); log: %s/output.log\n' "$status" "$state" >&2
          remote "cat '$state/output.log'" || true
          exit 1
          ;;
      esac
    else
      printf 'Deployment connection interrupted; reconnecting\n' >&2
    fi
  fi
  sleep 15
done
printf 'Deployment confirmation timed out; remote task may still be running. Inspect systemctl status %s and %s/output.log\n' "$unit" "$state" >&2
exit 1
