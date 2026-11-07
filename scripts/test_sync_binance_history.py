"""Run: python -I -m unittest scripts/test_sync_binance_history.py -v"""
import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('sync_binance', Path(__file__).with_name('sync_binance_history.py'))
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def csv_archive(directory, content, name='BNBUSDT-1m-2025-01.csv'):
    path = Path(directory) / 'archive.zip'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr(name, content)
    return path


class TimestampParsing(unittest.TestCase):
    def test_millisecond_microsecond_and_offset_stamps_land_on_minutes(self):
        self.assertEqual(sync.parse_timestamp('1502942400000'), 1502942400)
        self.assertEqual(sync.parse_timestamp('1735689600000000'), 1735689600)
        # 2017-era archives carry millisecond offsets inside the minute.
        self.assertEqual(sync.parse_timestamp('1512367221820'), 1512367200)


class ArchiveParsing(unittest.TestCase):
    def test_reads_rows_and_skips_header_and_blank_lines(self):
        content = ('open_time,open,high,low,close,volume,close_time,quote_volume,trades,taker_base,taker_quote,ignore\n'
                   '1735689600000,702.31,702.31,701.46,702.21,205.19,1735689659999,144011.83,796,56.12,39387.73,0\n'
                   '\n'
                   '1735689660000,702.23,702.50,701.90,702.50,42.88,1735689719999,30112.56,346,26.58,18669.15,0\n')
        with tempfile.TemporaryDirectory() as directory:
            rows = list(sync.archive_rows(csv_archive(directory, content)))
        self.assertEqual(rows, [(1735689600, 702.31, 702.31, 701.46, 702.21, 205.19),
                                (1735689660, 702.23, 702.50, 701.90, 702.50, 42.88)])


class CandleValidation(unittest.TestCase):
    def test_accepts_aligned_finite_ohlcv(self):
        self.assertTrue(sync.valid((60, 10.0, 12.0, 9.0, 11.0, 2.0), None))

    def test_rejects_unaligned_impossible_or_unordered_candles(self):
        for row, previous in [((61, 10.0, 12.0, 9.0, 11.0, 1.0), None),
                              ((60, 0.0, 1.0, 0.0, 1.0, 1.0), None),
                              ((60, 10.0, 9.0, 10.0, 10.0, 1.0), None),
                              ((60, 10.0, 12.0, 9.0, 11.0, -1.0), None),
                              ((60, float('nan'), 12.0, 9.0, 11.0, 1.0), None),
                              ((60, 10.0, 12.0, 9.0, 11.0, 1.0), 60)]:
            self.assertFalse(sync.valid(row, previous), row)


class MonthEnumeration(unittest.TestCase):
    def test_covers_listing_month_through_last_complete_month(self):
        months = list(sync.month_stamps(1502942400, 1793491200))  # 2017-08-17 .. 2026-11-01
        self.assertEqual(months[0], '2017-08')
        self.assertEqual(months[-1], '2026-10')
        self.assertEqual(len(months), 111)


if __name__ == '__main__':
    unittest.main()
