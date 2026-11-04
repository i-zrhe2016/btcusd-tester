use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyParameters {
    pub length: usize,
    pub oversold: f64,
    pub overbought: f64,
}

impl Default for StrategyParameters {
    fn default() -> Self {
        Self {
            length: 30,
            oversold: 20.0,
            overbought: 80.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestRequest {
    #[serde(default = "default_name")]
    pub name: String,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    #[serde(default = "default_timeframe")]
    pub timeframe: String,
    pub from: i64,
    pub to: i64,
    #[serde(default = "default_capital")]
    pub initial_capital: f64,
    #[serde(default = "default_fee_rate")]
    pub fee_rate: f64,
    #[serde(default)]
    pub strategy: StrategyParameters,
}

fn default_name() -> String {
    "Stoch 交叉回测".to_owned()
}
fn default_symbol() -> String {
    "BTCUSD".to_owned()
}
fn default_timeframe() -> String {
    "1h".to_owned()
}
fn default_capital() -> f64 {
    10_000.0
}
fn default_fee_rate() -> f64 {
    0.001
}

impl BacktestRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err("name must contain between 1 and 120 characters".to_owned());
        }
        if !self.symbol.eq_ignore_ascii_case("BTCUSD")
            && !self.symbol.eq_ignore_ascii_case("BTC-USD")
        {
            return Err("only BTCUSD is supported".to_owned());
        }
        if !["1m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"]
            .contains(&self.timeframe.as_str())
        {
            return Err("timeframe is not supported".to_owned());
        }
        if self.from >= self.to {
            return Err("from must be earlier than to".to_owned());
        }
        if !self.initial_capital.is_finite() || self.initial_capital <= 0.0 {
            return Err("initial_capital must be positive".to_owned());
        }
        if !self.fee_rate.is_finite() || !(0.0..=0.05).contains(&self.fee_rate) {
            return Err("fee_rate must be between 0 and 0.05".to_owned());
        }
        if !(2..=5_000).contains(&self.strategy.length) {
            return Err("strategy length must be between 2 and 5000".to_owned());
        }
        if !(0.0..100.0).contains(&self.strategy.oversold)
            || !(0.0..=100.0).contains(&self.strategy.overbought)
            || self.strategy.oversold >= self.strategy.overbought
        {
            return Err("strategy thresholds must satisfy 0 <= oversold < overbought <= 100".to_owned());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Candle {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StochasticPoint {
    pub timestamp: i64,
    pub k: [Option<f64>; 3],
    pub d: [Option<f64>; 3],
}

#[derive(Debug, Deserialize)]
pub struct MarketSnapshot {
    pub candles: Vec<Candle>,
    pub stochastic: Vec<StochasticPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TradeSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize)]
pub struct Trade {
    pub timestamp: i64,
    pub side: TradeSide,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub realized_pnl: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BacktestResult {
    pub initial_capital: f64,
    pub final_equity: f64,
    pub total_return_pct: f64,
    pub max_drawdown_pct: f64,
    pub completed_trades: usize,
    pub win_rate_pct: f64,
    pub buy_and_hold_return_pct: f64,
    pub candles_processed: usize,
    pub trades: Vec<Trade>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BacktestRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub status: String,
    pub config: Value,
    pub result: Option<Value>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StrategyConfigRequest {
    pub name: String,
    pub parameters: StrategyParameters,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct StrategyConfigRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub parameters: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub const REPLAY_TIMEFRAMES: [&str; 11] =
    ["1m", "5m", "15m", "30m", "1h", "2h", "3h", "4h", "1d", "1w", "1M"];
pub const MAX_REPLAY_PANES: usize = 4;
const MAX_PROJECT_PAYLOAD_BYTES: usize = 768 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayProjectRequest {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_symbol")]
    pub symbol: String,
    pub timeframe: String,
    #[serde(default)]
    pub panes: Vec<String>,
    pub from: i64,
    pub to: i64,
    #[serde(default = "default_replay_speed")]
    pub speed: f64,
    #[serde(default)]
    pub cursor_index: i64,
    #[serde(default)]
    pub cursor_timestamp: Option<i64>,
    #[serde(default)]
    pub trades: Vec<Value>,
    #[serde(default)]
    pub drawings: Vec<Value>,
}

fn default_replay_speed() -> f64 {
    1.0
}

impl ReplayProjectRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 128
            || !self
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err("project id must be 1-128 ASCII letters, digits, '-' or '_'".to_owned());
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 120 {
            return Err("name must contain between 1 and 120 characters".to_owned());
        }
        if !self.symbol.eq_ignore_ascii_case("BTCUSD")
            && !self.symbol.eq_ignore_ascii_case("BTC-USD")
        {
            return Err("only BTCUSD is supported".to_owned());
        }
        if !REPLAY_TIMEFRAMES.contains(&self.timeframe.as_str()) {
            return Err("timeframe is not supported".to_owned());
        }
        if self.panes.is_empty() || self.panes.len() > MAX_REPLAY_PANES {
            return Err(format!(
                "panes must contain between 1 and {MAX_REPLAY_PANES} timeframes"
            ));
        }
        if !self.panes.iter().all(|timeframe| REPLAY_TIMEFRAMES.contains(&timeframe.as_str())) {
            return Err("panes contain an unsupported timeframe".to_owned());
        }
        if self.from >= self.to {
            return Err("from must be earlier than to".to_owned());
        }
        if !self.speed.is_finite() || !(0.25..=8.0).contains(&self.speed) {
            return Err("speed must be between 0.25 and 8".to_owned());
        }
        if self.cursor_index < 0 || self.cursor_index > 10_000_000 {
            return Err("cursor index is out of range".to_owned());
        }
        if self
            .cursor_timestamp
            .is_some_and(|timestamp| timestamp < self.from || timestamp > self.to)
        {
            return Err("cursor timestamp must be inside the project range".to_owned());
        }
        if self.trades.len() > 10_000 {
            return Err("a project may contain at most 10000 trades".to_owned());
        }
        if self.drawings.len() > 5_000 {
            return Err("a project may contain at most 5000 drawings".to_owned());
        }
        let payload_bytes = serde_json::to_vec(self)
            .map_err(|error| format!("invalid project payload: {error}"))?
            .len();
        if payload_bytes > MAX_PROJECT_PAYLOAD_BYTES {
            return Err("project payload is too large".to_owned());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplayProjectRecord {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub timeframe: String,
    pub panes: Value,
    #[sqlx(rename = "range_from")]
    pub from: i64,
    #[sqlx(rename = "range_to")]
    pub to: i64,
    pub speed: f64,
    pub cursor_index: i64,
    pub cursor_timestamp: Option<i64>,
    pub trades: Value,
    pub drawings: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod replay_project_tests {
    use super::*;

    fn valid_project() -> ReplayProjectRequest {
        ReplayProjectRequest {
            id: "project_1".to_owned(),
            name: "BTCUSD 1h Replay".to_owned(),
            symbol: "BTCUSD".to_owned(),
            timeframe: "1h".to_owned(),
            panes: vec!["1h".to_owned(), "15m".to_owned()],
            from: 1_600_000_000,
            to: 1_700_000_000,
            speed: 1.0,
            cursor_index: 10,
            cursor_timestamp: Some(1_650_000_000),
            trades: vec![serde_json::json!({"side": "buy"})],
            drawings: vec![serde_json::json!({"tool": "TrendLine"})],
        }
    }

    #[test]
    fn accepts_a_valid_project() {
        assert!(valid_project().validate().is_ok());
    }

    #[test]
    fn rejects_unsafe_ids_missing_panes_and_out_of_range_cursors() {
        for mutate in [
            |project: &mut ReplayProjectRequest| project.id = "../other".to_owned(),
            |project: &mut ReplayProjectRequest| project.panes.clear(),
            |project: &mut ReplayProjectRequest| project.panes = vec!["1h".to_owned(); 5],
            |project: &mut ReplayProjectRequest| project.panes = vec!["7m".to_owned()],
            |project: &mut ReplayProjectRequest| project.cursor_timestamp = Some(project.to + 1),
            |project: &mut ReplayProjectRequest| project.speed = 9.0,
            |project: &mut ReplayProjectRequest| project.from = project.to,
        ] {
            let mut project = valid_project();
            mutate(&mut project);
            assert!(project.validate().is_err());
        }
    }

    #[test]
    fn deserializes_frontend_camel_case_payload() {
        let project: ReplayProjectRequest = serde_json::from_value(serde_json::json!({
            "id": "project_1",
            "name": "BTCUSD 1h Replay",
            "symbol": "BTCUSD",
            "timeframe": "1h",
            "panes": ["1h"],
            "from": 1600000000,
            "to": 1700000000,
            "speed": 2,
            "cursorIndex": 3,
            "cursorTimestamp": 1650000000,
            "trades": [],
            "drawings": []
        }))
        .expect("payload should deserialize");
        assert_eq!(project.cursor_index, 3);
        assert_eq!(project.cursor_timestamp, Some(1_650_000_000));
    }
}
