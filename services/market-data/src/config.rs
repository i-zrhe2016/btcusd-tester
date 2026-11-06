use std::{env, net::SocketAddr, path::PathBuf, time::Duration};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub parquet_path: PathBuf,
    pub live_dir: PathBuf,
    pub reload_interval: Duration,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind_addr = env::var("MARKET_DATA_BIND")
            .unwrap_or_else(|_| "0.0.0.0:8081".to_owned())
            .parse()?;
        let parquet_path = env::var("MARKET_DATA_PARQUET")
            .unwrap_or_else(|_| "/data/btcusd_1m.parquet".to_owned())
            .into();
        let default_live_dir = PathBuf::from(&parquet_path)
            .parent()
            .map(|parent| parent.join("live"))
            .unwrap_or_else(|| PathBuf::from("live"));
        let live_dir = env::var("MARKET_DATA_LIVE_DIR")
            .map(PathBuf::from)
            .unwrap_or(default_live_dir);
        let reload_seconds = env::var("MARKET_DATA_RELOAD_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(5)
            .max(1);

        Ok(Self {
            bind_addr,
            parquet_path,
            live_dir,
            reload_interval: Duration::from_secs(reload_seconds),
        })
    }
}
