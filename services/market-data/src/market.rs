use chrono::{Datelike, TimeZone, Utc};

use crate::{
    error::ApiError,
    indicator::calculate_stochastic,
    model::{Candle, MarketSnapshot, SnapshotQuery, Timeframe},
};

const MAX_CANDLES: usize = 5_000;

pub fn snapshot(all_candles: &[Candle], query: SnapshotQuery) -> Result<MarketSnapshot, ApiError> {
    let symbol = crate::symbols::normalize(&query.symbol)
        .ok_or_else(|| ApiError::BadRequest(format!("unsupported USD market {}", query.symbol)))?;
    let timeframe = Timeframe::parse(&query.timeframe).ok_or_else(|| {
        ApiError::BadRequest(format!("unsupported timeframe {}", query.timeframe))
    })?;
    if query.limit == 0 || query.limit > MAX_CANDLES {
        return Err(ApiError::BadRequest(format!(
            "limit must be between 1 and {MAX_CANDLES}"
        )));
    }
    if query
        .from
        .zip(query.to)
        .is_some_and(|(from, to)| from >= to)
    {
        return Err(ApiError::BadRequest(
            "from must be earlier than to".to_owned(),
        ));
    }
    let lengths = parse_lengths(query.lengths.as_deref())?;

    // Parquet loading sorts and deduplicates timestamps, so only visit the requested range.
    let start = query.from.map_or(0, |from| {
        all_candles.partition_point(|candle| candle.timestamp < from)
    });
    let end = query.to.map_or(all_candles.len(), |to| {
        all_candles.partition_point(|candle| candle.timestamp < to)
    });
    let mut candles = aggregate(&all_candles[start..end], timeframe);
    if candles.len() > query.limit {
        candles.drain(..candles.len() - query.limit);
    }
    let stochastic = calculate_stochastic(&candles, lengths);

    Ok(MarketSnapshot {
        symbol: symbol.to_owned(),
        timeframe: timeframe.as_str().to_owned(),
        source: "Parquet",
        candles,
        stochastic,
    })
}

fn parse_lengths(value: Option<&str>) -> Result<[usize; 3], ApiError> {
    let Some(value) = value else {
        return Ok([30, 120, 840]);
    };
    let parsed: Vec<usize> = value
        .split(',')
        .map(str::trim)
        .map(|part| part.parse::<usize>())
        .collect::<Result<_, _>>()
        .map_err(|_| ApiError::BadRequest("lengths must contain three integers".to_owned()))?;
    if parsed.len() != 3 || parsed.iter().any(|length| !(2..=5_000).contains(length)) {
        return Err(ApiError::BadRequest(
            "lengths must contain three integers between 2 and 5000".to_owned(),
        ));
    }
    Ok([parsed[0], parsed[1], parsed[2]])
}

pub fn aggregate(candles: &[Candle], timeframe: Timeframe) -> Vec<Candle> {
    let mut result: Vec<Candle> = Vec::new();
    for candle in candles {
        let bucket = bucket_start(candle.timestamp, timeframe);
        if let Some(current) = result
            .last_mut()
            .filter(|current| current.timestamp == bucket)
        {
            current.high = current.high.max(candle.high);
            current.low = current.low.min(candle.low);
            current.close = candle.close;
            current.volume += candle.volume;
        } else {
            result.push(Candle {
                timestamp: bucket,
                ..*candle
            });
        }
    }
    result
}

fn bucket_start(timestamp: i64, timeframe: Timeframe) -> i64 {
    let seconds = match timeframe {
        Timeframe::Minute1 => Some(60),
        Timeframe::Minute5 => Some(5 * 60),
        Timeframe::Minute15 => Some(15 * 60),
        Timeframe::Minute30 => Some(30 * 60),
        Timeframe::Hour1 => Some(60 * 60),
        Timeframe::Hour2 => Some(2 * 60 * 60),
        Timeframe::Hour3 => Some(3 * 60 * 60),
        Timeframe::Hour4 => Some(4 * 60 * 60),
        Timeframe::Day1 => Some(24 * 60 * 60),
        Timeframe::Week1 | Timeframe::Month1 => None,
    };
    if let Some(seconds) = seconds {
        return timestamp.div_euclid(seconds) * seconds;
    }
    if timeframe == Timeframe::Week1 {
        const MONDAY_OFFSET: i64 = 3 * 24 * 60 * 60;
        const WEEK: i64 = 7 * 24 * 60 * 60;
        return (timestamp + MONDAY_OFFSET).div_euclid(WEEK) * WEEK - MONDAY_OFFSET;
    }

    let datetime = Utc
        .timestamp_opt(timestamp, 0)
        .single()
        .expect("valid Unix timestamp");
    Utc.with_ymd_and_hms(datetime.year(), datetime.month(), 1, 0, 0, 0)
        .single()
        .expect("valid month start")
        .timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candle(timestamp: i64, value: f64) -> Candle {
        Candle {
            timestamp,
            open: value,
            high: value + 2.0,
            low: value - 1.0,
            close: value + 1.0,
            volume: 3.0,
        }
    }

    #[test]
    fn aggregates_ohlcv_by_timeframe() {
        let result = aggregate(
            &[candle(0, 10.0), candle(60, 12.0), candle(900, 20.0)],
            Timeframe::Minute15,
        );
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].open, 10.0);
        assert_eq!(result[0].high, 14.0);
        assert_eq!(result[0].low, 9.0);
        assert_eq!(result[0].close, 13.0);
        assert_eq!(result[0].volume, 6.0);
    }

    #[test]
    fn supports_five_minute_and_three_hour_buckets() {
        for (name, seconds) in [("5m", 300), ("3h", 10_800)] {
            let timeframe = Timeframe::parse(name).unwrap();
            assert_eq!(timeframe.as_str(), name);
            let result = aggregate(
                &[
                    candle(0, 10.0),
                    candle(seconds - 60, 12.0),
                    candle(seconds, 20.0),
                ],
                timeframe,
            );
            assert_eq!(result.len(), 2);
            assert_eq!(result[0].timestamp, 0);
            assert_eq!(result[0].open, 10.0);
            assert_eq!(result[0].close, 13.0);
            assert_eq!(result[0].volume, 6.0);
            assert_eq!(result[1].timestamp, seconds);
        }
    }

    fn reference_snapshot(all_candles: &[Candle], query: &SnapshotQuery) -> MarketSnapshot {
        let filtered: Vec<_> = all_candles
            .iter()
            .copied()
            .filter(|candle| query.from.is_none_or(|from| candle.timestamp >= from))
            .filter(|candle| query.to.is_none_or(|to| candle.timestamp < to))
            .collect();
        let mut candles = aggregate(&filtered, Timeframe::parse(&query.timeframe).unwrap());
        if candles.len() > query.limit {
            candles.drain(..candles.len() - query.limit);
        }
        let lengths = parse_lengths(query.lengths.as_deref()).unwrap();
        let stochastic = calculate_stochastic(&candles, lengths);
        MarketSnapshot {
            symbol: "BTCUSD".to_owned(),
            timeframe: query.timeframe.clone(),
            source: "Parquet",
            candles,
            stochastic,
        }
    }

    fn query(timeframe: &str, from: Option<i64>, to: Option<i64>, limit: usize) -> SnapshotQuery {
        SnapshotQuery {
            symbol: "BTCUSD".to_owned(),
            timeframe: timeframe.to_owned(),
            from,
            to,
            limit,
            lengths: Some("2,3,4".to_owned()),
        }
    }

    #[test]
    fn indexed_snapshot_matches_scan_with_gaps_and_partial_buckets() {
        let start = Utc
            .with_ymd_and_hms(2024, 1, 28, 0, 0, 0)
            .unwrap()
            .timestamp();
        let candles: Vec<_> = (0..12_000)
            .filter(|index| index % 7 != 0)
            .map(|index| candle(start + index * 60, (index % 97) as f64))
            .collect();
        let ranges = [
            (None, None),
            (None, Some(start + 5_001)),
            (Some(start + 60), None),
            (Some(start + 60), Some(start + 600)),
            (Some(start + 61), Some(start + 421)),
            (Some(start - 120), Some(start)),
            (Some(start + 720_000), None),
            (Some(start + 120), Some(start + 121)),
        ];
        for timeframe in ["1m", "5m", "1h", "1d", "1w", "1M"] {
            for (from, to) in ranges {
                for limit in [1, 20, 5_000] {
                    let request = query(timeframe, from, to, limit);
                    let expected = reference_snapshot(&candles, &request);
                    let actual = snapshot(&candles, request).unwrap();
                    assert_eq!(
                        serde_json::to_value(actual).unwrap(),
                        serde_json::to_value(expected).unwrap(),
                        "timeframe={timeframe} from={from:?} to={to:?} limit={limit}",
                    );
                }
            }
        }
    }

    #[test]
    fn snapshot_excludes_data_at_and_after_to() {
        let candles = [candle(0, 10.0), candle(60, 12.0), candle(120, 999.0)];
        let result = snapshot(&candles, query("5m", Some(60), Some(120), 10)).unwrap();
        assert_eq!(result.candles.len(), 1);
        assert_eq!(result.candles[0].open, 12.0);
        assert_eq!(result.candles[0].close, 13.0);
        assert_eq!(result.candles[0].volume, 3.0);
        for invalid in [
            query("1m", Some(60), Some(60), 1),
            query("1m", None, None, 0),
        ] {
            assert!(snapshot(&candles, invalid).is_err());
        }
    }

    #[test]
    #[ignore = "manual release-mode performance comparison on synthetic history"]
    fn benchmark_indexed_snapshot() {
        use std::{hint::black_box, time::Instant};
        let candles: Vec<_> = (0..4_117_327)
            .map(|index| candle(index * 60, (index % 97) as f64))
            .collect();
        for (timeframe, from, to, limit) in [
            ("1m", 120_000_000, 120_031_860, 531),
            ("1h", 120_000_000, 120_001_800, 1),
            ("1M", 0, 247_039_620, 1001),
        ] {
            let request = query(timeframe, Some(from), Some(to), limit);
            let expected = reference_snapshot(&candles, &request);
            let actual = snapshot(&candles, query(timeframe, Some(from), Some(to), limit)).unwrap();
            assert_eq!(
                serde_json::to_value(&actual).unwrap(),
                serde_json::to_value(&expected).unwrap()
            );
            let started = Instant::now();
            for _ in 0..20 {
                black_box(reference_snapshot(black_box(&candles), &request));
            }
            let scan = started.elapsed();
            let started = Instant::now();
            for _ in 0..20 {
                black_box(
                    snapshot(
                        black_box(&candles),
                        query(timeframe, Some(from), Some(to), limit),
                    )
                    .unwrap(),
                );
            }
            println!(
                "synthetic {timeframe} limit={limit}: scan={scan:?}, indexed={:?} (20 requests)",
                started.elapsed()
            );
        }
    }

    #[test]
    fn monday_is_week_bucket_start() {
        assert_eq!(bucket_start(345_600, Timeframe::Week1), 345_600);
    }
}
