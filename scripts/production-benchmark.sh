#!/bin/sh
# Read-only, bounded request sampling through the actual production gateway.
set -eu
for kind in minute forming month; do
  case "$kind" in
    minute) query='timeframe=1m&from=1793400000&to=1793431860&limit=531' ;;
    forming) query='timeframe=1h&from=1793400000&to=1793401800&limit=1' ;;
    month) query='timeframe=1M&from=1546300800&to=1793505780&limit=1001' ;;
  esac
  for round in 1 2 3 4 5 6 7 8 9 10; do
    printf '%s,%s,' "$kind" "$round"
    curl -fsS --max-time 15 -o /dev/null -w '%{http_code},%{time_starttransfer},%{time_total},%{size_download}\n' "http://127.0.0.1:8083/api/market/snapshot?symbol=BTCUSD&$query&lengths=30,120,840"
  done
done
