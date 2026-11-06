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
        if crate::symbols::normalize(&self.symbol).is_none() {
            return Err("unsupported USD cryptocurrency market".to_owned());
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
const MAX_INDICATORS_PER_TIMEFRAME: usize = 8;
const MAX_INDICATOR_NAME_CHARS: usize = 64;
const MAX_INDICATOR_PARAMS: usize = 32;
const MAX_INDICATOR_PARAM_KEY_CHARS: usize = 32;
const MAX_INDICATOR_PARAM_STRING_CHARS: usize = 128;

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
    #[serde(default = "empty_indicators")]
    pub indicators: Value,
    #[serde(default)]
    pub drawings_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub indicators_updated_at: Option<DateTime<Utc>>,
}

fn default_replay_speed() -> f64 {
    1.0
}

fn empty_indicators() -> Value {
    Value::Object(serde_json::Map::new())
}

// Indicator names are intentionally not whitelisted: the chart layer owns the
// catalogue, so a new client-side indicator must not need a server deployment.
// This mirrors the structural checks the frontend applies before sending.
fn validate_indicators(indicators: &Value) -> Result<(), String> {
    let Some(timeframes) = indicators.as_object() else {
        return Err("indicators must be an object keyed by timeframe".to_owned());
    };
    for (timeframe, entries) in timeframes {
        if !REPLAY_TIMEFRAMES.contains(&timeframe.as_str()) {
            return Err("indicators contain an unsupported timeframe".to_owned());
        }
        let Some(entries) = entries.as_array() else {
            return Err(format!("indicators for {timeframe} must be an array"));
        };
        if entries.len() > MAX_INDICATORS_PER_TIMEFRAME {
            return Err(format!(
                "at most {MAX_INDICATORS_PER_TIMEFRAME} indicators are allowed per timeframe"
            ));
        }
        let mut names = std::collections::HashSet::new();
        for entry in entries {
            let Some(entry) = entry.as_object() else {
                return Err("indicator entries must be objects".to_owned());
            };
            for key in entry.keys() {
                if key != "name" && key != "params" {
                    return Err("indicator entries may only contain name and params".to_owned());
                }
            }
            let Some(name) = entry.get("name").and_then(Value::as_str) else {
                return Err("indicator name must be a string".to_owned());
            };
            if name.is_empty()
                || name.chars().count() > MAX_INDICATOR_NAME_CHARS
                || name.chars().any(char::is_control)
            {
                return Err(format!(
                    "indicator names must contain 1-{MAX_INDICATOR_NAME_CHARS} printable characters"
                ));
            }
            if !names.insert(name) {
                return Err("indicator names must be unique per timeframe".to_owned());
            }
            let Some(params) = entry.get("params") else {
                continue;
            };
            let Some(params) = params.as_object() else {
                return Err("indicator params must be an object".to_owned());
            };
            if params.len() > MAX_INDICATOR_PARAMS {
                return Err(format!(
                    "at most {MAX_INDICATOR_PARAMS} indicator params are allowed"
                ));
            }
            for (key, value) in params {
                if key.is_empty()
                    || key.len() > MAX_INDICATOR_PARAM_KEY_CHARS
                    || !key.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                {
                    return Err("indicator param keys must be 1-32 ASCII letters, digits or '_'".to_owned());
                }
                match value {
                    Value::Bool(_) => {}
                    Value::Number(number) if number.as_f64().is_some_and(f64::is_finite) => {}
                    Value::String(text) if text.chars().count() <= MAX_INDICATOR_PARAM_STRING_CHARS => {}
                    _ => {
                        return Err(
                            "indicator params must be finite numbers, booleans or short strings"
                                .to_owned(),
                        )
                    }
                }
            }
        }
    }
    Ok(())
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
        if crate::symbols::normalize(&self.symbol).is_none() {
            return Err("unsupported USD cryptocurrency market".to_owned());
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
        validate_indicators(&self.indicators)?;
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
    pub indicators: Value,
    pub drawings_updated_at: DateTime<Utc>,
    pub indicators_updated_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub const FEEDBACK_CATEGORIES: [&str; 3] = ["bug", "idea", "other"];
pub const MAX_FEEDBACK_TITLE_CHARS: usize = 120;
pub const MAX_FEEDBACK_BODY_CHARS: usize = 4000;

#[derive(Debug, Clone, Deserialize)]
pub struct FeedbackThreadRequest {
    pub title: String,
    pub body: String,
    #[serde(default = "default_feedback_category")]
    pub category: String,
}

fn default_feedback_category() -> String {
    "bug".to_owned()
}

impl FeedbackThreadRequest {
    pub fn validate(&self) -> Result<(), String> {
        let title = self.title.trim();
        if title.is_empty() || self.title.chars().count() > MAX_FEEDBACK_TITLE_CHARS {
            return Err(format!(
                "title must contain between 1 and {MAX_FEEDBACK_TITLE_CHARS} characters"
            ));
        }
        if title.chars().any(|c| c == '\n' || c == '\r') {
            return Err("title must be a single line".to_owned());
        }
        if !FEEDBACK_CATEGORIES.contains(&self.category.as_str()) {
            return Err("category is not supported".to_owned());
        }
        validate_feedback_body(&self.body)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct FeedbackMessageRequest {
    pub body: String,
}

impl FeedbackMessageRequest {
    pub fn validate(&self) -> Result<(), String> {
        validate_feedback_body(&self.body)
    }
}

fn validate_feedback_body(body: &str) -> Result<(), String> {
    if body.trim().is_empty() || body.chars().count() > MAX_FEEDBACK_BODY_CHARS {
        return Err(format!(
            "body must contain between 1 and {MAX_FEEDBACK_BODY_CHARS} characters"
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackThreadRecord {
    pub id: Uuid,
    pub title: String,
    pub category: String,
    pub status: String,
    pub author_code: String,
    pub mine: bool,
    pub message_count: i64,
    pub last_body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMessageRecord {
    pub id: Uuid,
    pub author: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackThreadDetail {
    pub thread: FeedbackThreadRecord,
    pub messages: Vec<FeedbackMessageRecord>,
}

#[cfg(test)]
mod feedback_tests {
    use super::*;

    fn thread(title: &str, body: &str, category: &str) -> FeedbackThreadRequest {
        FeedbackThreadRequest {
            title: title.to_owned(),
            body: body.to_owned(),
            category: category.to_owned(),
        }
    }

    #[test]
    fn accepts_a_normal_bug_report() {
        assert!(thread("图表卡住", "切换到 5 分钟周期后不再播放。", "bug")
            .validate()
            .is_ok());
    }

    #[test]
    fn rejects_empty_or_oversized_fields() {
        assert!(thread("   ", "body", "bug").validate().is_err());
        assert!(thread("title", " \n ", "idea").validate().is_err());
        assert!(thread(&"t".repeat(MAX_FEEDBACK_TITLE_CHARS + 1), "body", "bug")
            .validate()
            .is_err());
        assert!(thread("title", &"b".repeat(MAX_FEEDBACK_BODY_CHARS + 1), "bug")
            .validate()
            .is_err());
        assert!(thread("two\nlines", "body", "bug").validate().is_err());
    }

    #[test]
    fn rejects_unknown_categories() {
        assert!(thread("title", "body", "praise").validate().is_err());
        for category in FEEDBACK_CATEGORIES {
            assert!(thread("title", "body", category).validate().is_ok());
        }
    }
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
            indicators: serde_json::json!({
                "1h": [{"name": "MACD", "params": {"fast": 12, "slow": 26}}],
            }),
            drawings_updated_at: None,
            indicators_updated_at: None,
        }
    }

    #[test]
    fn accepts_ten_markets_and_rejects_unknown_symbols() {
        for symbol in crate::symbols::SYMBOLS {
            let mut project = valid_project();
            project.symbol = symbol.to_owned();
            assert!(project.validate().is_ok(), "{symbol}");
        }
        let mut project = valid_project();
        project.symbol = "BTCUSDT".to_owned();
        assert_eq!(project.validate().unwrap_err(), "unsupported USD cryptocurrency market");
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
    fn validates_indicator_payloads_structurally() {
        let mut project = valid_project();
        project.indicators = serde_json::json!({
            "1h": [
                {"name": "MACD", "params": {"fast": 12, "slow": 26, "signal": 9}},
                {"name": "Bollinger", "params": {"length": 20, "mult": 2.0}},
                {"name": "TJ"},
            ],
            "15m": [{"name": "RSI", "params": {"length": 14}}],
        });
        assert!(project.validate().is_ok());

        let too_many: Vec<Value> = (0..9)
            .map(|index| serde_json::json!({"name": format!("IND{index}")}))
            .collect();
        for indicators in [
            serde_json::json!(["MACD"]),
            serde_json::json!({"7m": []}),
            serde_json::json!({"1h": [{"name": "MACD"}, {"name": "MACD"}]}),
            serde_json::json!({"1h": [{"name": ""}]}),
            serde_json::json!({"1h": [{"params": {}}]}),
            serde_json::json!({"1h": [{"name": "MACD", "params": {"fast": {"nested": 1}}}]}),
            serde_json::json!({"1h": [{"name": "MACD", "params": {"bad-key": 1}}]}),
            serde_json::json!({"1h": [{"name": "MACD", "params": {"fast": true}, "extra": 1}]}),
            serde_json::json!({"1h": too_many}),
        ] {
            let mut project = valid_project();
            project.indicators = indicators.clone();
            assert!(project.validate().is_err(), "accepted {indicators}");
        }
    }

    #[test]
    fn omitted_indicators_default_to_an_empty_object() {
        let project: ReplayProjectRequest = serde_json::from_value(serde_json::json!({
            "id": "project_1",
            "name": "BTCUSD 1h Replay",
            "symbol": "BTCUSD",
            "timeframe": "1h",
            "panes": ["1h"],
            "from": 1600000000,
            "to": 1700000000,
        }))
        .expect("payload should deserialize");
        assert_eq!(project.indicators, empty_indicators());
        assert!(project.validate().is_ok());
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
