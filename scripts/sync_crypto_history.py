"""Kraken USD 1m archive + historical trade pagination. Run with Python -I.

Archive files are untrusted data: cached in a dedicated empty download folder,
never extracted or executed. Outputs are staged and checked before publication.
"""
import argparse
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import urllib.request
import uuid
import zipfile

MARKETS = {
    'BTCUSD': 'XBTUSD', 'ETHUSD': 'ETHUSD', 'BNBUSD': 'BNBUSD',
    'XRPUSD': 'XRPUSD', 'SOLUSD': 'SOLUSD', 'TRXUSD': 'TRXUSD',
    'ZECUSD': 'ZECUSD', 'HYPEUSD': 'HYPEUSD', 'DOGEUSD': 'XDGUSD', 'XMRUSD': 'XMRUSD',
}
ARCHIVE_BASE = 'https://assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full.zip.part'
# Official full archive currently published through 2026-09-30 (exclusive end).
ARCHIVE_END = 1790812800  # 2026-10-01T00:00:00Z
COLUMNS = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
BLOCK = 4 * 1024 * 1024


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


def http(url, headers=None, method='GET'):
    for attempt in range(6):
        try:
            return urllib.request.urlopen(urllib.request.Request(
                url, headers={'User-Agent': 'grailab-history-sync/1.0', 'Accept-Encoding': 'identity', **(headers or {})}, method=method), timeout=90)
        except Exception:
            if attempt == 5:
                raise
            time.sleep(min(2 ** attempt, 30))


class RemoteArchive(io.RawIOBase):
    """Seekable multipart ZIP using checked HTTP ranges and durable block cache."""
    def __init__(self, cache):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.parts = []
        offset = 0
        for index in range(5):
            url = ARCHIVE_BASE + f'{index:02}'
            with http(url, method='HEAD') as response:
                size = int(response.headers['Content-Length'])
                etag = response.headers.get('ETag')
                if not etag or size <= 0:
                    raise ValueError('archive identity or size missing')
            self.parts.append({'url': url, 'size': size, 'etag': etag, 'offset': offset})
            offset += size
        self.length = offset
        self.position = 0
        identity_path = self.cache / 'archive-identity.json'
        if identity_path.exists() and json.loads(identity_path.read_text()) != self.parts:
            raise ValueError('Remote archive changed; use a new download directory')
        atomic_json(identity_path, self.parts)
        self.buffer_key = None
        self.buffer = b''

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.position
    def seek(self, offset, whence=0):
        target = offset if whence == 0 else self.position + offset if whence == 1 else self.length + offset
        if target < 0: raise ValueError('negative archive seek')
        self.position = target
        return target

    def read(self, size=-1):
        remaining = max(0, self.length - self.position)
        size = remaining if size < 0 else min(size, remaining)
        chunks = []
        while size:
            index = next(i for i, p in enumerate(self.parts) if p['offset'] <= self.position < p['offset'] + p['size'])
            part = self.parts[index]
            local = self.position - part['offset']
            block_index = local // BLOCK
            key = (index, block_index)
            if self.buffer_key != key:
                start = block_index * BLOCK
                end = min(start + BLOCK, part['size']) - 1
                path = self.cache / f'part{index:02}-block{block_index:06}.bin'
                if path.exists():
                    data = path.read_bytes()
                else:
                    with http(part['url'], {'Range': f'bytes={start}-{end}', 'If-Match': part['etag']}) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{part["size"]}':
                            raise ValueError('Server did not honor archive byte range')
                        data = response.read(end - start + 2)
                    if len(data) != end - start + 1: raise ValueError('truncated archive block')
                    temp = path.with_suffix('.tmp')
                    temp.write_bytes(data)
                    os.replace(temp, path)
                if len(data) != end - start + 1: raise ValueError('corrupt cached block')
                self.buffer_key, self.buffer = key, data
            within = local % BLOCK
            count = min(size, len(self.buffer) - within)
            chunks.append(self.buffer[within:within + count])
            self.position += count
            size -= count
        return b''.join(chunks)


def connect(path, symbol):
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS candles (timestamp INTEGER PRIMARY KEY, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL)')
    identity = {'symbol': symbol, 'pair': MARKETS[symbol], 'source': 'Kraken', 'interval': 60, 'archive_end': ARCHIVE_END, 'version': 1}
    stored = get_state(db, 'identity')
    if stored and stored != identity: raise ValueError('checkpoint identity mismatch')
    set_state(db, 'identity', identity)
    db.commit()
    return db


def get_state(db, key):
    row = db.execute('SELECT value FROM state WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else None


def set_state(db, key, value):
    db.execute('INSERT OR REPLACE INTO state VALUES (?, ?)', (key, json.dumps(value)))


def valid_candle(row):
    timestamp, op, high, low, close, volume = row
    return (isinstance(timestamp, int) and timestamp >= 0 and timestamp % 60 == 0
            and all(math.isfinite(v) for v in row[1:]) and min(op, high, low, close) > 0
            and low <= min(op, close) <= max(op, close) <= high and volume >= 0)


def import_archive(db, archive, symbol):
    if get_state(db, 'archive_complete'): return
    pair = MARKETS[symbol]
    names = [name for name in archive.namelist() if Path(name).name == f'{pair}_1.csv']
    if len(names) != 1: raise ValueError(f'{pair}: expected one 1-minute CSV, found {names}')
    member = archive.getinfo(names[0])
    if member.file_size > 8 * 1024**3: raise ValueError('archive member unexpectedly large')
    last = -1
    count = 0
    batch = []
    # Never extract a downloaded path to the filesystem.
    with archive.open(member) as raw:
        for fields in csv.reader(io.TextIOWrapper(raw, encoding='utf-8')):
            if len(fields) != 7: raise ValueError(f'{symbol}: invalid archive row')
            timestamp = int(fields[0])
            row = (timestamp, *(float(value) for value in fields[1:6]))
            if not valid_candle(row) or timestamp <= last or timestamp >= ARCHIVE_END:
                raise ValueError(f'{symbol}: invalid or unordered archive candle {timestamp}')
            last = timestamp
            batch.append(row)
            count += 1
            if len(batch) >= 50000:
                db.executemany('INSERT OR REPLACE INTO candles VALUES (?, ?, ?, ?, ?, ?)', batch)
                db.commit()
                batch.clear()
                emit('archive_progress', symbol=symbol, candles=count, timestamp=timestamp)
    if not count: raise ValueError(f'{symbol}: empty history archive')
    db.executemany('INSERT OR REPLACE INTO candles VALUES (?, ?, ?, ?, ?, ?)', batch)
    set_state(db, 'archive_complete', {'member': member.filename, 'crc32': member.CRC, 'rows': count, 'last_timestamp': last})
    db.commit()
    emit('archive_complete', symbol=symbol, candles=count, last_timestamp=last)


def apply_trade_page(db, result, target_end):
    """Commit candles and opaque cursor atomically; stable trade IDs deduplicate overlap."""
    cursor = str(result['last'])
    pairs = [key for key in result if key != 'last']
    if len(pairs) != 1: raise ValueError('unexpected trade response pair count')
    trades = result[pairs[0]]
    prior_cursor = get_state(db, 'trade_cursor')
    prior_id = get_state(db, 'trade_id') or -1
    max_id = prior_id
    previous_time = None
    reached_end = False
    accepted = 0
    for trade in trades:
        if len(trade) < 7: raise ValueError('trade ID missing; cannot guarantee idempotent synchronization')
        timestamp = Decimal(str(trade[2]))
        trade_id = int(trade[6])
        if trade_id <= prior_id: continue
        if previous_time is not None and timestamp < previous_time: raise ValueError('out-of-order trade response')
        previous_time = timestamp
        price, volume = float(trade[0]), float(trade[1])
        if not math.isfinite(price) or not math.isfinite(volume) or price <= 0 or volume < 0:
            raise ValueError('invalid trade price or volume')
        if timestamp >= target_end:
            reached_end = True
            break
        if timestamp < ARCHIVE_END: raise ValueError('trade page predates archive boundary')
        bucket = int(timestamp // 60) * 60
        db.execute('''INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(timestamp) DO UPDATE SET
            high=MAX(high,excluded.high), low=MIN(low,excluded.low),
            close=excluded.close, volume=volume+excluded.volume''', (bucket, price, price, price, price, volume))
        max_id = max(max_id, trade_id)
        accepted += 1
    if not reached_end:
        if accepted:
            if cursor == prior_cursor:
                raise ValueError('trade pagination stalled before requested end')
            set_state(db, 'trade_cursor', cursor)
        else:
            # The cursor is inclusive: a quiet market returns the last known trade again and no
            # newer IDs. No trades means the requested cutoff is fully covered.
            reached_end = True
    # Do not advance the cursor past unprocessed trades from the final partial page.
    set_state(db, 'trade_id', max_id)
    if reached_end: set_state(db, 'complete_through', target_end)
    db.commit()
    return reached_end, accepted


def sync_tail(db, symbol, target_end, pause):
    if (get_state(db, 'complete_through') or 0) >= target_end: return
    while True:
        cursor = get_state(db, 'trade_cursor') or str(ARCHIVE_END * 1_000_000_000 - 1)
        url = f'https://api.kraken.com/0/public/Trades?pair={MARKETS[symbol]}&since={cursor}&count=1000'
        with http(url) as response: body = json.load(response)
        if body.get('error'): raise ValueError(f'Kraken: {body["error"]}')
        with db:
            done, accepted = apply_trade_page(db, body['result'], target_end)
        last = db.execute('SELECT MAX(timestamp) FROM candles').fetchone()[0]
        emit('tail_progress', symbol=symbol, accepted_trades=accepted, last_timestamp=last, target_end=target_end)
        if done: break
        time.sleep(pause)


def parquet_bounds(path):
    import pyarrow.parquet as pq
    file = pq.ParquetFile(path)
    low, high, count = None, None, 0
    for batch in file.iter_batches(columns=['timestamp'], batch_size=100000):
        values = batch.column(0).to_pylist()
        if any(value is None for value in values): raise ValueError('existing history has null timestamps')
        if values:
            low = min(min(values), low) if low is not None else min(values)
            high = max(max(values), high) if high is not None else max(values)
            count += len(values)
    return low, high, count


def publish(db, symbol, output, coverage_end):
    import pyarrow as pa
    import pyarrow.parquet as pq
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    final = output / f'{symbol.lower()}_1m.parquet'
    candidate = output / f'.{symbol.lower()}-{uuid.uuid4().hex}.parquet.tmp'
    schema = pa.schema([pa.field('timestamp', pa.int64(), nullable=False)] + [pa.field(name, pa.float64(), nullable=False) for name in COLUMNS[1:]])
    count, first, last, gaps = 0, None, None, 0
    digest = hashlib.sha256()
    try:
        with pq.ParquetWriter(candidate, schema, compression='snappy') as writer:
            cursor = db.execute('SELECT * FROM candles WHERE timestamp < ? ORDER BY timestamp', (coverage_end,))
            while rows := cursor.fetchmany(100000):
                for row in rows:
                    if not valid_candle(row) or (last is not None and row[0] <= last): raise ValueError('invalid candidate history')
                    if last is not None: gaps += max(0, (row[0] - last) // 60 - 1)
                    first = row[0] if first is None else first
                    last = row[0]
                    count += 1
                writer.write_table(pa.Table.from_arrays([pa.array(values, type=field.type) for values, field in zip(zip(*rows), schema)], schema=schema))
        if not count: raise ValueError('refusing to publish empty history')
        if parquet_bounds(candidate) != (first, last, count): raise ValueError('candidate Parquet read-back mismatch')
        if final.exists():
            old_first, old_last, old_count = parquet_bounds(final)
            if old_count and (first > old_first or last < old_last or count < old_count):
                raise ValueError(f'{symbol}: refusing history shrink: existing={(old_first, old_last, old_count)}, candidate={(first, last, count)}')
        with candidate.open('rb') as stream:
            while block := stream.read(8 * 1024 * 1024): digest.update(block)
        manifest = {'symbol': symbol, 'product_id': MARKETS[symbol], 'source': 'Kraken', 'quote': 'USD', 'base_timeframe': '1m', 'first_timestamp': first, 'last_timestamp': last, 'candle_count': count, 'verified_through_exclusive': coverage_end, 'missing_minutes': gaps, 'gap_policy': 'Kraken omits minutes without trades; no synthetic candles', 'sha256': digest.hexdigest(), 'synced_at': datetime.now(timezone.utc).isoformat()}
        # Publish only after validation; retain a unique backup, never overwrite a previous backup.
        if final.exists():
            backup = output / f'{final.name}.previous-{time.time_ns()}'
            try: os.link(final, backup)
            except OSError:
                import shutil
                shutil.copy2(final, backup)
        os.replace(candidate, final)
        atomic_json(output / f'{symbol.lower()}_1m.manifest.json', manifest)
        emit('published', **manifest, path=str(final))
        return manifest
    finally:
        candidate.unlink(missing_ok=True)


def publish_archive_if_safe(db, symbol, output):
    """Never regress a newer existing file just to publish the archive stage early."""
    if get_state(db, 'archive_published'): return
    try:
        publish(db, symbol, output, ARCHIVE_END)
        set_state(db, 'archive_published', True)
        db.commit()
    except ValueError as error:
        if 'refusing history shrink' not in str(error): raise
        emit('archive_publish_deferred', symbol=symbol, reason=str(error))


def run(args):
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    lock = work / 'sync.lock'
    try:
        lock_fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise RuntimeError(f'Synchronization lock exists: {lock}; verify previous process has exited before removing it')
    os.write(lock_fd, str(os.getpid()).encode())
    os.close(lock_fd)
    try:
        download_pointer = work / 'download-directory.json'
        if download_pointer.exists():
            download = Path(json.loads(download_pointer.read_text())['path'])
        else:
            download = work / ('download-' + uuid.uuid4().hex)
            download.mkdir()  # New empty directory exclusively for untrusted downloads.
            atomic_json(download_pointer, {'path': str(download)})
        archive_io = RemoteArchive(download)
        with zipfile.ZipFile(archive_io) as archive:
            if args.index:
                for symbol, pair in MARKETS.items():
                    matches = [info for info in archive.infolist() if Path(info.filename).name == f'{pair}_1.csv']
                    emit('archive_member', symbol=symbol, members=[{'name': info.filename, 'bytes': info.file_size, 'compressed_bytes': info.compress_size} for info in matches])
                return
            target = args.end or int(time.time()) // 60 * 60
            if target < ARCHIVE_END or target > int(time.time()) // 60 * 60: raise ValueError('end must lie between archive cutoff and last completed minute')
            symbols = args.symbols.split(',') if args.symbols else list(MARKETS)
            if any(symbol not in MARKETS for symbol in symbols): raise ValueError('unsupported symbol')
            failures = []
            for symbol in symbols:
                try:
                    with connect(work / f'{symbol.lower()}.sqlite', symbol) as db:
                        import_archive(db, archive, symbol)
                        # Publish the archive before a long trade catch-up, unless that would
                        # temporarily shorten an existing newer file; then wait for the tail.
                        publish_archive_if_safe(db, symbol, args.output)
                        if not args.archive_only:
                            sync_tail(db, symbol, target, args.pause)
                            publish(db, symbol, args.output, target)
                except Exception as error:
                    failures.append(symbol)
                    emit('market_failed', symbol=symbol, error=str(error))
            if failures: raise RuntimeError(f'Incomplete markets: {failures}; rerun to resume')
            emit('sync_complete', symbols=symbols, archive_only=args.archive_only, target_end=ARCHIVE_END if args.archive_only else target)
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', default='data/history-sync/kraken-usd-v1')
    parser.add_argument('--output', default='data/market')
    parser.add_argument('--symbols', help='comma-separated canonical USD symbols; default all ten')
    parser.add_argument('--end', type=int, help='exclusive UTC Unix seconds; default latest completed minute')
    parser.add_argument('--pause', type=float, default=1.1, help='seconds between public trade requests')
    parser.add_argument('--index', action='store_true', help='inspect remote ZIP index without downloading full archive')
    parser.add_argument('--archive-only', action='store_true', help='publish through archive cutoff; skip recent-trade tail')
    arguments = parser.parse_args()
    if arguments.pause < 1: parser.error('pause must be at least 1 second')
    try:
        run(arguments)
    except Exception as error:
        emit('sync_failed', error=str(error))
        raise
