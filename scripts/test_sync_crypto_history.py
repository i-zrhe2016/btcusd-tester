"""Run: .venv-market-sync/Scripts/python.exe -I -m unittest scripts/test_sync_crypto_history.py -v"""
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('sync', Path(__file__).with_name('sync_crypto_history.py'))
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class CandleValidation(unittest.TestCase):
    def test_accepts_aligned_finite_ohlcv(self):
        self.assertTrue(sync.valid_candle((60, 10.0, 12.0, 9.0, 11.0, 2.0)))

    def test_rejects_unaligned_or_impossible_candles(self):
        for row in [(61, 10.0, 12.0, 9.0, 11.0, 1.0), (60, 0.0, 1.0, 0.0, 1.0, 1.0),
                    (60, 10.0, 9.0, 10.0, 10.0, 1.0), (60, 10.0, 12.0, 9.0, 11.0, -1.0),
                    (60, float('nan'), 12.0, 9.0, 11.0, 1.0)]:
            self.assertFalse(sync.valid_candle(row), row)


class TradePagination(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = sqlite3.connect(Path(self.temp.name) / 'state.sqlite')
        self.db.execute('CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        self.db.execute('CREATE TABLE candles (timestamp INTEGER PRIMARY KEY, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL)')

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def page(self, trades, cursor='100'):
        return {'XXBTZUSD': trades, 'last': cursor}

    def test_commits_ohlcv_and_cursor_atomically(self):
        start = sync.ARCHIVE_END
        done, accepted = sync.apply_trade_page(self.db, self.page([[10, 2, start + 5, 'b', 's', '', 1], [11, 3, start + 65, 'b', 's', '', 2]]), start + 600)
        self.assertFalse(done)
        self.assertEqual(accepted, 2)
        rows = self.db.execute('SELECT * FROM candles ORDER BY timestamp').fetchall()
        self.assertEqual(rows, [(start, 10.0, 10.0, 10.0, 10.0, 2.0), (start + 60, 11.0, 11.0, 11.0, 11.0, 3.0)])
        self.assertEqual(sync.get_state(self.db, 'trade_cursor'), '100')

    def test_replay_skips_committed_ids_and_extends_candles(self):
        start = sync.ARCHIVE_END
        sync.apply_trade_page(self.db, self.page([[10, 2, start + 5, '', '', '', 7]], '200'), start + 600)
        done, accepted = sync.apply_trade_page(self.db, self.page([[10, 2, start + 5, '', '', '', 7], [20, 1, start + 10, '', '', '', 8]], '300'), start + 600)
        self.assertEqual(accepted, 1)
        self.assertEqual(self.db.execute('SELECT high, volume FROM candles').fetchone(), (20.0, 3.0))
        self.assertEqual(sync.get_state(self.db, 'trade_id'), 8)

    def test_stops_at_requested_end_without_consuming_boundary_trade(self):
        start = sync.ARCHIVE_END
        done, accepted = sync.apply_trade_page(self.db, self.page([[10, 1, start + 5, '', '', '', 1], [10, 1, start + 600, '', '', '', 2]], '200'), start + 600)
        self.assertTrue(done)
        self.assertEqual(accepted, 1)
        self.assertEqual(sync.get_state(self.db, 'trade_id'), 1)
        self.assertEqual(sync.get_state(self.db, 'complete_through'), start + 600)

    def test_rejects_missing_ids_and_prearchive_trades(self):
        start = sync.ARCHIVE_END
        with self.assertRaisesRegex(ValueError, 'ID missing'):
            sync.apply_trade_page(self.db, self.page([[10, 1, start + 5, '', '', '']]), start + 60)
        with self.assertRaisesRegex(ValueError, 'predates archive'):
            sync.apply_trade_page(self.db, self.page([[10, 1, start - 5, '', '', '', 1]]), start + 60)

    def test_completes_when_inclusive_cursor_returns_only_known_trades(self):
        start = sync.ARCHIVE_END
        sync.apply_trade_page(self.db, self.page([[10, 1, start + 5, '', '', '', 7]], '200'), start + 60)
        done, accepted = sync.apply_trade_page(self.db, self.page([[10, 1, start + 5, '', '', '', 7]], '200'), start + 600)
        self.assertTrue(done)
        self.assertEqual(accepted, 0)
        self.assertEqual(sync.get_state(self.db, 'complete_through'), start + 600)
        self.assertEqual(self.db.execute('SELECT volume FROM candles').fetchone(), (1.0,))


class ArchivePublishSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name)
        self.db = sqlite3.connect(self.output / 'state.sqlite')
        self.db.execute('CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        self.db.execute('CREATE TABLE candles (timestamp INTEGER PRIMARY KEY, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL)')

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def insert(self, timestamp):
        self.db.execute('INSERT INTO candles VALUES (?, 1, 1, 1, 1, 1)', (timestamp,))

    def test_defers_archive_publish_instead_of_shortening_newer_existing_file(self):
        self.insert(sync.ARCHIVE_END + 120)
        sync.publish(self.db, 'BTCUSD', self.output, sync.ARCHIVE_END + 180)
        self.db.execute('DELETE FROM candles')
        self.insert(sync.ARCHIVE_END - 120)
        sync.publish_archive_if_safe(self.db, 'BTCUSD', self.output)
        self.assertIsNone(sync.get_state(self.db, 'archive_published'))
        manifest = json.loads((self.output / 'btcusd_1m.manifest.json').read_text())
        self.assertEqual(manifest['last_timestamp'], sync.ARCHIVE_END + 120)

    def test_publishes_archive_when_no_shrink(self):
        self.insert(sync.ARCHIVE_END - 120)
        sync.publish_archive_if_safe(self.db, 'BTCUSD', self.output)
        self.assertTrue(sync.get_state(self.db, 'archive_published'))
        manifest = json.loads((self.output / 'btcusd_1m.manifest.json').read_text())
        self.assertEqual(manifest['last_timestamp'], sync.ARCHIVE_END - 120)


if __name__ == '__main__':
    unittest.main()
