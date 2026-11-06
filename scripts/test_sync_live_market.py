"""Run: python -I -m unittest scripts/test_sync_live_market.py -v"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location('live', Path(__file__).with_name('sync_live_market.py'))
live = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(live)


def row(timestamp, price=10.0, volume=1.0):
    return [timestamp, price, price + 1, price - 1, price + 0.5, price, volume, 3]


class ParseOhlc(unittest.TestCase):
    def test_parses_rows_and_ignores_cursor(self):
        body = {'error': [], 'result': {'XXBTZUSD': [row(120), row(180)], 'last': '180'}}
        self.assertEqual(live.parse_ohlc(body, 'XBTUSD'), [
            (120, 10.0, 11.0, 9.0, 10.5, 1.0),
            (180, 10.0, 11.0, 9.0, 10.5, 1.0),
        ])

    def test_accepts_an_alias_key_and_rejects_errors(self):
        body = {'error': [], 'result': {'XBTUSD': [row(120)], 'last': '120'}}
        self.assertEqual(len(live.parse_ohlc(body, 'XBTUSD')), 1)
        with self.assertRaisesRegex(ValueError, 'Kraken'):
            live.parse_ohlc({'error': ['EAPI:Invalid key']}, 'XBTUSD')

    def test_rejects_malformed_rows(self):
        for bad in (['x'], [120, 10, 11, 9, 10]):
            with self.assertRaises(ValueError):
                live.parse_ohlc({'error': [], 'result': {'XXBTZUSD': [bad]}}, 'XBTUSD')


class Normalize(unittest.TestCase):
    def test_drops_forming_minute_deduplicates_and_trims(self):
        candles = [
            (60, 10, 11, 9, 10.5, 1),
            (120, 10, 11, 9, 10.5, 1),
            (120, 20, 21, 19, 20.5, 2),
            (180, 10, 11, 9, 10.5, 1),
        ]
        self.assertEqual(
            live.normalize(candles, completed_before=180, retain=10),
            [(60, 10, 11, 9, 10.5, 1), (120, 20, 21, 19, 20.5, 2)],
        )
        self.assertEqual(
            live.normalize(candles, completed_before=180, retain=1),
            [(120, 20, 21, 19, 20.5, 2)],
        )

    def test_rejects_invalid_candles(self):
        for candle in [(61, 10, 11, 9, 10, 1), (60, 0, 11, 9, 10, 1),
                       (60, float('nan'), 11, 9, 10, 1), (60, 10, 11, 9, 10, -1)]:
            with self.assertRaises(ValueError):
                live.normalize([candle], completed_before=120, retain=10)


class LiveFile(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_write_and_read_round_trip(self):
        candles = [(60, 10.0, 11.0, 9.0, 10.5, 1.0), (120, 11.0, 12.0, 10.0, 11.5, 2.0)]
        path = self.output / 'btcusd_1m.live.json'
        live.write_live(path, 'BTCUSD', candles, '2026-11-06T00:00:00+00:00')
        payload = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(payload['symbol'], 'BTCUSD')
        self.assertEqual(payload['last_timestamp'], 120)
        self.assertEqual(payload['candle_count'], 2)
        self.assertEqual(live.read_live(path), candles)

    def test_update_publishes_once_and_skips_unchanged_cycles(self):
        path = self.output / 'btcusd_1m.live.json'
        body = {'error': [], 'result': {'XXBTZUSD': [row(60), row(120), row(180)], 'last': '180'}}
        with mock.patch.object(live, 'fetch_json', return_value=body):
            self.assertTrue(live.update_symbol(
                'BTCUSD', self.output, 720, 30, now=180 + 30))
            self.assertFalse(live.update_symbol(
                'BTCUSD', self.output, 720, 30, now=180 + 30))
        self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['last_timestamp'], 120)

    def test_update_merges_new_candles_and_overrides_the_last_one(self):
        path = self.output / 'btcusd_1m.live.json'
        live.write_live(path, 'BTCUSD', [(60, 10.0, 11.0, 9.0, 10.5, 1.0)], '2026-11-06T00:00:00+00:00')
        body = {'error': [], 'result': {'XXBTZUSD': [row(60, 18.0), row(120, 12.0)], 'last': '120'}}
        with mock.patch.object(live, 'fetch_json', return_value=body):
            self.assertTrue(live.update_symbol('BTCUSD', self.output, 720, 30, now=180))
        self.assertEqual(live.read_live(path), [
            (60, 18.0, 19.0, 17.0, 18.5, 1.0),
            (120, 12.0, 13.0, 11.0, 12.5, 1.0),
        ])


if __name__ == '__main__':
    unittest.main()
