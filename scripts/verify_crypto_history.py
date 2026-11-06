"""Independent read-back check of published 1m files. Run with Python -I."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import pyarrow.parquet as pq

SYMBOLS = ['BTCUSD', 'ETHUSD', 'BNBUSD', 'XRPUSD', 'SOLUSD', 'TRXUSD', 'ZECUSD', 'HYPEUSD', 'DOGEUSD', 'XMRUSD']
COLUMNS = ['timestamp', 'open', 'high', 'low', 'close', 'volume']


def verify(directory, symbol):
    stem = symbol.lower()
    data = Path(directory) / f'{stem}_1m.parquet'
    manifest = json.loads((Path(directory) / f'{stem}_1m.manifest.json').read_text(encoding='utf-8'))
    errors = []
    if manifest.get('symbol') != symbol or manifest.get('quote') != 'USD':
        errors.append('manifest identity is not a USD market')
    file = pq.ParquetFile(data)
    if file.schema_arrow.names != COLUMNS or not all(str(file.schema_arrow.field(i).type) in ('int64', 'double') for i in range(6)):
        errors.append(f'unexpected schema {file.schema_arrow}')
    digest = hashlib.sha256()
    count, first, last, previous = 0, None, None, None
    last_verified = manifest['verified_through_exclusive']
    for batch in file.iter_batches(batch_size=100000):
        table = batch.to_pydict()
        for row in zip(*(table[name] for name in COLUMNS)):
            timestamp = row[0]
            valid = (isinstance(timestamp, int) and timestamp % 60 == 0 and timestamp < last_verified
                     and all(isinstance(value, float) and math.isfinite(value) for value in row[1:])
                     and min(row[1:5]) > 0 and row[3] <= min(row[1], row[4]) <= max(row[1], row[4]) <= row[2]
                     and row[5] >= 0 and (previous is None or timestamp > previous))
            if not valid:
                errors.append(f'invalid or unordered candle at row {count}: {row}')
                break
            first = timestamp if first is None else first
            last, previous = timestamp, timestamp
            count += 1
        if errors: break
    with data.open('rb') as stream:
        while block := stream.read(8 * 1024 * 1024): digest.update(block)
    if count != manifest['candle_count']: errors.append(f'row count {count} != manifest {manifest["candle_count"]}')
    if (first, last) != (manifest['first_timestamp'], manifest['last_timestamp']): errors.append('bounds differ from manifest')
    if digest.hexdigest() != manifest['sha256']: errors.append('sha256 differs from manifest')
    return errors, manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='data/market')
    parser.add_argument('--symbols', default=','.join(SYMBOLS))
    args = parser.parse_args()
    failed = False
    for symbol in args.symbols.split(','):
        try:
            errors, manifest = verify(args.directory, symbol)
        except Exception as error:
            errors, manifest = [str(error)], {}
        if errors:
            failed = True
            print(json.dumps({'symbol': symbol, 'result': 'fail', 'errors': errors}, ensure_ascii=False), flush=True)
        else:
            print(json.dumps({'symbol': symbol, 'result': 'pass', 'candles': manifest['candle_count'], 'first': manifest['first_timestamp'], 'last': manifest['last_timestamp'], 'verified_through': manifest['verified_through_exclusive'], 'missing_minutes': manifest['missing_minutes']}, ensure_ascii=False), flush=True)
    sys.exit(1 if failed else 0)
