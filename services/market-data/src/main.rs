#[path = "../../crypto_symbols.rs"]
mod symbols;
mod config;
mod error;
mod indicator;
mod live;
mod market;
mod model;
mod parquet_store;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::SystemTime,
};

use axum::{
    extract::{Query, State},
    http::{header, HeaderValue, Method},
    routing::get,
    Json, Router,
};
use config::Config;
use error::ApiError;
use model::{Candle, MarketMetadata, MarketSnapshot, SnapshotQuery};
use tokio::time::interval;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn};

/// Full history and the live tail stay separate: a new minute only replaces a
/// ~40 KB JSON window, and request windows are merged on the fly instead of
/// allocating a full-history copy every minute.
#[derive(Debug)]
struct Dataset {
    base: Arc<Vec<Candle>>,
    live: Arc<Vec<Candle>>,
}

impl Dataset {
    fn merged_count(&self) -> usize {
        self.base.len()
            + self
                .live
                .iter()
                .filter(|candle| {
                    self.base
                        .binary_search_by_key(&candle.timestamp, |base| base.timestamp)
                        .is_err()
                })
                .count()
    }

    fn first_timestamp(&self) -> i64 {
        match (self.base.first(), self.live.first()) {
            (Some(base), Some(live)) => base.timestamp.min(live.timestamp),
            (Some(base), None) => base.timestamp,
            (None, Some(live)) => live.timestamp,
            (None, None) => 0,
        }
    }

    fn last_timestamp(&self) -> i64 {
        match (self.base.last(), self.live.last()) {
            (Some(base), Some(live)) => base.timestamp.max(live.timestamp),
            (Some(base), None) => base.timestamp,
            (None, Some(live)) => live.timestamp,
            (None, None) => 0,
        }
    }

    /// Candles for the queried range, with the live window overriding base
    /// candles that share a timestamp.
    fn window(&self, from: Option<i64>, to: Option<i64>) -> Vec<Candle> {
        live::merge(slice_in_range(&self.base, from, to), slice_in_range(&self.live, from, to))
    }
}

fn slice_in_range(candles: &[Candle], from: Option<i64>, to: Option<i64>) -> &[Candle] {
    let start = from.map_or(0, |from| {
        candles.partition_point(|candle| candle.timestamp < from)
    });
    let end = to.map_or(candles.len(), |to| {
        candles.partition_point(|candle| candle.timestamp < to)
    });
    &candles[start..end.max(start)]
}

type Datasets = Arc<RwLock<HashMap<&'static str, Arc<Dataset>>>>;

#[derive(Clone)]
struct AppState {
    datasets: Datasets,
}

/// Identity of a data file used to detect publishes without reading it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "market_data_service=info,tower_http=info".into()),
        )
        .json()
        .init();

    let config = Config::from_env()?;
    let startup_config = config.clone();
    let datasets = tokio::task::spawn_blocking(move || -> anyhow::Result<Datasets> {
        let mut datasets = HashMap::new();
        for symbol in symbols::SYMBOLS {
            let base = read_base(&startup_config, symbol)?;
            let live = read_live(&startup_config, symbol);
            match build_dataset(base, live) {
                Some(dataset) => {
                    info!(
                        symbol,
                        base_candles = dataset.base.len(),
                        live_candles = dataset.live.len(),
                        merged_count = dataset.merged_count(),
                        "loaded market data"
                    );
                    datasets.insert(symbol, Arc::new(dataset));
                }
                None => warn!(
                    symbol,
                    path = %base_path(&startup_config, symbol).display(),
                    "market history is not installed"
                ),
            }
        }
        Ok(Arc::new(RwLock::new(datasets)))
    })
    .await??;

    tokio::spawn(watch_datasets(config.clone(), datasets.clone()));
    let app = router(AppState { datasets });
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    info!(address = %config.bind_addr, "market data service listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn base_path(config: &Config, symbol: &str) -> PathBuf {
    if symbol == "BTCUSD" {
        return config.parquet_path.clone();
    }
    config
        .parquet_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{}_1m.parquet", symbol.to_ascii_lowercase()))
}

fn live_path(config: &Config, symbol: &str) -> PathBuf {
    config
        .live_dir
        .join(format!("{}_1m.live.json", symbol.to_ascii_lowercase()))
}

fn file_stamp(path: &Path) -> Option<FileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    Some(FileStamp {
        len: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

fn read_base(config: &Config, symbol: &str) -> anyhow::Result<Option<Arc<Vec<Candle>>>> {
    let path = base_path(config, symbol);
    if path.exists() {
        Ok(Some(Arc::new(parquet_store::load_candles(&path)?)))
    } else if symbol == "BTCUSD" {
        anyhow::bail!("failed to open Parquet file {}", path.display())
    } else {
        Ok(None)
    }
}

fn read_live(config: &Config, symbol: &str) -> Option<Arc<Vec<Candle>>> {
    let path = live_path(config, symbol);
    if !path.exists() {
        return None;
    }
    match live::load_live(&path, symbol) {
        Ok(snapshot) => {
            info!(
                symbol,
                live_candles = snapshot.candles.len(),
                updated_at = snapshot.updated_at.as_deref().unwrap_or(""),
                "loaded live market window"
            );
            Some(Arc::new(snapshot.candles))
        }
        Err(error) => {
            warn!(symbol, error = %error, "ignoring invalid live market window");
            None
        }
    }
}

fn build_dataset(
    base: Option<Arc<Vec<Candle>>>,
    live: Option<Arc<Vec<Candle>>>,
) -> Option<Dataset> {
    let base = base.unwrap_or_default();
    let live = live.unwrap_or_default();
    if base.is_empty() && live.is_empty() {
        return None;
    }
    Some(Dataset { base, live })
}

/// Re-read a market when its Parquet file or live window changes. Publishes are
/// atomic renames, so readers keep the previous dataset until the replacement
/// is fully loaded and validated. Only the changed side is read again: a live
/// update never reloads the full Parquet history.
async fn watch_datasets(config: Config, datasets: Datasets) {
    let mut known: HashMap<&'static str, (Option<FileStamp>, Option<FileStamp>)> =
        symbols::SYMBOLS
            .iter()
            .map(|symbol| {
                (
                    *symbol,
                    (
                        file_stamp(&base_path(&config, symbol)),
                        file_stamp(&live_path(&config, symbol)),
                    ),
                )
            })
            .collect();
    let mut ticker = interval(config.reload_interval);
    loop {
        ticker.tick().await;
        for symbol in symbols::SYMBOLS {
            let base_stamp = file_stamp(&base_path(&config, symbol));
            let live_stamp = file_stamp(&live_path(&config, symbol));
            let previous = known.get(symbol).cloned().unwrap_or((None, None));
            if previous == (base_stamp.clone(), live_stamp.clone()) {
                continue;
            }
            let current = datasets
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(symbol)
                .cloned();
            let base_changed = previous.0 != base_stamp || current.is_none();
            let live_changed = previous.1 != live_stamp || current.is_none();
            let live_present = live_stamp.is_some();
            let load_config = config.clone();
            let result = tokio::task::spawn_blocking(move || -> anyhow::Result<Option<Dataset>> {
                let base = if base_changed {
                    read_base(&load_config, symbol)?
                } else {
                    current.as_ref().map(|dataset| dataset.base.clone())
                };
                let live = if live_changed {
                    match read_live(&load_config, symbol) {
                        Some(live) => Some(live),
                        // A present but invalid file must not discard the last
                        // valid window; a deleted file still removes it.
                        None if live_present => {
                            current.as_ref().map(|dataset| dataset.live.clone())
                        }
                        None => None,
                    }
                } else {
                    current.as_ref().map(|dataset| dataset.live.clone())
                };
                Ok(build_dataset(base, live))
            })
            .await;
            match result {
                Ok(Ok(Some(dataset))) => {
                    info!(
                        symbol,
                        base_candles = dataset.base.len(),
                        live_candles = dataset.live.len(),
                        merged_count = dataset.merged_count(),
                        last_timestamp = dataset.last_timestamp(),
                        "reloaded market data"
                    );
                    datasets
                        .write()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .insert(symbol, Arc::new(dataset));
                }
                Ok(Ok(None)) => {
                    warn!(symbol, "market data files disappeared");
                    datasets
                        .write()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .remove(symbol);
                }
                Ok(Err(error)) => warn!(symbol, error = %error, "failed to reload market data"),
                Err(error) => warn!(symbol, error = %error, "market data reload task failed"),
            }
            known.insert(symbol, (base_stamp, live_stamp));
        }
    }
}

fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("http://localhost:5173"))
        .allow_methods([Method::GET])
        .allow_headers([header::CONTENT_TYPE]);

    Router::new()
        .route("/health", get(health))
        .route("/api/market/meta", get(metadata))
        .route("/api/market/snapshot", get(snapshot))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok", "service": "market-data"}))
}

#[derive(serde::Deserialize)]
struct MetadataQuery {
    #[serde(default = "default_market")]
    symbol: String,
}

fn default_market() -> String {
    "BTCUSD".to_owned()
}

fn dataset(
    state: &AppState,
    requested: &str,
) -> Result<(&'static str, Arc<Dataset>), ApiError> {
    let symbol = symbols::normalize(requested)
        .ok_or_else(|| ApiError::BadRequest(format!("unsupported USD market {requested}")))?;
    let candles = state
        .datasets
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(symbol)
        .cloned()
        .ok_or_else(|| {
            ApiError::Unavailable(format!(
                "{symbol} history is not installed; install {}_1m.parquet and restart market-data",
                symbol.to_ascii_lowercase()
            ))
        })?;
    Ok((symbol, candles))
}

async fn metadata(
    State(state): State<AppState>,
    Query(query): Query<MetadataQuery>,
) -> Result<Json<MarketMetadata>, ApiError> {
    let (symbol, market) = dataset(&state, &query.symbol)?;
    Ok(Json(MarketMetadata {
        symbol,
        base_timeframe: "1m",
        source: "Parquet",
        candle_count: market.merged_count(),
        first_timestamp: market.first_timestamp(),
        last_timestamp: market.last_timestamp(),
        supported_timeframes: ["1m", "5m", "15m", "30m", "1h", "2h", "3h", "4h", "1d", "1w", "1M"],
    }))
}

async fn snapshot(
    State(state): State<AppState>,
    Query(query): Query<SnapshotQuery>,
) -> Result<Json<MarketSnapshot>, ApiError> {
    let (_, market) = dataset(&state, &query.symbol)?;
    let snapshot = tokio::task::spawn_blocking(move || {
        if market.live.is_empty() {
            market::snapshot(&market.base, query)
        } else {
            let window = market.window(query.from, query.to);
            market::snapshot(&window, query)
        }
    })
    .await
    .map_err(|error| ApiError::Unavailable(error.to_string()))??;
    Ok(Json(snapshot))
}

#[cfg(test)]
mod multi_market_tests {
    use super::*;

    fn candles(rows: &[(i64, f64)]) -> Vec<Candle> {
        rows.iter()
            .map(|(timestamp, close)| Candle {
                timestamp: *timestamp,
                open: *close,
                high: *close,
                low: *close,
                close: *close,
                volume: 1.0,
            })
            .collect()
    }

    fn state_with(datasets: HashMap<&'static str, Vec<Candle>>) -> AppState {
        let datasets = datasets
            .into_iter()
            .map(|(symbol, base)| {
                (
                    symbol,
                    Arc::new(Dataset {
                        base: Arc::new(base),
                        live: Arc::new(Vec::new()),
                    }),
                )
            })
            .collect();
        AppState {
            datasets: Arc::new(RwLock::new(datasets)),
        }
    }

    #[test]
    fn routes_history_without_cross_market_fallback() {
        let btc = candles(&[(60, 65000.0)]);
        let eth = candles(&[(120, 2300.0)]);
        let state = state_with(HashMap::from([("BTCUSD", btc), ("ETHUSD", eth)]));
        let (symbol, market) = dataset(&state, "eth-usd").unwrap();
        assert_eq!(symbol, "ETHUSD");
        assert_eq!(market.base[0].timestamp, 120);
        assert_eq!(market.base[0].close, 2300.0);
        assert_eq!(dataset(&state, "BTCUSD").unwrap().1.base[0].close, 65000.0);
        let missing = dataset(&state, "BNBUSD").unwrap_err();
        assert!(matches!(&missing, ApiError::Unavailable(_)));
        assert!(missing.to_string().contains("bnbusd_1m.parquet"));
        let invalid = dataset(&state, "BTCUSDT").unwrap_err();
        assert!(matches!(&invalid, ApiError::BadRequest(_)));
        assert!(invalid.to_string().contains("unsupported USD market"));
    }

    #[test]
    fn live_overlay_extends_metadata_without_copying_history() {
        let dataset = Dataset {
            base: Arc::new(candles(&[(60, 1.0), (120, 2.0)])),
            live: Arc::new(candles(&[(120, 9.0), (180, 3.0)])),
        };
        assert_eq!(dataset.merged_count(), 3);
        assert_eq!(dataset.first_timestamp(), 60);
        assert_eq!(dataset.last_timestamp(), 180);
        assert_eq!(
            dataset.window(Some(60), Some(240))
                .iter()
                .map(|candle| (candle.timestamp, candle.close))
                .collect::<Vec<_>>(),
            vec![(60, 1.0), (120, 9.0), (180, 3.0)]
        );
        assert_eq!(dataset.window(Some(130), None).len(), 1);
    }

    #[test]
    fn file_stamps_track_publishes() {
        let directory = std::env::temp_dir().join(format!("grailab-stamp-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.json");
        std::fs::write(&path, b"[]").unwrap();
        let first = file_stamp(&path).unwrap();
        std::fs::write(&path, b"[1, 2]").unwrap();
        let second = file_stamp(&path).unwrap();
        assert_ne!(first, second);
        assert!(file_stamp(&directory.join("missing.json")).is_none());
        let _ = std::fs::remove_dir_all(directory);
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
