use std::{env, net::SocketAddr, time::Duration};

#[derive(Clone)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub clerk_issuer: String,
    pub clerk_authorized_parties: Vec<String>,
    pub database_url: String,
    pub market_data_url: String,
    pub request_timeout: Duration,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let clerk_issuer = env::var("CLERK_ISSUER")?;
        let issuer_url = reqwest::Url::parse(&clerk_issuer)?;
        anyhow::ensure!(issuer_url.scheme() == "https" && issuer_url.host_str().is_some() && issuer_url.query().is_none() && issuer_url.fragment().is_none(), "CLERK_ISSUER must be an HTTPS issuer URL");
        let clerk_authorized_parties: Vec<String> = env::var("CLERK_AUTHORIZED_PARTIES")?
            .split(',').map(str::trim).filter(|v| !v.is_empty()).map(str::to_owned).collect();
        anyhow::ensure!(!clerk_authorized_parties.is_empty(), "CLERK_AUTHORIZED_PARTIES must list allowed frontend origins");
        Ok(Self {
            clerk_issuer,
            clerk_authorized_parties,
            bind_addr: env::var("BACKTEST_BIND")
                .unwrap_or_else(|_| "0.0.0.0:8082".to_owned())
                .parse()?,
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://btcusd:btcusd@postgres:5432/btcusd".to_owned()),
            market_data_url: env::var("MARKET_DATA_URL")
                .unwrap_or_else(|_| "http://market-data:8081".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            request_timeout: Duration::from_secs(
                env::var("MARKET_DATA_TIMEOUT_SECONDS")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(30),
            ),
        })
    }
}

