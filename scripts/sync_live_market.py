"""Kraken public OHLC live tail for the ten USD markets. Run with Python -I.

The full-history Parquet files are rebuilt by sync_crypto_history.py; this
script only keeps a small recent window per market current so the replay page
can reach the latest completed minute without a full archive rewrite.

Each cycle fetches Kraken's public 1-minute OHLC endpoint (last 720 minutes),
merges the completed candles into <output>/<symbol>_1m.live.json, and replaces
the file atomically. The in-progress minute is never published: the replay
model treats every candle as closed.
"""
import argparse
import json
import math
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

MARKETS = {
    'BTCUSD': 'XBTUSD', 'ETHUSD': 'ETHUSD', 'BNBUSD': 'BNBUSD',
    'XRPUSD': 'XRPUSD', 'SOLUSD': 'SOLUSD', 'TRXUSD': 'TRXUSD',
    'ZECUSD': 'ZECUSD', 'HYPEUSD': 'HYPEUSD', 'DOGEUSD': 'XDGUSD', 'XMRUSD': 'XMRUSD',
}
OHLC_URL = 'https://api.kraken.com/0/public/OHLC?pair={pair}&interval=1'
# Kraken returns at most the last 720 one-minute candles per request.
REMOTE_WINDOW_MINUTES = 720
DEFAULT_RETAIN_MINUTES = 3 * 24 * 60
USER_AGENT = 'grailab-live-market/1.0'


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)


def fetch_json(url, timeout, attempts=4):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(min(2 ** attempt, 10))


def parse_ohlc(body, pair):
    """Return raw 1-minute rows from a Kraken OHLC response."""
    if body.get('error'):
        raise ValueError(f'Kraken: {body["error"]}')
    result = body.get('result') or {}
    rows = result.get(pair)
    if not isinstance(rows, list):
        candidates = [value for value in result.values() if isinstance(value, list)]
        if len(candidates) != 1:
            raise ValueError(f'{pair}: unexpected OHLC response shape')
        rows = candidates[0]
    candles = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 7:
            raise ValueError(f'{pair}: invalid OHLC row')
        candles.append((
            int(row[0]), float(row[1]), float(row[2]), float(row[3]),
            float(row[4]), float(row[6]),
        ))
    return candles


def valid_candle(candle):
    timestamp, op, high, low, close, volume = candle
    return (
        isinstance(timestamp, int) and timestamp >= 0 and timestamp % 60 == 0
        and all(isinstance(value, (int, float)) and math.isfinite(value) for value in candle[1:])
        and min(op, high, low, close) > 0
        and low <= min(op, close) <= max(op, close) <= high
        and volume >= 0
    )


def normalize(candles, completed_before, retain):
    """Validate, deduplicate by timestamp (later rows win), drop the forming
    minute and keep only the most recent window."""
    unique = {}
    for candle in candles:
        if not valid_candle(candle):
            raise ValueError(f'invalid live candle {candle}')
        unique[int(candle[0])] = tuple(candle)
    ordered = [unique[timestamp] for timestamp in sorted(unique) if timestamp < completed_before]
    return ordered[-retain:]


def read_live(path):
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding='utf-8'))
    rows = payload.get('candles')
    if not isinstance(rows, list):
        raise ValueError(f'{path}: missing candles array')
    candles = [tuple(row) for row in rows if isinstance(row, list) and len(row) == 6]
    if len(candles) != len(rows):
        raise ValueError(f'{path}: invalid candle entry')
    return candles


def write_live(path, symbol, candles, updated_at):
    payload = {
        'symbol': symbol,
        'source': 'Kraken OHLC',
        'interval': 60,
        'updated_at': updated_at,
        'first_timestamp': candles[0][0],
        'last_timestamp': candles[-1][0],
        'candle_count': len(candles),
        'candles': [list(candle) for candle in candles],
    }
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(payload, stream, ensure_ascii=False, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def update_symbol(symbol, output, retain, timeout, now=None):
    now = time.time() if now is None else now
    current_minute = int(now) - int(now) % 60
    path = output / f'{symbol.lower()}_1m.live.json'
    existing = read_live(path)
    pair = MARKETS[symbol]
    url = OHLC_URL.format(pair=pair)
    if existing:
        last_timestamp = existing[-1][0]
        lag = current_minute - last_timestamp
        if lag > REMOTE_WINDOW_MINUTES * 60:
            emit('live_window_reset', symbol=symbol, lag_minutes=lag // 60)
        else:
            url = f'{url}&since={last_timestamp}'
    fetched = parse_ohlc(fetch_json(url, timeout), pair)
    merged = normalize([*existing, *fetched], current_minute, retain)
    if not merged:
        raise ValueError('no completed candles returned')
    if merged == existing:
        emit('live_unchanged', symbol=symbol, last_timestamp=merged[-1][0], candles=len(merged))
        return False
    write_live(path, symbol, merged, datetime.now(timezone.utc).isoformat())
    emit('live_published', symbol=symbol, first_timestamp=merged[0][0],
         last_timestamp=merged[-1][0], candles=len(merged))
    return True


def run(args):
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    symbols = args.symbols.split(',') if args.symbols else list(MARKETS)
    unsupported = [symbol for symbol in symbols if symbol not in MARKETS]
    if unsupported:
        raise ValueError(f'unsupported symbol {unsupported[0]}')
    retain = max(60, args.retain_minutes)
    while True:
        started = time.time()
        failures = []
        for index, symbol in enumerate(symbols):
            try:
                update_symbol(symbol, output, retain, args.timeout)
            except Exception as error:
                failures.append(symbol)
                emit('live_failed', symbol=symbol, error=str(error))
            if index < len(symbols) - 1:
                time.sleep(max(1.0, args.pause))
        emit('live_cycle', symbols=symbols, failed=failures, seconds=round(time.time() - started, 1))
        if args.once:
            break
        elapsed = time.time() - started
        time.sleep(max(1.0, args.interval - elapsed))
    if failures:
        raise RuntimeError(f'Incomplete markets: {failures}; rerun to resume')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='data/market/live', help='directory for live JSON snapshots')
    parser.add_argument('--symbols', help='comma-separated canonical USD symbols; default all ten')
    parser.add_argument('--interval', type=float, default=60, help='seconds between cycles')
    parser.add_argument('--retain-minutes', type=int, default=DEFAULT_RETAIN_MINUTES)
    parser.add_argument('--pause', type=float, default=1.1, help='seconds between public OHLC requests')
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('--once', action='store_true', help='run a single cycle and exit')
    arguments = parser.parse_args()
    if arguments.interval < 10:
        parser.error('interval must be at least 10 seconds')
    if arguments.pause < 1:
        parser.error('pause must be at least 1 second')
    run(arguments)
