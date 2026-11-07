use std::{fs, path::Path};

use anyhow::{bail, Context};
use serde::Deserialize;

use crate::model::Candle;

/// Recent completed 1-minute candles published by `scripts/sync_live_market.py`.
/// The full-history Parquet file stays immutable; the service overlays this
/// window on it so newly closed minutes become available without a restart.
#[derive(Debug, Deserialize)]
struct LiveFile {
    symbol: String,
    candles: Vec<(i64, f64, f64, f64, f64, f64)>,
}

#[derive(Debug)]
pub struct LiveSnapshot {
    pub candles: Vec<Candle>,
    pub updated_at: Option<String>,
}

pub fn load_live(path: &Path, expected_symbol: &str) -> anyhow::Result<LiveSnapshot> {
    let bytes = fs::read(path)
        .with_context(|| format!("failed to read live market file {}", path.display()))?;
    let file: LiveFile = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse live market file {}", path.display()))?;
    if !file.symbol.eq_ignore_ascii_case(expected_symbol) {
        bail!(
            "live market file {} is labelled {}, expected {}",
            path.display(),
            file.symbol,
            expected_symbol
        );
    }
    if file.candles.is_empty() {
        bail!("live market file {} has no candles", path.display());
    }

    let mut candles = Vec::with_capacity(file.candles.len());
    let mut previous = None;
    for (timestamp, open, high, low, close, volume) in file.candles {
        let candle = Candle {
            timestamp,
            open,
            high,
            low,
            close,
            volume,
        };
        if !valid(&candle) {
            bail!(
                "live market file {} contains an invalid candle at {}",
                path.display(),
                timestamp
            );
        }
        if previous.is_some_and(|value| timestamp <= value) {
            bail!(
                "live market file {} is not strictly ordered at {}",
                path.display(),
                timestamp
            );
        }
        previous = Some(timestamp);
        candles.push(candle);
    }

    Ok(LiveSnapshot {
        candles,
        updated_at: serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("updated_at")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            }),
    })
}

fn valid(candle: &Candle) -> bool {
    candle.timestamp >= 0
        && candle.timestamp % 60 == 0
        && [
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume,
        ]
        .iter()
        .all(|value| value.is_finite())
        && candle.open > 0.0
        && candle.high > 0.0
        && candle.low > 0.0
        && candle.close > 0.0
        && candle.volume >= 0.0
        && candle.low <= candle.open.min(candle.close)
        && candle.open.max(candle.close) <= candle.high
}

/// Merge live candles over the full history. A live candle replaces the base
/// candle with the same timestamp (Kraken may refine the last minute), base
/// candles missing from the live window are kept, and any base tail newer than
/// the live window is preserved.
pub fn merge(base: &[Candle], live: &[Candle]) -> Vec<Candle> {
    let mut merged = Vec::with_capacity(base.len() + live.len());
    let (mut left, mut right) = (0, 0);
    while left < base.len() && right < live.len() {
        match base[left].timestamp.cmp(&live[right].timestamp) {
            std::cmp::Ordering::Less => {
                merged.push(base[left]);
                left += 1;
            }
            std::cmp::Ordering::Greater => {
                merged.push(live[right]);
                right += 1;
            }
            std::cmp::Ordering::Equal => {
                merged.push(live[right]);
                left += 1;
                right += 1;
            }
        }
    }
    merged.extend_from_slice(&base[left..]);
    merged.extend_from_slice(&live[right..]);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candle(timestamp: i64, close: f64) -> Candle {
        Candle {
            timestamp,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1.0,
        }
    }

    #[test]
    fn live_candles_override_matching_base_candles_and_keep_gaps() {
        let base = vec![
            candle(60, 10.0),
            candle(120, 11.0),
            candle(180, 12.0),
            candle(360, 14.0),
        ];
        let live = vec![candle(120, 21.0), candle(240, 23.0)];
        let merged = merge(&base, &live);
        assert_eq!(
            merged
                .iter()
                .map(|candle| (candle.timestamp, candle.close))
                .collect::<Vec<_>>(),
            vec![
                (60, 10.0),
                (120, 21.0),
                (180, 12.0),
                (240, 23.0),
                (360, 14.0)
            ]
        );
    }

    #[test]
    fn merge_preserves_a_newer_base_tail() {
        let base = vec![candle(60, 10.0), candle(120, 11.0)];
        let live = vec![candle(60, 20.0)];
        assert_eq!(merge(&base, &live)[1].close, 11.0);
        assert_eq!(merge(&[], &live).len(), 1);
    }

    #[test]
    fn loads_and_validates_live_json() {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "grailab-live-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("btcusd_1m.live.json");
        fs::write(
            &path,
            r#"{"symbol":"BTCUSD","updated_at":"2026-11-06T00:00:00Z","candles":[[60,10,11,9,10.5,1]]}"#,
        )
        .unwrap();
        let snapshot = load_live(&path, "BTCUSD").unwrap();
        assert_eq!(snapshot.candles.len(), 1);
        assert_eq!(snapshot.updated_at.as_deref(), Some("2026-11-06T00:00:00Z"));

        fs::write(
            &path,
            r#"{"symbol":"ETHUSD","candles":[[60,10,11,9,10.5,1]]}"#,
        )
        .unwrap();
        assert!(load_live(&path, "BTCUSD").is_err());

        fs::write(
            &path,
            r#"{"symbol":"BTCUSD","candles":[[61,10,11,9,10.5,1]]}"#,
        )
        .unwrap();
        assert!(load_live(&path, "BTCUSD").is_err());

        fs::write(
            &path,
            r#"{"symbol":"BTCUSD","candles":[[120,10,11,9,10.5,1],[60,10,11,9,10.5,1]]}"#,
        )
        .unwrap();
        assert!(load_live(&path, "BTCUSD").is_err());
        let _ = fs::remove_dir_all(directory);
    }
}
