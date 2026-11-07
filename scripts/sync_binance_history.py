"""Binance spot USDT 1m history sync. Run with Python -I.

Downloads official monthly/daily kline archives from data.binance.vision and
fills the tail through the public REST endpoint, then publishes the Parquet
file the market-data service reads. Downloaded archives are untrusted data and
stay in a dedicated cache directory; nothing from them is executed.

XMRUSD is intentionally absent: Binance delisted XMRUSDT in 2024-02, so that
market keeps its Kraken history.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid
import zipfile

MARKETS = {
    'BTCUSD': 'BTCUSDT',
    'ETHUSD': 'ETHUSDT',
    'BNBUSD': 'BNBUSDT',
    'XRPUSD': 'XRPUSDT',
    'SOLUSD': 'SOLUSDT',
    'TRXUSD': 'TRXUSDT',
    'ZECUSD': 'ZECUSDT',
    'HYPEUSD': 'HYPEUSDT',
    'DOGEUSD': 'DOGEUSDT',
}
COLUMNS = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
MONTHLY = 'https://data.binance.vision/data/spot/monthly/klines/{pair}/1m/{pair}-1m-{stamp}.zip'
DAILY = 'https://data.binance.vision/data/spot/daily/klines/{pair}/1m/{pair}-1m-{stamp}.zip'
REST = 'https://data-api.binance.vision/api/v3/klines'
BATCH = 100000


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def fetch(url, attempts=6):
    """Return bytes, or None when the archive does not exist (404)."""
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    url, headers={'User-Agent': 'grailab-history-sync/1.0'}), timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt == attempts - 1:
                raise
        except Exception:
            if attempt == attempts - 1:
                raise
        time.sleep(min(2 ** attempt, 30))


def rest_klines(pair, start_ms, limit=1000):
    url = f'{REST}?symbol={pair}&interval=1m&startTime={start_ms}&limit={limit}'
    payload = fetch(url)
    return json.loads(payload) if payload else []


def first_candle(pair):
    rows = rest_klines(pair, 0, limit=1)
    if not rows:
        raise ValueError(f'{pair}: no candles available')
    return rows[0][0] // 1000


def month_stamps(start_seconds, end_seconds):
    cursor = datetime.fromtimestamp(start_seconds, tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    stop = datetime.fromtimestamp(end_seconds, tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while cursor < stop:
        yield cursor.strftime('%Y-%m')
        cursor = (cursor + timedelta(days=32)).replace(day=1)


def day_stamps(start_seconds, end_seconds):
    cursor = datetime.fromtimestamp(start_seconds, tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    stop = datetime.fromtimestamp(end_seconds, tz=timezone.utc)
    while cursor < stop:
        yield cursor.strftime('%Y-%m-%d')
        cursor += timedelta(days=1)


def download_archive(cache, pair, kind, stamp):
    target = Path(cache) / pair / f'{kind}-{stamp}.zip'
    if target.exists() and target.stat().st_size > 0:
        return target
    template = MONTHLY if kind == 'monthly' else DAILY
    payload = fetch(template.format(pair=pair, stamp=stamp))
    if payload is None:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.zip.tmp')
    temporary.write_bytes(payload)
    os.replace(temporary, target)
    return target


def parse_timestamp(raw):
    value = int(raw)
    # Binance Vision switched 1m klines to microsecond stamps in 2025, and its
    # earliest monthly archives carry millisecond offsets inside the minute.
    seconds = value // 1_000_000 if value >= 10 ** 15 else value // 1000
    return seconds - seconds % 60


def archive_rows(path):
    """Yield (timestamp, open, high, low, close, volume) from one archive."""
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.endswith('.csv')]
        if len(names) != 1:
            raise ValueError(f'{path}: expected one CSV member, found {names}')
        with archive.open(names[0]) as raw:
            for line in io.TextIOWrapper(raw, encoding='utf-8'):
                fields = line.strip().split(',')
                if len(fields) < 6:
                    continue
                try:
                    timestamp = parse_timestamp(fields[0])
                except ValueError:
                    continue  # header row
                yield (timestamp, float(fields[1]), float(fields[2]), float(fields[3]),
                       float(fields[4]), float(fields[5]))


def valid(row, previous):
    timestamp, open_, high, low, close, volume = row
    return (timestamp % 60 == 0
            and (previous is None or timestamp > previous)
            and min(open_, high, low, close) > 0
            and low <= min(open_, close) <= max(open_, close) <= high
            and volume >= 0
            and all(value == value and value not in (float('inf'), float('-inf')) for value in row[1:]))


def parquet_bounds(path):
    import pyarrow.parquet as pq
    values = []
    with pq.ParquetFile(path) as file:
        for batch in file.iter_batches(columns=['timestamp'], batch_size=BATCH):
            column = [value for value in batch.column(0).to_pylist() if value is not None]
            if len(column) != len(batch):
                raise ValueError('existing history has null timestamps')
            values.extend(column)
    return (min(values), max(values), len(values)) if values else (None, None, 0)


class Writer:
    """Streams validated rows into a candidate Parquet file in fixed batches."""

    def __init__(self, path):
        import pyarrow as pa
        import pyarrow.parquet as pq
        self.schema = pa.schema([pa.field('timestamp', pa.int64(), nullable=False)] +
                                [pa.field(name, pa.float64(), nullable=False) for name in COLUMNS[1:]])
        self.writer = pq.ParquetWriter(path, self.schema, compression='snappy')
        self.buffer = []
        self.count = 0
        self.first = None
        self.last = None
        self.gaps = 0

    def add(self, row):
        if not valid(row, self.last):
            raise ValueError(f'invalid or unordered candle: {row}')
        if self.last is not None:
            self.gaps += max(0, (row[0] - self.last) // 60 - 1)
        self.first = row[0] if self.first is None else self.first
        self.last = row[0]
        self.count += 1
        self.buffer.append(row)
        if len(self.buffer) >= BATCH:
            self.flush()

    def flush(self):
        import pyarrow as pa
        if not self.buffer:
            return
        columns = list(zip(*self.buffer))
        self.writer.write_table(pa.Table.from_arrays(
            [pa.array(values, type=field.type) for values, field in zip(columns, self.schema)],
            schema=self.schema))
        self.buffer.clear()

    def close(self):
        self.flush()
        self.writer.close()


def sync_symbol(symbol, pair, cache, output, workers):
    output = Path(output)
    now = int(time.time())
    start = first_candle(pair)
    emit('started', symbol=symbol, pair=pair, first=start)
    months = list(month_stamps(start, now))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        monthly = dict(zip(months, pool.map(lambda stamp: download_archive(cache, pair, 'monthly', stamp), months)))
    missing_months = [stamp for stamp, path in monthly.items() if path is None]
    daily = {}
    if missing_months:
        # Archives can lag a few days; fall back to daily files for the gap.
        for stamp in missing_months:
            year, month = (int(part) for part in stamp.split('-'))
            begin = datetime(year, month, 1, tzinfo=timezone.utc)
            month_end = (begin + timedelta(days=32)).replace(day=1)
            days = list(day_stamps(int(begin.timestamp()), int(min(month_end.timestamp(), now))))
            if not days:
                continue
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for day, path in zip(days, pool.map(lambda value: download_archive(cache, pair, 'daily', value), days)):
                    if path is not None:
                        daily[day] = path

    final = output / f'{symbol.lower()}_1m.parquet'
    candidate = output / f'.{symbol.lower()}-{uuid.uuid4().hex}.parquet.tmp'
    output.mkdir(parents=True, exist_ok=True)
    try:
        writer = Writer(candidate)
        for stamp in months:
            path = monthly.get(stamp)
            if path is not None:
                for row in archive_rows(path):
                    if writer.last is not None and row[0] <= writer.last:
                        continue
                    writer.add(row)
        for day in sorted(daily):
            for row in archive_rows(daily[day]):
                if writer.last is not None and row[0] <= writer.last:
                    continue
                writer.add(row)
        if writer.last is None:
            raise ValueError(f'{symbol}: no archive candles')
        # REST tail: everything after the last archived minute.
        cursor = (writer.last + 60) * 1000
        while True:
            rows = rest_klines(pair, cursor)
            if not rows:
                break
            for entry in rows:
                row = (entry[0] // 1000, float(entry[1]), float(entry[2]), float(entry[3]),
                       float(entry[4]), float(entry[5]))
                if writer.last is not None and row[0] <= writer.last:
                    continue
                writer.add(row)
            cursor = (writer.last + 60) * 1000
            if cursor > now * 1000:
                break
        writer.close()
        if not writer.count:
            raise ValueError('refusing to publish empty history')
        if parquet_bounds(candidate) != (writer.first, writer.last, writer.count):
            raise ValueError('candidate Parquet read-back mismatch')
        if final.exists():
            old_first, old_last, old_count = parquet_bounds(final)
            emit('replacing', symbol=symbol, existing=(old_first, old_last, old_count),
                 candidate=(writer.first, writer.last, writer.count))
        digest = hashlib.sha256()
        with candidate.open('rb') as stream:
            while block := stream.read(8 * 1024 * 1024):
                digest.update(block)
        manifest = {
            'symbol': symbol,
            'product_id': pair,
            'source': 'Binance',
            'quote': 'USDT',
            'base_timeframe': '1m',
            'first_timestamp': writer.first,
            'last_timestamp': writer.last,
            'candle_count': writer.count,
            'verified_through_exclusive': writer.last + 60,
            'missing_minutes': writer.gaps,
            'gap_policy': 'Binance omits minutes without trades; no synthetic candles',
            'sha256': digest.hexdigest(),
            'synced_at': datetime.now(timezone.utc).isoformat(),
        }
        if final.exists():
            backup = output / f'{final.name}.previous-{time.time_ns()}'
            try:
                os.link(final, backup)
            except OSError:
                import shutil
                shutil.copy2(final, backup)
        os.replace(candidate, final)
        atomic_json(output / f'{symbol.lower()}_1m.manifest.json', manifest)
        emit('published', **manifest, path=str(final))
        return manifest
    finally:
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            pass  # Windows keeps the handle until GC; the temp name is unique.


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='data/market')
    parser.add_argument('--cache', default='.cache/binance')
    parser.add_argument('--symbols', default=','.join(MARKETS))
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    failed = False
    for symbol in args.symbols.split(','):
        pair = MARKETS.get(symbol.strip().upper())
        if pair is None:
            emit('skipped', symbol=symbol, reason='not a Binance market')
            continue
        try:
            sync_symbol(symbol.strip().upper(), pair, args.cache, args.output, args.workers)
        except Exception as error:
            failed = True
            emit('failed', symbol=symbol, error=str(error))
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
